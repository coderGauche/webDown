import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ICON_SIZES = [16, 32, 48, 128];
const SAMPLE_GRID = 4;

const colors = {
  navy: [20, 33, 61, 255],
  white: [255, 255, 255, 255],
  mint: [33, 198, 154, 255],
  transparent: [0, 0, 0, 0],
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function isInsideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;

  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius));

  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(x, y, startX, startY, endX, endY) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const projection = Math.max(
    0,
    Math.min(1, ((x - startX) * segmentX + (y - startY) * segmentY) / lengthSquared),
  );
  const closestX = startX + projection * segmentX;
  const closestY = startY + projection * segmentY;

  return Math.hypot(x - closestX, y - closestY);
}

function sampleIcon(x, y) {
  let color = colors.transparent;

  if (isInsideRoundedRect(x, y, 0.0625, 0.0625, 0.9375, 0.9375, 0.1875)) {
    color = colors.navy;
  }

  const arrowDistance = Math.min(
    distanceToSegment(x, y, 0.5, 0.234, 0.5, 0.609),
    distanceToSegment(x, y, 0.5, 0.609, 0.352, 0.461),
    distanceToSegment(x, y, 0.5, 0.609, 0.648, 0.461),
  );

  if (arrowDistance <= 0.039) {
    color = colors.white;
  }

  if (isInsideRoundedRect(x, y, 0.273, 0.711, 0.727, 0.789, 0.039)) {
    color = colors.mint;
  }

  return color;
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const sampleCount = SAMPLE_GRID * SAMPLE_GRID;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let sampleY = 0; sampleY < SAMPLE_GRID; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLE_GRID; sampleX += 1) {
          const x = (pixelX + (sampleX + 0.5) / SAMPLE_GRID) / size;
          const y = (pixelY + (sampleY + 0.5) / SAMPLE_GRID) / size;
          const [sampleRed, sampleGreen, sampleBlue, sampleAlpha] = sampleIcon(x, y);

          alpha += sampleAlpha;
          red += sampleRed * sampleAlpha;
          green += sampleGreen * sampleAlpha;
          blue += sampleBlue * sampleAlpha;
        }
      }

      const offset = (pixelY * size + pixelX) * 4;
      const averagedAlpha = alpha / sampleCount;

      pixels[offset] = alpha === 0 ? 0 : Math.round(red / alpha);
      pixels[offset + 1] = alpha === 0 ? 0 : Math.round(green / alpha);
      pixels[offset + 2] = alpha === 0 ? 0 : Math.round(blue / alpha);
      pixels[offset + 3] = Math.round(averagedAlpha);
    }
  }

  return pixels;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const rowLength = size * 4 + 1;
  const scanlines = Buffer.alloc(rowLength * size);

  for (let row = 0; row < size; row += 1) {
    const targetOffset = row * rowLength;
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, row * size * 4, (row + 1) * size * 4);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir('public', { recursive: true });

for (const size of ICON_SIZES) {
  const outputPath = `public/icon-${size}.png`;
  const png = encodePng(size, renderRgba(size));
  await writeFile(outputPath, png);
  console.info(`Generated ${outputPath}`);
}
