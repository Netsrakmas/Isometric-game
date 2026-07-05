// One-off: pull ASSETS_B64 out of the prototype HTML and write loose .webp files + manifest.json
import fs from 'fs';
import path from 'path';

const src = process.argv[2], outDir = process.argv[3];
const html = fs.readFileSync(src, 'utf8');
const line = html.split('\n').find(l => l.startsWith('const ASSETS_B64'));
const json = line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1);
const dict = JSON.parse(json);
fs.mkdirSync(outDir, { recursive: true });
const files = [];
for (const [key, dataUri] of Object.entries(dict)) {
  const b64 = dataUri.split(',')[1];
  const file = key + '.webp';
  fs.writeFileSync(path.join(outDir, file), Buffer.from(b64, 'base64'));
  files.push(file);
}
files.sort();
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(files, null, 1) + '\n');
console.log('wrote', files.length, 'assets');
