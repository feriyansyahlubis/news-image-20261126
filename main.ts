// main.ts — World News in One Image, 26 November 2026.
//
// Writes /output/entry.png deterministically: no network, no randomness.
// The image itself is rendered by render.py (Pillow) and committed as
// entry.png; this script copies that validated PNG to /output/entry.png.
//
// Run:  node main.ts        (writes /output/entry.png)
//       node main.ts out    (writes <cwd>/out/entry.png — local testing)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "entry.png");

const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : "/output";
const DEST = join(outDir, "entry.png");

if (!existsSync(SRC)) {
  throw new Error(`source image missing: ${SRC}`);
}
const bytes = readFileSync(SRC);
if (bytes.length === 0) {
  throw new Error("source image is empty");
}
mkdirSync(outDir, { recursive: true });
copyFileSync(SRC, DEST);
console.log(`wrote ${DEST} (${bytes.length} bytes)`);
