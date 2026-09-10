import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep native icons reproducible from the shared, full-resolution brand logo.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = mkdtempSync(join(tmpdir(), 'org2-ios-icons-'));
execFileSync(join(root, 'node_modules/.bin/tauri'), [
  'icon', join(root, 'public/logo.png'), '--output', output, '--ios-color', '#000000',
], { cwd: root, stdio: 'inherit' });
const catalog = join(root, 'apps/remote-ios/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset');
const { images } = JSON.parse(readFileSync(join(catalog, 'Contents.json'), 'utf8'));
for (const { filename } of images) {
  if (filename) copyFileSync(join(output, 'ios', filename), join(catalog, filename));
}
execFileSync('swift', [join(root, 'scripts/tauri/opaque-ios-icons.swift'),
  ...images.filter(({ filename }) => filename).map(({ filename }) => join(catalog, filename)),
], { stdio: 'inherit' });
for (const { filename, size, scale } of images) {
  if (!filename) continue;
  const expected = Number.parseFloat(size) * Number.parseFloat(scale);
  const properties = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight',
    '-g', 'hasAlpha', join(catalog, filename)], { encoding: 'utf8' });
  const width = Number(properties.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(properties.match(/pixelHeight: (\d+)/)?.[1]);
  if (width !== expected || height !== expected || !properties.includes('hasAlpha: no')) {
    throw new Error(`Invalid iOS icon: ${filename}`);
  }
}
console.log(`Updated ${images.length} iOS icons from public/logo.png`);
