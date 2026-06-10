/**
 * Generates a minimal valid DZI tile pyramid from the placeholder track.jpg.
 * Used for local dev when libvips is not installed.
 * In production/Docker, libvips generates real tiles from the actual track.jpg.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const WIDTH = 4500;
const HEIGHT = 8192;
const TILE_SIZE = 256;

// Number of DZI levels: from 0 (1x1) up to ceil(log2(max(W,H)))
const maxLevel = Math.ceil(Math.log2(Math.max(WIDTH, HEIGHT)));

// Write DZI manifest
const dzi = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
  TileSize="${TILE_SIZE}"
  Overlap="1"
  Format="jpg">
  <Size Width="${WIDTH}" Height="${HEIGHT}"/>
</Image>
`;

mkdirSync(join(root, 'public', 'tiles'), { recursive: true });
writeFileSync(join(root, 'public', 'tiles', 'tremblant.dzi'), dzi);
console.log('  public/tiles/tremblant.dzi');

// For each level, create tiles. At each level the image is scaled:
//   levelWidth = ceil(W * 2^(level - maxLevel))
//   levelHeight = ceil(H * 2^(level - maxLevel))
// All tiles at this placeholder resolution fit in a single 256x256 tile.
// We just copy the placeholder JPEG as every tile.
const placeholderJpg = readFileSync(join(root, 'assets', 'tremblant.jpg'));

let tileCount = 0;
for (let level = 0; level <= maxLevel; level++) {
  const scale = Math.pow(2, level - maxLevel);
  const levelW = Math.max(1, Math.ceil(WIDTH * scale));
  const levelH = Math.max(1, Math.ceil(HEIGHT * scale));
  const cols = Math.ceil(levelW / TILE_SIZE);
  const rows = Math.ceil(levelH / TILE_SIZE);

  const levelDir = join(root, 'public', 'tiles', 'tremblant_files', String(level));
  mkdirSync(levelDir, { recursive: true });

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      writeFileSync(join(levelDir, `${col}_${row}.jpg`), placeholderJpg);
      tileCount++;
    }
  }
}

console.log(`  public/tiles/tremblant_files/ (${tileCount} tiles, levels 0–${maxLevel})`);
console.log('Done. Replace with real tiles from vips when tremblant.jpg is available.');
