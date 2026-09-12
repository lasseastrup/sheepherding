// Bundles the Electron shell into dist-electron/: main + preload (CommonJS), overlay renderer (IIFE), assets.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist-electron/icons', { recursive: true });
execSync('node tools/gen-glb.mjs', { stdio: 'inherit' });
const glb = readFileSync('assets/sheep.glb').toString('base64');

const common = '--bundle --target=node20 --platform=node --format=cjs --external:electron --external:koffi --sourcemap';
execSync(`npx esbuild electron/main.ts ${common} --outfile=dist-electron/main.cjs`, { stdio: 'inherit' });
execSync(`npx esbuild electron/preload.ts ${common} --outfile=dist-electron/preload.cjs`, { stdio: 'inherit' });
execSync('npx esbuild electron/overlay.ts --bundle --format=iife --target=es2022 --platform=browser --minify --outfile=dist-electron/overlay.js', { stdio: 'inherit' });
execSync('npx esbuild electron/tuning.ts --bundle --format=iife --target=es2022 --platform=browser --minify --outfile=dist-electron/tuning.js', { stdio: 'inherit' });
copyFileSync('electron/overlay.html', 'dist-electron/overlay.html');
copyFileSync('electron/tuning.html', 'dist-electron/tuning.html');
copyFileSync('electron/icons/tray.png', 'dist-electron/icons/tray.png');
copyFileSync('electron/icons/tray-mono.png', 'dist-electron/icons/tray-mono.png');
console.log('built dist-electron/');
