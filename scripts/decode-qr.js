'use strict';
// Lokální ověření obsahu PNG; obrázky se nikam neodesílají.
// node scripts/decode-qr.js cesta.png [dalsi.png ...]
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
if (process.argv.length < 3) {
  console.error('Použití: node scripts/decode-qr.js cesta.png [dalsi.png ...]');
  process.exitCode = 1;
}
for (const filename of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(filename));
  const count = path.basename(filename) === 'QR_excel_3_kody.png' ? 3 : 1;
  for (let region = 0; region < count; region++) {
    const left = Math.floor(region * png.width / count);
    const width = Math.floor((region + 1) * png.width / count) - left;
    const bytes = new Uint8ClampedArray(width * png.height * 4);
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < width; x++) {
        const source = (y * png.width + x + left) * 4;
        const target = (y * width + x) * 4;
        const alpha = png.data[source + 3] / 255;
        for (let channel = 0; channel < 3; channel++) bytes[target + channel] = png.data[source + channel] * alpha + 255 * (1 - alpha);
        bytes[target + 3] = 255;
      }
    }
    const result = jsQR(bytes, width, png.height);
    console.log(JSON.stringify({ file: path.basename(filename), region: region + 1, text: result?.data ?? null, bytes: result?.binaryData ?? null }));
    if (!result) process.exitCode = 1;
  }
}
