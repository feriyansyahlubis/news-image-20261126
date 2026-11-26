// main.ts — World News in One Image, 26 November 2026.
//
// Writes /output/entry.png deterministically: no network, no randomness.
// The image itself is rendered by render.py (Pillow) and committed as
// entry.png; this script validates that PNG thoroughly and then copies it
// to /output/entry.png.
//
// Validation (fails with a clear error if anything is wrong):
//   - PNG signature (8 bytes)
//   - IHDR chunk first, with width/height exactly 1024x1024, 8-bit
//     truecolour (colour type 2), no interlacing
//   - full chunk chain parses cleanly through IEND (length + CRC per chunk)
//   - at least one IDAT chunk, and the IDAT payload inflates to exactly
//     the bytes of a 1024x1024 RGB image (proves the image data is
//     complete, not just a well-formed container)
//   - file size at most 1 MiB
//
// Run:  node main.ts        (writes /output/entry.png)
//       node main.ts out    (writes <cwd>/out/entry.png — local testing)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "entry.png");

const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : "/output";
const DEST = join(outDir, "entry.png");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024;
const EXPECTED_W = 1024;
const EXPECTED_H = 1024;

// CRC-32 (IEEE) over a Buffer, no dependencies.
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fail(msg: string): never {
  throw new Error(`invalid entry.png: ${msg}`);
}

function validatePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("bad PNG signature");
  }
  if (bytes.length > MAX_BYTES) {
    fail(`file is ${bytes.length} bytes, over the 1 MiB limit`);
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let seenIEND = false;
  let seenIDAT = false;
  let first = true;
  const idatParts: Buffer[] = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.subarray(off + 4, off + 8).toString("ascii");
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) {
      fail(`chunk ${type} at offset ${off} is truncated`);
    }
    const storedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([bytes.subarray(off + 4, off + 8), bytes.subarray(dataStart, dataEnd)]));
    if (storedCrc !== actualCrc) {
      fail(`chunk ${type} at offset ${off} has a bad CRC`);
    }
    if (first) {
      if (type !== "IHDR") fail("first chunk is not IHDR");
      if (len !== 13) fail(`IHDR length is ${len}, expected 13`);
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colourType = bytes[dataStart + 9];
      const interlace = bytes[dataStart + 12];
      if (bitDepth !== 8 || colourType !== 2) {
        fail(`expected 8-bit truecolour (RGB) image, got bit depth ${bitDepth}, colour type ${colourType}`);
      }
      if (interlace !== 0) {
        fail(`expected non-interlaced PNG, got interlace method ${interlace}`);
      }
      first = false;
    }
    if (type === "IDAT") {
      seenIDAT = true;
      idatParts.push(bytes.subarray(dataStart, dataEnd));
    }
    if (type === "IEND") {
      if (len !== 0) fail("IEND chunk has data");
      if (dataEnd + 4 !== bytes.length) fail("trailing bytes after IEND");
      seenIEND = true;
      break;
    }
    off = dataEnd + 4;
  }
  if (!seenIEND) fail("no IEND chunk — chunk chain is incomplete");
  if (!seenIDAT) fail("no IDAT chunk — PNG carries no image data");
  if (width !== EXPECTED_W || height !== EXPECTED_H) {
    fail(`dimensions are ${width}x${height}, expected ${EXPECTED_W}x${EXPECTED_H}`);
  }
  // The pixel data must inflate to exactly one filter byte + 1024 RGB
  // pixels per scanline, for 1024 scanlines. A truncated or corrupt IDAT
  // stream fails here even if every chunk CRC is intact.
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idatParts));
  } catch (err) {
    fail(`IDAT data does not decompress: ${(err as Error).message}`);
  }
  const expectedRaw = EXPECTED_H * (1 + EXPECTED_W * 3);
  if (raw.length !== expectedRaw) {
    fail(`decompressed image data is ${raw.length} bytes, expected ${expectedRaw} for a 1024x1024 RGB image`);
  }
  return { width, height };
}

if (!existsSync(SRC)) {
  throw new Error(`source image missing: ${SRC}`);
}
const bytes = readFileSync(SRC);
if (bytes.length === 0) {
  throw new Error("source image is empty");
}
const { width, height } = validatePng(bytes);
mkdirSync(outDir, { recursive: true });
copyFileSync(SRC, DEST);
console.log(`wrote ${DEST} (${bytes.length} bytes, ${width}x${height}, PNG valid)`);
