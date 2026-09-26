import sharp from 'sharp';
import { readdir, stat, unlink } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';

const INPUT_DIR = new URL('../public/images', import.meta.url).pathname;
const QUALITY_PHOTO = 82;   // JPEGs (photos)
const QUALITY_PNG   = 90;   // PNGs (covers/logos — sharper text/edges)

let totalBefore = 0;
let totalAfter  = 0;
let converted   = 0;
let skipped     = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else {
      await convertFile(full);
    }
  }
}

async function convertFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return;

  const outPath = join(dirname(filePath), basename(filePath, ext) + '.webp');
  const quality = ext === '.png' ? QUALITY_PNG : QUALITY_PHOTO;

  try {
    const { size: sizeBefore } = await stat(filePath);
    await sharp(filePath).webp({ quality }).toFile(outPath);
    const { size: sizeAfter } = await stat(outPath);

    totalBefore += sizeBefore;
    totalAfter  += sizeAfter;
    converted++;

    const pct = Math.round((1 - sizeAfter / sizeBefore) * 100);
    const kb  = n => (n / 1024).toFixed(0).padStart(5);
    console.log(`✓ ${kb(sizeBefore)}KB → ${kb(sizeAfter)}KB (-${pct}%) ${filePath.replace(INPUT_DIR + '/', '')}`);

    await unlink(filePath);
  } catch (err) {
    console.error(`✗ SKIP ${filePath}: ${err.message}`);
    skipped++;
  }
}

console.log(`Converting images in ${INPUT_DIR}...\n`);
await walk(INPUT_DIR);

const saved = totalBefore - totalAfter;
const pct   = Math.round((1 - totalAfter / totalBefore) * 100);
console.log(`
── Summary ──────────────────────────────
  Converted : ${converted} files${skipped ? `  (${skipped} skipped)` : ''}
  Before    : ${(totalBefore / 1024 / 1024).toFixed(1)} MB
  After     : ${(totalAfter  / 1024 / 1024).toFixed(1)} MB
  Saved     : ${(saved / 1024 / 1024).toFixed(1)} MB  (${pct}% smaller)
─────────────────────────────────────────`);
