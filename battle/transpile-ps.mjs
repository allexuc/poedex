// Showdown の TypeScript を、Node で require できる CommonJS に変換する（公式の build と同じ考え方）
import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const PS = process.argv[2];
const files = [];
const walk = d => { for (const f of readdirSync(join(PS, d))) { const p = join(d, f); if (statSync(join(PS, p)).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p); } };
for (const d of ['sim', 'lib', 'data']) walk(d);
files.push('config/formats.ts');
await build({ entryPoints: files.map(f => join(PS, f)), outdir: join(PS, 'dist'), outbase: PS, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'error' });
console.log('transpiled', files.length, 'files');
