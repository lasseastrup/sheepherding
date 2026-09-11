// Prints the structure of a .glb: meshes, skin bones, animations and their durations.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2] ?? 'assets/sheep.glb');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
const jsonLen = dv.getUint32(12, true);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
console.log(`size ${(buf.length / 1024).toFixed(1)} KB, nodes ${json.nodes.length}, meshes ${json.meshes?.length ?? 0}, materials ${(json.materials ?? []).map((m) => m.name).join(', ')}`);
for (const m of json.meshes ?? []) {
  const prims = m.primitives.map((p) => `${json.accessors[p.indices].count / 3} tris`).join(' + ');
  console.log(`mesh ${m.name}: ${prims}, skinned: ${m.primitives[0].attributes.JOINTS_0 !== undefined}`);
}
for (const s of json.skins ?? []) console.log(`skin joints: ${s.joints.map((j) => json.nodes[j].name).join(', ')}`);
for (const a of json.animations ?? []) {
  let dur = 0;
  for (const s of a.samplers) dur = Math.max(dur, json.accessors[s.input].max[0]);
  const targets = new Set(a.channels.map((c) => json.nodes[c.target.node].name));
  console.log(`anim ${a.name.padEnd(8)} ${dur.toFixed(3)} s, ${a.channels.length} channels on ${[...targets].join(' ')}`);
}
