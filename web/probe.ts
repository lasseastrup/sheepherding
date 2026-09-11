import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHEEP_GLB_BASE64 } from './generated/sheep-glb';

export async function tree(): Promise<string> {
  const bin = atob(SHEEP_GLB_BASE64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const gltf = await new Promise<{ scene: import('three').Object3D }>((res, rej) => new GLTFLoader().parse(u.buffer, '', res as never, rej));
  const lines: string[] = [];
  const walk = (o: import('three').Object3D, d: number): void => {
    const g = (o as { geometry?: { index?: { count: number } } }).geometry;
    lines.push('  '.repeat(d) + o.type + ' "' + o.name + '"' + (g ? ' tris=' + (g.index ? g.index.count / 3 : 0) : ''));
    o.children.forEach((c) => walk(c, d + 1));
  };
  walk(gltf.scene, 0);
  return lines.join('\n');
}
declare global { interface Window { tree: typeof tree } }
window.tree = tree;
