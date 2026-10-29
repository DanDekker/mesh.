import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const expected = new Set(['main.js', 'worker.js', 'style.css', 'index.html', 'icon.svg', 'social.png']);
const files = readdirSync(resolve(root, 'dist'));
for (const name of files) {
  if (!expected.has(name)) throw new Error(`Unexpected public artifact: ${name}`);
  if (name === 'social.png') continue;
  const text = await Bun.file(resolve(root, 'dist', name)).text();
  if (/bun:ffi|dlopen\(|MESH_PRIVATE_ADAPTER|\/Users\/|OTTO_SOURCE|\.dylib|\.wasm|sourceMappingURL/.test(text)) throw new Error(`Private material in public artifact: ${name}`);
}
for (const name of expected) if (!files.includes(name)) throw new Error(`Missing public artifact: ${name}`);
const manifest = await Bun.file(resolve(root, 'package.json')).json();
if (Object.keys(manifest.dependencies ?? {}).length || Object.keys(manifest.devDependencies ?? {}).length) throw new Error('This project must stay dependency-free.');
const tracked = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root });
if (tracked.exitCode !== 0) throw new Error('Could not inspect the Git index.');
for (const name of tracked.stdout.toString().split('\0').filter(Boolean)) {
  if (/(^|\/)(?:\.env(?:\.(?!example$).*)?|\.private|private)(\/|$)/.test(name) && name !== '.env.example') throw new Error(`Private file in Git: ${name}`);
  if (/\.(?:wasm|woff2?|ttf|otf|dylib|so|dll|a|map)$/.test(name)) throw new Error(`Private binary in Git: ${name}`);
}
console.log('Public artifacts and tracked files are clean. No private assets or external dependencies.');
