/**
 * three.js view of the flock: skinned low-poly sheep from assets/sheep.glb, phase-locked
 * gait blending so feet never slide, head look-at, cast shadows, and a ground that is either
 * a grass paddock or fully transparent for the desktop overlay.
 *
 * Coordinates: sim (x, y) on the ground maps to three.js (x, 0, y); heading θ (sim, y down on
 * screen) maps to a rotation of −θ about +Y, so the model, which faces +X, points along (cos θ, sin θ).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SNAP_HEADER, SNAP_STRIDE, SheepState } from '../sim';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  world: { width: number; height: number };
  ground: 'paddock' | 'transparent';
  /** camera pitch away from straight down, degrees */
  tiltDeg?: number;
  groundColour?: string;
  tuftColour?: string;
  /** null for a transparent clear (overlay) */
  clearColour?: string | null;
  shadows?: boolean;
  /** above this flock size, real shadow maps give way to instanced blob shadows */
  shadowLimit?: number;
}

export interface FrameOptions {
  debugColours: boolean;
  links: boolean;
}

const GAITS = [
  { clip: 'walk', refSpeed: 1.2 },
  { clip: 'trot', refSpeed: 2.5 },
  { clip: 'run', refSpeed: 4.0 },
] as const;
const STATIONARY = ['idle', 'graze', 'alert'] as const;

/**
 * Animation is the most expensive thing per sheep, so a big flock updates its mixers in
 * round-robin slots: anything moving or near the pointer still animates every frame, and the
 * rest advance in bigger steps less often. Nobody watching a distant grazing ewe can tell.
 */
const ANIM_LOD_FROM = 80;
const ANIM_BUCKETS_MAX = 8;

/** Round-robin slots: more of them for bigger flocks, so per-frame animation cost stays flat. */
function animBuckets(n: number): number {
  if (n <= ANIM_LOD_FROM) return 1;
  return Math.max(2, Math.min(ANIM_BUCKETS_MAX, Math.round(n / 60)));
}

const STATE_COLOURS: Record<number, number> = {
  [SheepState.Graze]: 0xf2efe4,
  [SheepState.Alert]: 0xe0a92e,
  [SheepState.Walk]: 0x7fa3b8,
  [SheepState.Run]: 0xc05a3e,
  [SheepState.Rest]: 0xcfd3c8,
};

interface SheepInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  weights: Record<string, number>;
  strides: Record<string, number>;
  phase: number;
  neck: THREE.Bone | null;
  head: THREE.Bone | null;
  lookYaw: number;
  materials: THREE.MeshStandardMaterial[];
  /** live shader uniforms for the wool and skin colours of this sheep */
  tints: { uWool: { value: THREE.Color }; uDark: { value: THREE.Color } }[];
  baseColour: THREE.Color;
  startle: THREE.AnimationAction | null;
  lastFear: number;
  /** round-robin slot for animation updates when the flock is too big to update every sheep */
  bucket: number;
  pendingDt: number;
  /** set for the frames on which this sheep's pose actually changed */
  poseDirty: boolean;
  skeleton: THREE.Skeleton | null;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export class SheepRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly opts: Required<RendererOptions>;
  private gltf: GLTF | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private sheep: SheepInstance[] = [];
  private readonly links: THREE.LineSegments;
  private readonly linkPositions: Float32Array;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private width = 1;
  private height = 1;
  private ground: THREE.Object3D | null = null;
  /** 1 fits the whole paddock; above that the camera closes in and follows the flock */
  private zoomLevel = 1;
  private focusX = 0;
  private focusZ = 0;
  private focusInit = false;
  private blobs: THREE.InstancedMesh | null = null;
  private readonly blobMatrix = new THREE.Matrix4();
  private readonly tmpColour = new THREE.Color();
  private frameCounter = 0;
  private useShadowMap = true;

  constructor(options: RendererOptions) {
    this.opts = {
      tiltDeg: 22,
      groundColour: '#6d8b5e',
      tuftColour: '#5c7a4f',
      clearColour: '#dfe2d8',
      shadows: true,
      shadowLimit: 64,
      ...options,
    };
    const { canvas, world } = this.opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.opts.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.opts.clearColour) this.renderer.setClearColor(new THREE.Color(this.opts.clearColour), 1);
    else this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);

    // light: a high sun from the upper left, soft sky fill
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x5d6b4a, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    this.sun.position.set(world.width / 2 - 14, 30, world.height / 2 - 10);
    this.sun.target.position.set(world.width / 2, 0, world.height / 2);
    this.sun.castShadow = this.opts.shadows;
    const sc = this.sun.shadow.camera;
    const pad = 2;
    sc.left = -(world.width / 2 + pad);
    sc.right = world.width / 2 + pad;
    sc.top = world.height / 2 + pad;
    sc.bottom = -(world.height / 2 + pad);
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.ground = this.buildGround();
    this.scene.add(this.ground);

    this.linkPositions = new Float32Array(512 * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linkPositions, 3));
    lg.setDrawRange(0, 0);
    this.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    this.links.frustumCulled = false;
    this.links.visible = false;
    this.scene.add(this.links);
  }

  /** Load the sheep model from an in-memory glb. Resolves when clones can be made. */
  load(glb: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(
        glb,
        '',
        (gltf) => {
          this.gltf = gltf;
          for (const c of gltf.animations) this.clips.set(c.name, c);
          gltf.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = false;
            }
          });
          resolve();
        },
        (err) => reject(err),
      );
    });
  }

  private buildGround(): THREE.Object3D {
    const { world, ground } = this.opts;
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(world.width, world.height);
    let mat: THREE.Material;
    if (ground === 'paddock') {
      const tex = new THREE.CanvasTexture(this.grassCanvas());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(world.width / SheepRenderer.TILE_BL, world.height / SheepRenderer.TILE_BL);
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    } else {
      mat = new THREE.ShadowMaterial({ opacity: 0.32 });
      mat.transparent = true;
    }
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(world.width / 2, 0, world.height / 2);
    plane.receiveShadow = true;
    group.add(plane);
    if (ground === 'paddock') {
      const pts = [
        new THREE.Vector3(0, 0.005, 0), new THREE.Vector3(world.width, 0.005, 0),
        new THREE.Vector3(world.width, 0.005, world.height), new THREE.Vector3(0, 0.005, world.height),
      ];
      const fence = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1c261a, transparent: true, opacity: 0.55 }));
      group.add(fence);
    }
    return group;
  }

  /**
   * Grass drawn once into a tile that repeats, rather than one texture the size of the paddock:
   * a 100 BL field would otherwise need a 5000 px canvas, which costs memory and fill rate for
   * no visible gain. Strokes near an edge are drawn again on the opposite side so the tile wraps.
   */
  private static readonly TILE_BL = 16;

  private grassCanvas(): HTMLCanvasElement {
    const { groundColour, tuftColour } = this.opts;
    const px = 48;
    const c = document.createElement('canvas');
    c.width = Math.round(SheepRenderer.TILE_BL * px);
    c.height = Math.round(SheepRenderer.TILE_BL * px);
    const g = c.getContext('2d')!;
    g.fillStyle = groundColour;
    g.fillRect(0, 0, c.width, c.height);
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    g.lineWidth = 1.4;
    const n = Math.round((c.width * c.height) / 420);
    for (let i = 0; i < n; i++) {
      const x = rnd() * c.width;
      const y = rnd() * c.height;
      const len = px * (0.06 + rnd() * 0.18);
      const lean = (rnd() - 0.5) * 0.9;
      g.strokeStyle = rnd() < 0.22 ? groundColour : tuftColour;
      g.globalAlpha = 0.18 + rnd() * 0.5;
      const stroke = (ox: number, oy: number): void => {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + lean * len, y + oy - len);
        g.stroke();
      };
      stroke(0, 0);
      // wrap the few strokes that cross a tile edge
      if (x < len) stroke(c.width, 0);
      if (x > c.width - len) stroke(-c.width, 0);
      if (y < len) stroke(0, c.height);
      if (y > c.height - len) stroke(0, -c.height);
    }
    // No large soft patches here: the tile repeats across the paddock, and anything bigger than
    // a tuft turns into a visible grid. Variation has to come from the tufts themselves.
    g.globalAlpha = 1;
    return c;
  }


  /** Change the paddock size in place: rebuilds the ground, the sun's shadow frustum and the camera. */
  setWorld(world: { width: number; height: number }): void {
    if (world.width === this.opts.world.width && world.height === this.opts.world.height) return;
    this.opts.world = { ...world };
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    this.ground = this.buildGround();
    this.scene.add(this.ground);
    this.sun.position.set(world.width / 2 - 14, 30, world.height / 2 - 10);
    this.sun.target.position.set(world.width / 2, 0, world.height / 2);
    const sc = this.sun.shadow.camera;
    const pad = 2;
    sc.left = -(world.width / 2 + pad);
    sc.right = world.width / 2 + pad;
    sc.top = world.height / 2 + pad;
    sc.bottom = -(world.height / 2 + pad);
    sc.updateProjectionMatrix();
    this.fitCamera();
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = Math.max(1, Math.round(cssWidth * dpr));
    this.height = Math.max(1, Math.round(cssHeight * dpr));
    this.renderer.setSize(this.width, this.height, false);
    this.fitCamera();
  }

  /** Zoom: 1 fits the paddock, higher closes in. Returns the value actually applied. */
  setZoom(z: number): number {
    const next = Math.min(12, Math.max(1, z));
    if (next !== this.zoomLevel) {
      this.zoomLevel = next;
      this.fitCamera();
    }
    return this.zoomLevel;
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  /** Point the camera at a spot on the ground. Ignored while the whole paddock is in view. */
  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.focusInit = true;
    if (this.zoomLevel > 1) this.fitCamera();
  }

  private fitCamera(): void {
    const { world, tiltDeg } = this.opts;
    const tilt = (tiltDeg * Math.PI) / 180;
    // fit the ground footprint, whose projected height shrinks with the tilt
    const projectedHeight = world.height * Math.cos(tilt) + 1.2 * Math.sin(tilt);
    const fitPxPerBL = Math.min(this.width / world.width, this.height / projectedHeight);
    const pxPerBL = fitPxPerBL * this.zoomLevel;
    const halfW = this.width / pxPerBL / 2;
    const halfH = this.height / pxPerBL / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;

    // Keep the view inside the fences: pan only as far as the paddock edge, and stay centred on
    // whichever axis still fits entirely on screen.
    const visW = halfW;
    const visH = halfH / Math.max(0.2, Math.cos(tilt));
    let cx = world.width / 2;
    let cz = world.height / 2;
    if (this.focusInit && this.zoomLevel > 1) {
      cx = visW * 2 >= world.width ? cx : Math.min(world.width - visW, Math.max(visW, this.focusX));
      cz = visH * 2 >= world.height ? cz : Math.min(world.height - visH, Math.max(visH, this.focusZ));
    }

    const d = 60;
    this.camera.position.set(cx, d * Math.cos(tilt), cz + d * Math.sin(tilt));
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();

    // Spend the shadow map on what is actually visible: at high zoom a frustum covering the whole
    // paddock leaves only a handful of texels per sheep.
    if (this.sun.castShadow) {
      const sc = this.sun.shadow.camera;
      const pad = 2;
      const sw = Math.min(world.width / 2 + pad, visW + pad);
      const sh = Math.min(world.height / 2 + pad, visH + pad);
      sc.left = -sw;
      sc.right = sw;
      sc.top = sh;
      sc.bottom = -sh;
      sc.updateProjectionMatrix();
      this.sun.position.set(cx - 14, 30, cz - 10);
      this.sun.target.position.set(cx, 0, cz);
      this.sun.target.updateMatrixWorld();
    }
  }

  /** Pointer in canvas CSS pixels to a point on the ground plane, or null off the paddock. */
  screenToWorld(cssX: number, cssY: number, cssWidth: number, cssHeight: number): { x: number; y: number } | null {
    const ndc = new THREE.Vector2((cssX / cssWidth) * 2 - 1, -(cssY / cssHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpV);
    if (!hit) return null;
    return { x: hit.x, y: hit.z };
  }

  /** Create or dispose instances to match the flock size, and pick a shadow strategy for it. */
  setCount(n: number): void {
    if (!this.gltf) return;
    // A shadow map costs a second draw call per sheep. Past a certain flock size that doubling
    // matters more than the quality, so big flocks get instanced blob shadows instead.
    const wantShadowMap = this.opts.shadows && n <= this.opts.shadowLimit;
    if (wantShadowMap !== this.useShadowMap) {
      this.useShadowMap = wantShadowMap;
      this.renderer.shadowMap.enabled = wantShadowMap;
      this.sun.castShadow = wantShadowMap;
      for (const s of this.sheep) s.root.traverse((o) => { (o as THREE.Mesh).castShadow = wantShadowMap; });
    }
    while (this.sheep.length > n) {
      const s = this.sheep.pop()!;
      this.scene.remove(s.root);
      s.mixer.stopAllAction();
      for (const m of s.materials) m.dispose();
    }
    while (this.sheep.length < n) this.sheep.push(this.makeSheep(this.sheep.length));
    this.rebuildBlobs(wantShadowMap ? 0 : n);
  }

  /** One instanced disc per sheep, standing in for a shadow map on large flocks. */
  private rebuildBlobs(n: number): void {
    if (this.blobs && this.blobs.count === n) return;
    if (this.blobs) {
      this.scene.remove(this.blobs);
      this.blobs.geometry.dispose();
      (this.blobs.material as THREE.Material).dispose();
      this.blobs = null;
    }
    if (n === 0) return;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1.5, 1.0).rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(geo, mat, n);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = -1;
    this.scene.add(this.blobs);
  }

  private makeSheep(index: number): SheepInstance {
    const root = cloneSkeleton(this.gltf!.scene);
    const materials: THREE.MeshStandardMaterial[] = [];
    const tints: SheepInstance['tints'] = [];
    // per-sheep wool tint: a little warm/cool variation between ewes
    const tint = new THREE.Color(0xf2efe4);
    const seed = ((index * 9301 + 49297) % 233280) / 233280;
    tint.offsetHSL((seed - 0.5) * 0.04, 0, (seed - 0.5) * 0.06);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.useShadowMap;
      mesh.receiveShadow = false;
      // Skinned bounds ignore the current pose, so pad them rather than disabling culling: off
      // screen sheep should cost nothing to draw, and an overlay's flock often straddles an edge.
      mesh.frustumCulled = true;
      mesh.geometry.computeBoundingSphere();
      if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius *= 1.6;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const mat = src.clone();
      const uniforms = { uWool: { value: tint.clone() }, uDark: { value: new THREE.Color(0x2f3330) } };
      mat.color.set(0xffffff);
      // The model carries one material and a vertex-colour mask: white where there is fleece,
      // black where there is skin. Resolving the two colours in the shader keeps the sheep a
      // single draw call while still letting every animal be tinted on its own.
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWool = uniforms.uWool;
        shader.uniforms.uDark = uniforms.uDark;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform vec3 uWool;\nuniform vec3 uDark;')
          .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix( uDark, uWool, vColor.r );');
      };
      mat.customProgramCacheKey = () => 'sheep-mask';
      materials.push(mat);
      tints.push(uniforms);
      mesh.material = mat;
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions: Record<string, THREE.AnimationAction> = {};
    const weights: Record<string, number> = {};
    const strides: Record<string, number> = {};
    for (const name of [...STATIONARY, ...GAITS.map((g) => g.clip)]) {
      const clip = this.clips.get(name);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      actions[name] = a;
      weights[name] = 0;
    }
    for (const g of GAITS) {
      const clip = this.clips.get(g.clip);
      if (clip) {
        strides[g.clip] = g.refSpeed * clip.duration; // BL travelled per cycle at the reference speed
        actions[g.clip].timeScale = 0; // driven by phase, not by the clock
      }
    }
    // stationary clips free-run; desync so the flock does not chew in unison
    for (const name of STATIONARY) if (actions[name]) actions[name].time = seed * actions[name].getClip().duration;
    if (actions.idle) { actions.idle.setEffectiveWeight(1); weights.idle = 1; }

    let startle: THREE.AnimationAction | null = null;
    const startleClip = this.clips.get('startle');
    if (startleClip) {
      startle = mixer.clipAction(startleClip);
      startle.setLoop(THREE.LoopOnce, 1);
      startle.clampWhenFinished = false;
    }

    let neck: THREE.Bone | null = null;
    let head: THREE.Bone | null = null;
    let skeleton: THREE.Skeleton | null = null;
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        if (o.name === 'Neck') neck = o as THREE.Bone;
        if (o.name === 'Head') head = o as THREE.Bone;
      }
      const sk = (o as THREE.SkinnedMesh).skeleton;
      if (sk) skeleton = sk;
    });
    const instance = { poseDirty: true } as { poseDirty: boolean };
    if (skeleton) {
      // Every skinned mesh recomputes its bone matrices and re-uploads its bone texture on every
      // frame the renderer draws it. For a flock of hundreds that dominates the frame, and most
      // of it is wasted on sheep whose pose has not changed since the last frame.
      const sk = skeleton as THREE.Skeleton;
      const original = sk.update.bind(sk);
      sk.update = () => {
        if (!instance.poseDirty) return;
        instance.poseDirty = false;
        original();
      };
    }
    this.scene.add(root);
    return {
      root, mixer, actions, weights, strides, phase: seed, neck, head, lookYaw: 0,
      materials, tints, baseColour: tint, startle, lastFear: 0,
      bucket: index, pendingDt: 0,
      get poseDirty() { return instance.poseDirty; },
      set poseDirty(v: boolean) { instance.poseDirty = v; },
      skeleton,
    };
  }

  /** Draw one frame from an interpolated pair of sim snapshots. */
  render(prev: Float32Array, cur: Float32Array, alpha: number, dt: number, frame: FrameOptions): void {
    const n = cur[0] | 0;
    if (this.sheep.length !== n) this.setCount(n);
    const usePrev = (prev[0] | 0) === n;
    const threatActive = cur[3] > 0.5;
    const tx = cur[4];
    const tz = cur[5];
    const simDt = 1 / 30;
    const k = 1 - Math.exp(-dt / 0.18);
    this.frameCounter++;

    // While zoomed in, drift the view toward the flock so it cannot wander off screen.
    if (this.zoomLevel > 1 && n > 0) {
      let fx = 0;
      let fz = 0;
      for (let i = 0; i < n; i++) {
        const o = SNAP_HEADER + i * SNAP_STRIDE;
        fx += cur[o];
        fz += cur[o + 1];
      }
      fx /= n;
      fz /= n;
      if (!this.focusInit) {
        this.focusX = fx;
        this.focusZ = fz;
        this.focusInit = true;
      } else {
        const fk = 1 - Math.exp(-dt / 0.6);
        this.focusX += (fx - this.focusX) * fk;
        this.focusZ += (fz - this.focusZ) * fk;
      }
      this.fitCamera();
    }
    const lod = this.sheep.length > ANIM_LOD_FROM;
    const buckets = animBuckets(this.sheep.length);

    for (let i = 0; i < this.sheep.length; i++) {
      const s = this.sheep[i];
      const o = SNAP_HEADER + i * SNAP_STRIDE;
      let x = cur[o];
      let z = cur[o + 1];
      let h = cur[o + 2];
      let speed = cur[o + 3];
      const state = cur[o + 4] | 0;
      const fear = cur[o + 5];
      const scale = cur[o + 6];
      const leader = cur[o + 7] | 0;
      let yawRate = 0;
      if (usePrev) {
        x = prev[o] + (x - prev[o]) * alpha;
        z = prev[o + 1] + (z - prev[o + 1]) * alpha;
        h = lerpAngle(prev[o + 2], h, alpha);
        speed = prev[o + 3] + (speed - prev[o + 3]) * alpha;
        yawRate = Math.atan2(Math.sin(cur[o + 2] - prev[o + 2]), Math.cos(cur[o + 2] - prev[o + 2])) / simDt;
      }
      void yawRate;

      s.root.position.set(x, 0, z);
      s.root.rotation.set(0, -h, 0);
      s.root.scale.setScalar(scale || 1);

      if (this.blobs) {
        const sc = scale || 1;
        this.blobMatrix.makeRotationY(-h);
        this.blobMatrix.scale(this.tmpV.set(sc, sc, sc));
        this.blobMatrix.setPosition(x + 0.12 * sc, 0.012, z + 0.16 * sc);
        this.blobs.setMatrixAt(i, this.blobMatrix);
      }

      // Sheep that are still, far from the pointer and not frightened only animate on their turn.
      s.pendingDt += dt;
      const active = !lod || speed > 0.2 || fear > 0.15 || this.frameCounter % buckets === s.bucket % buckets;
      if (!active) continue;
      const animDt = s.pendingDt;
      s.pendingDt = 0;
      s.poseDirty = true;

      // --- gait blend on speed ---
      const target: Record<string, number> = { idle: 0, graze: 0, alert: 0, walk: 0, trot: 0, run: 0 };
      if (speed < 0.7) target.walk = smoothstep(0.18, 0.7, speed);
      else if (speed < 1.8) target.walk = 1;
      else if (speed < 2.6) { const f = smoothstep(1.8, 2.6, speed); target.walk = 1 - f; target.trot = f; }
      else if (speed < 3.0) target.trot = 1;
      else if (speed < 3.9) { const f = smoothstep(3.0, 3.9, speed); target.trot = 1 - f; target.run = f; }
      else target.run = 1;
      const moving = target.walk + target.trot + target.run;
      const still = 1 - moving;
      const alerted = state === SheepState.Alert || (fear > 0.3 && state !== SheepState.Graze);
      if (alerted) target.alert = still;
      else if (state === SheepState.Graze) target.graze = still;
      else target.idle = still;

      // startle: a hop when fear jumps
      if (s.startle && fear - s.lastFear > 0.3 && !s.startle.isRunning()) {
        s.startle.reset().setEffectiveWeight(1).play();
      }
      s.lastFear = fear;
      const startleW = s.startle && s.startle.isRunning() ? Math.sin(Math.PI * Math.min(1, s.startle.time / s.startle.getClip().duration)) : 0;

      // smooth weights and advance the shared gait phase by distance travelled
      let strideBlend = 0;
      let gaitSum = 0;
      for (const name of Object.keys(target)) {
        const w = (s.weights[name] += (target[name] - s.weights[name]) * k);
        const a = s.actions[name];
        if (!a) continue;
        a.setEffectiveWeight(w * (1 - startleW));
        if (name in s.strides) { strideBlend += w * s.strides[name]; gaitSum += w; }
      }
      if (gaitSum > 1e-3) {
        const stride = strideBlend / gaitSum;
        s.phase = (s.phase + (speed * animDt) / stride) % 1;
        for (const g of GAITS) {
          const a = s.actions[g.clip];
          if (a) a.time = s.phase * a.getClip().duration;
        }
      }
      s.mixer.update(animDt);

      // --- head look-at: the threat when frightened, otherwise the sheep it is following ---
      let yawTarget = 0;
      let lookX = NaN;
      let lookZ = NaN;
      if (threatActive && fear > 0.06) { lookX = tx; lookZ = tz; }
      else if (leader >= 0 && leader < n && state === SheepState.Walk) {
        const lo = SNAP_HEADER + leader * SNAP_STRIDE;
        lookX = cur[lo]; lookZ = cur[lo + 1];
      }
      if (Number.isFinite(lookX)) {
        const fx = Math.cos(h);
        const fz = Math.sin(h);
        const dx = lookX - x;
        const dz = lookZ - z;
        yawTarget = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
        yawTarget = Math.max(-1.3, Math.min(1.3, yawTarget));
      }
      s.lookYaw += (yawTarget - s.lookYaw) * (1 - Math.exp(-animDt / 0.16));
      if (Math.abs(s.lookYaw) > 1e-3 && (s.neck || s.head)) {
        s.root.updateMatrixWorld(true);
        if (s.neck) this.rotateAboutWorldUp(s.neck, s.lookYaw * 0.4);
        if (s.head) this.rotateAboutWorldUp(s.head, s.lookYaw * 0.6);
      }

      // --- colour ---
      const col = frame.debugColours ? this.tmpColour.setHex(STATE_COLOURS[state] ?? 0xffffff) : s.baseColour;
      for (const t of s.tints) t.uWool.value.copy(col);
    }
    if (this.blobs) this.blobs.instanceMatrix.needsUpdate = true;

    // follower links
    this.links.visible = frame.links;
    if (frame.links) {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const o = SNAP_HEADER + i * SNAP_STRIDE;
        const L = cur[o + 7] | 0;
        if (L < 0 || L >= n) continue;
        const lo = SNAP_HEADER + L * SNAP_STRIDE;
        this.linkPositions.set([cur[o], 0.55, cur[o + 1], cur[lo], 0.55, cur[lo + 1]], c * 6);
        c++;
      }
      this.links.geometry.setDrawRange(0, c * 2);
      (this.links.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Rotate a bone about the world up axis, expressed in its own local frame. */
  private rotateAboutWorldUp(bone: THREE.Bone, angle: number): void {
    bone.getWorldQuaternion(this.tmpQ);
    const localUp = this.tmpV.copy(this.up).applyQuaternion(this.tmpQ.invert()).normalize();
    this.tmpQ2.setFromAxisAngle(localUp, angle);
    bone.quaternion.multiply(this.tmpQ2);
  }

  dispose(): void {
    this.setCount(0);
    this.rebuildBlobs(0);
    this.renderer.dispose();
  }
}
