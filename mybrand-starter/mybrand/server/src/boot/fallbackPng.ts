import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function parseHexColor(
  hex: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!hex) return fallback;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return fallback;
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Pure TypeScript PNG encoder (no native deps) that produces a valid 256x256
 * palette-themed tile PNG when image generation fails twice.
 */
export function createPaletteFallbackPng(
  paletteHex: readonly string[] = [],
  options?: { width?: number; height?: number; seed?: number }
): Buffer {
  const width = options?.width ?? 256;
  const height = options?.height ?? 256;
  const seed = options?.seed ?? 0;

  const primary = parseHexColor(
    paletteHex[seed % Math.max(1, paletteHex.length)],
    [217, 201, 184]
  );
  const accent = parseHexColor(
    paletteHex[(seed + 1) % Math.max(1, paletteHex.length)],
    [163, 128, 102]
  );

  // Each scanline: 1 filter byte (0 = None) + width * 3 RGB bytes.
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  const border = Math.max(4, Math.floor(Math.min(width, height) * 0.04));

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    const tY = height > 1 ? y / (height - 1) : 0;

    for (let x = 0; x < width; x++) {
      const isBorder =
        x < border ||
        x >= width - border ||
        y < border ||
        y >= height - border;
      const tX = width > 1 ? x / (width - 1) : 0;
      const blend = isBorder ? 0.45 : 0.14 * tY + 0.08 * tX;

      const r = clampByte(primary[0] * (1 - blend) + accent[0] * blend);
      const g = clampByte(primary[1] * (1 - blend) + accent[1] * blend);
      const b = clampByte(primary[2] * (1 - blend) + accent[2] * blend);

      const offset = rowStart + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: Truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  const idat = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Sniffs actual image format from magic bytes so /data/:bootId/assets/:filename
 * returns an accurate Content-Type even if an image model returned JPEG or WebP bytes.
 */
export function detectImageMimeType(
  buffer: Buffer,
  filename?: string
): string {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }

  const head = buffer
    .subarray(0, Math.min(256, buffer.length))
    .toString("utf-8")
    .trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  const lower = filename?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}
