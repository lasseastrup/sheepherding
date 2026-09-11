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
}

export interface FrameOptions {
  debugColours: boolean;
  links: boolean;
  /** pointer world position, or null when it is off the paddock */
  pointer: { x: number; y: number; vx: number; vy: number } | null;
}

const GAITS = [
  { clip: 'walk', refSpeed: 1.2 },
  { clip: 'trot', refSpeed: 2.5 },
  { clip: 'run', refSpeed: 4.0 },
] as const;
const STATIONARY = ['idle', 'graze', 'alert'] as const;

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
  wool: THREE.MeshStandardMaterial[];
  baseColour: THREE.Color;
  startle: THREE.AnimationAction | null;
  lastFear: number;
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
  private readonly dog: THREE.Group;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private width = 1;
  private height = 1;

  constructor(options: RendererOptions) {
    this.opts = {
      tiltDeg: 22,
      groundColour: '#6d8b5e',
      tuftColour: '#5c7a4f',
      clearColour: '#dfe2d8',
      shadows: true,
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
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.buildGround());

    this.linkPositions = new Float32Array(512 * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linkPositions, 3));
    lg.setDrawRange(0, 0);
    this.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    this.links.frustumCulled = false;
    this.links.visible = false;
    this.scene.add(this.links);

    this.dog = this.buildDog();
    this.dog.visible = false;
    this.scene.add(this.dog);
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
              o.frustumCulled = false;
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

  /** Grass drawn once: base colour plus thousands of leaning tuft strokes. */
  private grassCanvas(): HTMLCanvasElement {
    const { world, groundColour, tuftColour } = this.opts;
    const px = 48;
    const c = document.createElement('canvas');
    c.width = Math.round(world.width * px);
    c.height = Math.round(world.height * px);
    const g = c.getContext('2d')!;
    g.fillStyle = groundColour;
    g.fillRect(0, 0, c.width, c.height);
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    g.strokeStyle = tuftColour;
    g.lineWidth = 1.4;
    const n = Math.round((c.width * c.height) / 700);
    for (let i = 0; i < n; i++) {
      const x = rnd() * c.width;
      const y = rnd() * c.height;
      const len = px * (0.08 + rnd() * 0.16);
      const lean = (rnd() - 0.5) * 0.9;
      g.globalAlpha = 0.25 + rnd() * 0.45;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + lean * len, y - len);
      g.stroke();
    }
    // faint patchiness so the field is not one flat tone: soft, dark, and barely there.
    // sRGB textures amplify light overlays under lighting, so keep these very subtle.
    for (let i = 0; i < 26; i++) {
      const r = px * (2 + rnd() * 5);
      const x = rnd() * c.width;
      const y = rnd() * c.height;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(10, 20, 8, 0.07)');
      grad.addColorStop(1, 'rgba(10, 20, 8, 0)');
      g.globalAlpha = 1;
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    return c;
  }

  /** The pointer's avatar: a collie, dark with a white blaze, and a ground ring so it can be found. */
  private buildDog(): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeceae2, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), dark);
    body.scale.set(0.85, 0.42, 0.4);
    body.position.y = 0.42;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), dark);
    head.position.set(0.5, 0.55, 0);
    head.castShadow = true;
    const blaze = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), white);
    blaze.position.set(0.66, 0.56, 0);
    blaze.scale.set(1, 0.7, 0.8);
    const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), white);
    ruff.position.set(0.2, 0.36, 0);
    ruff.scale.set(0.6, 0.6, 1.0);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), white);
    tail.position.set(-0.62, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.4, 6), dark);
      leg.position.set(i < 2 ? 0.28 : -0.3, 0.2, i % 2 ? 0.14 : -0.14);
      leg.castShadow = true;
      g.add(leg);
    }
    g.add(body, head, blaze, ruff, tail);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0x14180f, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    g.add(ring);
    return g;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = Math.max(1, Math.round(cssWidth * dpr));
    this.height = Math.max(1, Math.round(cssHeight * dpr));
    this.renderer.setSize(this.width, this.height, false);
    this.fitCamera();
  }

  private fitCamera(): void {
    const { world, tiltDeg } = this.opts;
    const tilt = (tiltDeg * Math.PI) / 180;
    // fit the ground footprint, whose projected height shrinks with the tilt
    const pxPerBL = Math.min(this.width / world.width, this.height / (world.height * Math.cos(tilt) + 1.2 * Math.sin(tilt)));
    const halfW = this.width / pxPerBL / 2;
    const halfH = this.height / pxPerBL / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    const cx = world.width / 2;
    const cz = world.height / 2;
    const d = 60;
    this.camera.position.set(cx, d * Math.cos(tilt), cz + d * Math.sin(tilt));
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();
  }

  /** Pointer in canvas CSS pixels to a point on the ground plane, or null off the paddock. */
  screenToWorld(cssX: number, cssY: number, cssWidth: number, cssHeight: number): { x: number; y: number } | null {
    const ndc = new THREE.Vector2((cssX / cssWidth) * 2 - 1, -(cssY / cssHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpV);
    if (!hit) return null;
    return { x: hit.x, y: hit.z };
  }

  /** Create or dispose instances to match the flock size. */
  setCount(n: number): void {
    if (!this.gltf) return;
    while (this.sheep.length > n) {
      const s = this.sheep.pop()!;
      this.scene.remove(s.root);
      s.mixer.stopAllAction();
      for (const m of s.wool) m.dispose();
    }
    while (this.sheep.length < n) this.sheep.push(this.makeSheep(this.sheep.length));
  }

  private makeSheep(index: number): SheepInstance {
    const root = cloneSkeleton(this.gltf!.scene);
    const wool: THREE.MeshStandardMaterial[] = [];
    // per-sheep wool tint: a little warm/cool variation between ewes
    const tint = new THREE.Color(0xf2efe4);
    const seed = ((index * 9301 + 49297) % 233280) / 233280;
    tint.offsetHSL((seed - 0.5) * 0.04, 0, (seed - 0.5) * 0.06);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        if (m.name === 'Wool') {
          const c = (m as THREE.MeshStandardMaterial).clone();
          c.color.copy(tint);
          wool.push(c);
          return c;
        }
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
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
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        if (o.name === 'Neck') neck = o as THREE.Bone;
        if (o.name === 'Head') head = o as THREE.Bone;
      }
    });
    this.scene.add(root);
    return { root, mixer, actions, weights, strides, phase: seed, neck, head, lookYaw: 0, wool, baseColour: tint, startle, lastFear: 0 };
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
        s.phase = (s.phase + (speed * dt) / stride) % 1;
        for (const g of GAITS) {
          const a = s.actions[g.clip];
          if (a) a.time = s.phase * a.getClip().duration;
        }
      }
      s.mixer.update(dt);

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
      s.lookYaw += (yawTarget - s.lookYaw) * (1 - Math.exp(-dt / 0.16));
      if (Math.abs(s.lookYaw) > 1e-3 && (s.neck || s.head)) {
        s.root.updateMatrixWorld(true);
        if (s.neck) this.rotateAboutWorldUp(s.neck, s.lookYaw * 0.4);
        if (s.head) this.rotateAboutWorldUp(s.head, s.lookYaw * 0.6);
      }

      // --- colour ---
      const col = frame.debugColours ? new THREE.Color(STATE_COLOURS[state] ?? 0xffffff) : s.baseColour;
      for (const m of s.wool) m.color.copy(col);
    }

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

    // the dog
    if (frame.pointer) {
      this.dog.visible = true;
      this.dog.position.set(frame.pointer.x, 0, frame.pointer.y);
      const sp = Math.hypot(frame.pointer.vx, frame.pointer.vy);
      if (sp > 0.15) {
        const target = -Math.atan2(frame.pointer.vy, frame.pointer.vx);
        this.dog.rotation.y = lerpAngle(this.dog.rotation.y, target, 1 - Math.exp(-dt / 0.12));
      }
    } else {
      this.dog.visible = false;
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
    this.renderer.dispose();
  }
}
