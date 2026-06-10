/**
 * Generates minimal placeholder image files for development:
 * - assets/track.jpg  (100x64 dark JPEG)
 * - public/icons/icon-192.png
 * - public/icons/icon-512.png
 * - public/icons/icon-maskable.png
 *
 * Uses only Node built-ins — no canvas dependency needed.
 * The images are valid but minimal; replace with real assets before shipping.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

mkdirSync(join(root, 'assets'), { recursive: true });
mkdirSync(join(root, 'public', 'icons'), { recursive: true });

// ---------------------------------------------------------------------------
// Minimal JPEG encoder (grayscale, no quantization tables — just enough to
// produce a valid file that libvips / browsers will accept)
// ---------------------------------------------------------------------------

function makeJpeg(width, height, grayValue = 20) {
  // We'll encode as a raw JFIF with one gray component using fixed huffman tables.
  // Simpler: build a raw minimal JPEG by hand using the standard structure.

  // Actually, the simplest approach for a valid JPEG without native modules is
  // to embed a pre-computed minimal JPEG and scale it conceptually. But to keep
  // it truly self-contained we encode a 100x64 solid-color JPEG by writing the
  // JFIF binary structure directly.

  // A solid gray JPEG:
  //   SOI, APP0, DQT, SOF0, DHT (DC+AC luma), SOS, scan data, EOI
  // For a solid-color image the scan data is very small.

  const buf = [];
  const push = (...bytes) => bytes.forEach(b => buf.push(b & 0xff));
  const pushU16 = v => push((v >> 8) & 0xff, v & 0xff);

  // SOI
  push(0xff, 0xd8);

  // APP0 (JFIF)
  push(0xff, 0xe0);
  const app0 = [0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  buf.push(...app0);

  // DQT — standard luminance quantization table (quality ~50)
  push(0xff, 0xdb);
  pushU16(67); // length = 2 + 1 + 64
  push(0x00); // table 0, precision 8-bit
  // Standard JPEG luminance quantization table
  const lumaQ = [
    16,11,10,16,24,40,51,61,
    12,12,14,19,26,58,60,55,
    14,13,16,24,40,57,69,56,
    14,17,22,29,51,87,80,62,
    18,22,37,56,68,109,103,77,
    24,35,55,64,81,104,113,92,
    49,64,78,87,103,121,120,101,
    72,92,95,98,112,100,103,99
  ];
  buf.push(...lumaQ);

  // SOF0 — baseline DCT, 1 component (grayscale)
  push(0xff, 0xc0);
  pushU16(11); // length = 2 + 1 + 2 + 2 + 1 + (3 per component * 1 component)
  push(0x08); // precision 8 bits
  pushU16(height);
  pushU16(width);
  push(0x01); // 1 component
  push(0x01, 0x11, 0x00); // component 1: id=1, 1x1 sampling, quant table 0

  // DHT — DC luma
  push(0xff, 0xc4);
  const dcLumaCodes = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0];
  const dcLumaValues = [0,1,2,3,4,5,6,7,8,9,10,11];
  const dcLen = 2 + 1 + 16 + dcLumaValues.length;
  pushU16(dcLen);
  push(0x00); // DC table 0
  buf.push(...dcLumaCodes);
  buf.push(...dcLumaValues);

  // DHT — AC luma
  push(0xff, 0xc4);
  const acLumaCodes = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,125];
  const acLumaValues = [
    0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,
    0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,
    0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,
    0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,
    0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,
    0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,
    0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,
    0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,
    0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,
    0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,
    0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa
  ];
  const acLen = 2 + 1 + 16 + acLumaValues.length;
  pushU16(acLen);
  push(0x10); // AC table 0
  buf.push(...acLumaCodes);
  buf.push(...acLumaValues);

  // SOS
  push(0xff, 0xda);
  pushU16(8); // length = 2 + 1 + 1*(2) + 3
  push(0x01); // 1 component in scan
  push(0x01, 0x00); // component 1, DC table 0 / AC table 0
  push(0x00, 0x3f, 0x00); // Ss=0, Se=63, Ah=0 Al=0

  // Encode a solid gray image.
  // For a solid-color image, every 8x8 block has DC = grayValue - 128, all ACs = 0.
  // DC encoding: difference from previous = grayValue - 128 for first block, 0 for rest.
  // We need a simple bit-stream writer.

  const nBlocksX = Math.ceil(width / 8);
  const nBlocksY = Math.ceil(height / 8);
  const totalBlocks = nBlocksX * nBlocksY;

  // Build huffman tables for encoding
  // DC luma huffman (code lengths from dcLumaCodes, values from dcLumaValues)
  const dcHuff = buildHuffTable(dcLumaCodes, dcLumaValues);
  const acHuff = buildHuffTable(acLumaCodes, acLumaValues);

  const bits = [];
  let prevDC = 0;

  for (let i = 0; i < totalBlocks; i++) {
    const dc = Math.round((grayValue / 255) * 255 - 128);
    const diff = dc - prevDC;
    prevDC = dc;

    // Encode DC coefficient
    encodeDC(diff, dcHuff, bits);
    // Encode AC coefficients: all zeros → EOB (0x00)
    const eobCode = acHuff[0x00];
    for (const b of eobCode) bits.push(b);
  }

  // Pad bits to byte boundary with 1s
  while (bits.length % 8 !== 0) bits.push(1);

  // Pack bits into bytes with byte-stuffing (0xff → 0xff 0x00)
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    push(byte);
    if (byte === 0xff) push(0x00);
  }

  // EOI
  push(0xff, 0xd9);

  return Buffer.from(buf);
}

function buildHuffTable(codeLengths, codeValues) {
  // Returns map from symbol -> bit array
  const table = {};
  let code = 0;
  let valIdx = 0;
  for (let len = 1; len <= 16; len++) {
    const count = codeLengths[len - 1];
    for (let i = 0; i < count; i++) {
      const sym = codeValues[valIdx++];
      const bits = [];
      for (let b = len - 1; b >= 0; b--) bits.push((code >> b) & 1);
      table[sym] = bits;
      code++;
    }
    code <<= 1;
  }
  return table;
}

function encodeDC(diff, dcHuff, bits) {
  // Category = number of bits needed to represent diff
  const cat = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
  const huffCode = dcHuff[cat];
  if (!huffCode) return; // shouldn't happen for well-formed input
  for (const b of huffCode) bits.push(b);
  if (cat > 0) {
    // Append 'cat' bits of the coefficient
    const val = diff < 0 ? diff - 1 : diff;
    for (let b = cat - 1; b >= 0; b--) bits.push((val >> b) & 1);
  }
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, single color)
// ---------------------------------------------------------------------------

function makePng(width, height, r, g, b, a = 255) {
  // PNG structure: signature + IHDR + IDAT + IEND
  // We use zlib deflate with stored blocks (no compression) for simplicity.

  const crc32Table = buildCrc32Table();

  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = [...type].map(c => c.charCodeAt(0));
    const len = data.length;
    const lenBytes = [(len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
    const crcData = [...typeBytes, ...data];
    const crc = crc32(crcData);
    return [
      ...lenBytes,
      ...typeBytes,
      ...data,
      (crc >> 24) & 0xff, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff
    ];
  }

  // IHDR
  const ihdr = [
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    8,  // bit depth
    2,  // color type: RGB (use 6 for RGBA)
    0, 0, 0 // compression, filter, interlace
  ];
  // Use RGBA (color type 6) for maskable icon
  const ihdrRgba = [
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    8,  // bit depth
    6,  // color type: RGBA
    0, 0, 0
  ];

  const useAlpha = a < 255;
  const bytesPerPixel = useAlpha ? 4 : 3;
  const selectedIhdr = useAlpha ? ihdrRgba : ihdr;

  // Raw image data: each row is [filter_byte, pixel_data...]
  const rowSize = 1 + width * bytesPerPixel;
  const rawData = new Uint8Array(height * rowSize);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    rawData[base] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const off = base + 1 + x * bytesPerPixel;
      rawData[off] = r;
      rawData[off + 1] = g;
      rawData[off + 2] = b;
      if (useAlpha) rawData[off + 3] = a;
    }
  }

  // Deflate with stored blocks (BTYPE=00, no compression)
  const deflated = deflateStored(rawData);

  // zlib wrapper: CMF=0x78 (deflate, window 32K), FLG, data, Adler-32
  const adler = adler32(rawData);
  const zlibData = [
    0x78, 0x01,
    ...deflated,
    (adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff
  ];

  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    ...chunk('IHDR', selectedIhdr),
    ...chunk('IDAT', zlibData),
    ...chunk('IEND', []),
  ];

  return Buffer.from(png);
}

function deflateStored(data) {
  // DEFLATE stored blocks (no compression): split into 65535-byte chunks
  const BLOCK_SIZE = 65535;
  const out = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + BLOCK_SIZE, data.length);
    const isLast = end >= data.length ? 1 : 0;
    const len = end - offset;
    const nlen = (~len) & 0xffff;
    out.push(
      isLast,              // BFINAL | BTYPE=00
      len & 0xff, (len >> 8) & 0xff,
      nlen & 0xff, (nlen >> 8) & 0xff,
      ...data.slice(offset, end)
    );
    offset = end;
  }
  return out;
}

function adler32(data) {
  let s1 = 1, s2 = 0;
  for (const b of data) {
    s1 = (s1 + b) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

console.log('Generating placeholder assets...');

const jpg = makeJpeg(100, 64, 20);
writeFileSync(join(root, 'assets', 'track.jpg'), jpg);
console.log(`  assets/track.jpg  (${jpg.length} bytes)`);

const icon192 = makePng(192, 192, 26, 26, 46);
writeFileSync(join(root, 'public', 'icons', 'icon-192.png'), icon192);
console.log(`  public/icons/icon-192.png  (${icon192.length} bytes)`);

const icon512 = makePng(512, 512, 26, 26, 46);
writeFileSync(join(root, 'public', 'icons', 'icon-512.png'), icon512);
console.log(`  public/icons/icon-512.png  (${icon512.length} bytes)`);

const iconMaskable = makePng(512, 512, 26, 26, 46, 255);
writeFileSync(join(root, 'public', 'icons', 'icon-maskable.png'), iconMaskable);
console.log(`  public/icons/icon-maskable.png  (${iconMaskable.length} bytes)`);

console.log('Done.');
