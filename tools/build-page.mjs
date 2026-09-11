// Builds the playable single page: embeds assets/sheep.glb, bundles web/app.ts, inlines into the template.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

execSync('node tools/gen-glb.mjs', { stdio: 'inherit' });
const glb = readFileSync('assets/sheep.glb').toString('base64');
execSync('npx esbuild web/app.ts --bundle --format=iife --target=es2020 --minify --outfile=web/generated/app.js', { stdio: 'inherit' });
const js = readFileSync('web/generated/app.js', 'utf8');
const template = readFileSync('web/template.html', 'utf8');
if (!template.includes('__APP__')) throw new Error('template lacks __APP__ placeholder');
writeFileSync('web/sheepdog-trial.html', template.replace('__APP__', () => js));
console.log(`built web/sheepdog-trial.html (${(js.length / 1024).toFixed(0)} KB script, ${(glb.length / 1024).toFixed(0)} KB model)`);
