import * as THREE from 'three';
import type {
  InventedProductSpec,
  ProductCategory3D,
  ProductGraphicMotif,
} from '../../types/storeConfig';

export type MaterialFinishPreset = NonNullable<InventedProductSpec['materialFinish']>;

export interface ProductTextureSet {
  /** 1024×1024 studio graphic grounded on `spec.primaryColor` + tactile grain (SRGBColorSpace, anisotropy = 8) */
  frontMap: THREE.CanvasTexture;
  /** 1024×1024 transparent-background studio graphic ink/foil decal (SRGBColorSpace, anisotropy = 8) */
  decalMap: THREE.CanvasTexture;
  /** 512×512 archival cream cotton-rag apothecary / atelier label texture (SRGBColorSpace, anisotropy = 8) */
  archivalLabelMap: THREE.CanvasTexture;
  /** 256×256 tileable tangent-space surface/fabric normal map (NoColorSpace, RepeatWrapping) */
  normalMap: THREE.CanvasTexture;
  /** 256×256 tileable grayscale surface/fabric bump map (NoColorSpace, RepeatWrapping) */
  bumpMap: THREE.CanvasTexture;
  /** Resolved high-contrast studio inks guaranteed legible against `spec.primaryColor` */
  resolvedInkPrimary: string;
  resolvedInkAccent: string;
}

interface SurfaceMaps {
  normalMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

const MAX_PRODUCT_CACHE = 64;
const productTextureCache = new Map<string, ProductTextureSet>();
const surfaceMapCache = new Map<MaterialFinishPreset, SurfaceMaps>();

let sharedGrainCanvas: HTMLCanvasElement | null = null;

/**
 * Safely parses any CSS hex/color string into a THREE.Color with deterministic fallback.
 */
function safeColor(hex: string | undefined, fallbackHex: string): THREE.Color {
  const c = new THREE.Color();
  try {
    if (hex && hex.trim().length > 0) {
      c.set(hex.trim());
      return c;
    }
  } catch {
    // Fallback below
  }
  c.set(fallbackHex);
  return c;
}

/**
 * Computes WCAG relative luminance in linear RGB space.
 */
function getRelativeLuminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Computes WCAG contrast ratio (1..21) between two colors.
 */
function getContrastRatio(a: THREE.Color, b: THREE.Color): number {
  const la = getRelativeLuminance(a);
  const lb = getRelativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Ensures an ink color meets minimum legibility contrast against `bgColor`,
 * preserving brand hue/saturation whenever possible.
 */
function ensureContrastHex(
  candidateHex: string,
  bgColor: THREE.Color,
  minRatio: number,
  fallbackHex?: string
): string {
  const bgLum = getRelativeLuminance(bgColor);
  const cand = safeColor(candidateHex, bgLum < 0.36 ? '#F6F3EB' : '#18191B');
  if (getContrastRatio(cand, bgColor) >= minRatio) {
    return `#${cand.getHexString()}`;
  }

  if (fallbackHex) {
    const fb = safeColor(fallbackHex, bgLum < 0.36 ? '#F6F3EB' : '#18191B');
    if (getContrastRatio(fb, bgColor) >= minRatio) {
      return `#${fb.getHexString()}`;
    }
  }

  const hsl = { h: 0, s: 0, l: 0 };
  cand.getHSL(hsl);
  const adjusted = new THREE.Color();

  if (bgLum < 0.38) {
    // Dark background -> lift lightness cleanly while keeping subtle warm/brand tint
    for (let l = Math.max(0.72, hsl.l); l <= 0.96; l += 0.04) {
      adjusted.setHSL(hsl.h, Math.min(hsl.s, 0.38), l);
      if (getContrastRatio(adjusted, bgColor) >= minRatio) {
        return `#${adjusted.getHexString()}`;
      }
    }
    return '#F6F3EB';
  } else {
    // Light/mid background -> deepen ink cleanly while keeping rich pigment hue
    for (let l = Math.min(0.28, hsl.l); l >= 0.06; l -= 0.04) {
      adjusted.setHSL(hsl.h, Math.min(0.65, hsl.s * 1.1), l);
      if (getContrastRatio(adjusted, bgColor) >= minRatio) {
        return `#${adjusted.getHexString()}`;
      }
    }
    return '#17181A';
  }
}

function inferMaterialFinish(spec: InventedProductSpec): MaterialFinishPreset {
  if (spec.materialFinish) return spec.materialFinish;
  const byCat: Record<ProductCategory3D, MaterialFinishPreset> = {
    heavyweight_hoodie: 'brushed_fleece',
    structured_tshirt: 'combed_cotton',
    varsity_jacket: 'merino_knit',
    ceramic_mug: 'matte_stoneware',
    structured_cap: 'heavy_canvas',
    canvas_tote: 'heavy_canvas',
    hardcover_book: 'heavy_canvas',
    apothecary_bottle: 'frosted_glass',
  };
  return byCat[spec.category] ?? 'combed_cotton';
}

/**
 * Reusable 128×128 subtle micro-grain overlay pattern (built once per session in <0.4ms).
 */
function getSharedGrainCanvas(): HTMLCanvasElement {
  if (sharedGrainCanvas) return sharedGrainCanvas;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  const d = img.data;

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const idx = (y * 128 + x) * 4;
      const hash = ((x * 73856093) ^ (y * 19349663)) & 255;
      const weave = ((x + y) & 1) === 0 ? 14 : -14;
      const val = Math.max(0, Math.min(255, 128 + ((hash - 128) >> 2) + weave));
      d[idx] = val;
      d[idx + 1] = val;
      d[idx + 2] = val;
      d[idx + 3] = 16;
    }
  }
  ctx.putImageData(img, 0, 0);
  sharedGrainCanvas = c;
  return c;
}

/**
 * Generates and caches seamless 256×256 tangent-space normal + bump maps per `materialFinish`.
 * Computed at most once per finish preset (<1.5ms).
 */
export function getOrCreateFinishSurfaceMaps(finish: MaterialFinishPreset): SurfaceMaps {
  const cached = surfaceMapCache.get(finish);
  if (cached) return cached;

  const size = 256;
  const heights = new Float32Array(size * size);
  const twoPi = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const hash = (((x * 374761393 + y * 668265263) ^ (x * y * 1274126177)) >>> 0) / 4294967295;
      let h = 0.5;

      switch (finish) {
        case 'combed_cotton': {
          // Fine vertical jersey knit wales + micro cross-loop texture
          const wale = Math.sin(nx * twoPi * 48) * 0.24;
          const course = Math.sin(ny * twoPi * 64 + ((x & 1) * 1.2)) * 0.14;
          h = 0.5 + wale + course + (hash - 0.5) * 0.12;
          break;
        }
        case 'brushed_fleece': {
          // Heavyweight diagonal French-terry twill + soft brushed fleece loft
          const diag = Math.sin((nx * 36 + ny * 36) * twoPi) * 0.22;
          const loft = Math.sin(nx * twoPi * 18) * Math.cos(ny * twoPi * 18) * 0.16;
          h = 0.5 + diag + loft + (hash - 0.5) * 0.24;
          break;
        }
        case 'merino_knit': {
          // Tactile V-stitch merino rib columns
          const colPhase = (nx * 28) % 1;
          const vOffset = Math.abs(colPhase - 0.5) * 0.9;
          const stitch = Math.sin((ny * 34 + vOffset) * twoPi) * 0.28;
          const rib = Math.cos(nx * twoPi * 28) * 0.18;
          h = 0.5 + stitch + rib + (hash - 0.5) * 0.1;
          break;
        }
        case 'heavy_canvas': {
          // Crisp 1×1 plain-weave heavyweight duck canvas basket grid
          const warp = Math.sin(nx * twoPi * 40);
          const weft = Math.sin(ny * twoPi * 40);
          const overUnder = warp * weft * 0.12 + (Math.abs(warp) + Math.abs(weft)) * 0.18;
          h = 0.42 + overUnder + (hash - 0.5) * 0.14;
          break;
        }
        case 'matte_stoneware': {
          // Subtle horizontal wheel-thrown ceramic rings + fine mineral clay speckle
          const rings =
            Math.sin(ny * twoPi * 16) * 0.14 + Math.sin(ny * twoPi * 42) * 0.06;
          const mineralPit = hash > 0.965 ? -0.26 : (hash - 0.5) * 0.1;
          h = 0.5 + rings + mineralPit;
          break;
        }
        case 'frosted_glass': {
          // Satin acid-etched micro-frosting
          const micro =
            Math.sin(nx * twoPi * 60) * Math.sin(ny * twoPi * 60) * 0.06;
          h = 0.5 + micro + (hash - 0.5) * 0.18;
          break;
        }
      }

      heights[y * size + x] = Math.max(0, Math.min(1, h));
    }
  }

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(size, size);

  const normCanvas = document.createElement('canvas');
  normCanvas.width = size;
  normCanvas.height = size;
  const normCtx = normCanvas.getContext('2d')!;
  const normImg = normCtx.createImageData(size, size);

  const strength =
    finish === 'frosted_glass' ? 0.9 : finish === 'matte_stoneware' ? 1.4 : 2.2;

  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const idx = (y * size + x) * 4;

      const hVal = Math.round(heights[y * size + x] * 255);
      bumpImg.data[idx] = hVal;
      bumpImg.data[idx + 1] = hVal;
      bumpImg.data[idx + 2] = hVal;
      bumpImg.data[idx + 3] = 255;

      const dX = (heights[y * size + xp] - heights[y * size + xm]) * strength;
      const dY = (heights[yp * size + x] - heights[ym * size + x]) * strength;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1);

      normImg.data[idx] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      normImg.data[idx + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      normImg.data[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      normImg.data[idx + 3] = 255;
    }
  }

  bumpCtx.putImageData(bumpImg, 0, 0);
  normCtx.putImageData(normImg, 0, 0);

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 4;
  bumpMap.needsUpdate = true;

  const result = { normalMap, bumpMap };
  surfaceMapCache.set(finish, result);
  return result;
}

/**
 * Extracts crisp 1–2 character luxury monogram initials from headline/title.
 */
function extractMonogram(spec: InventedProductSpec): string {
  const source = (spec.graphicHeadline || spec.title || 'AB').trim();
  const words = source
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !['THE', 'AND', 'OF', 'FOR', 'BY', 'AT'].includes(w.toUpperCase()));

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return 'GC';
}

/**
 * Draws tracked uppercase/editorial text centered at `(cx, cy)`, automatically scaling font size
 * if the tracked string exceeds `maxWidth` so long headlines never clip or collide.
 */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  cx: number,
  cy: number,
  options: {
    fontWeight?: string | number;
    fontSize: number;
    fontFamily: string;
    tracking: number;
    maxWidth: number;
    color: string;
    align?: 'center' | 'left' | 'right';
  }
): void {
  const text = rawText.trim();
  if (!text) return;

  const weight = options.fontWeight ?? 600;
  let size = options.fontSize;
  let tracking = options.tracking;

  ctx.save();
  ctx.fillStyle = options.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const measureTracked = (sz: number, trk: number) => {
    ctx.font = `${weight} ${sz}px ${options.fontFamily}`;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      total += ctx.measureText(text[i]).width + (i < text.length - 1 ? trk : 0);
    }
    return total;
  };

  let totalWidth = measureTracked(size, tracking);
  if (totalWidth > options.maxWidth && totalWidth > 1) {
    const scale = Math.max(0.46, options.maxWidth / totalWidth);
    size = Math.round(size * scale);
    tracking = tracking * scale;
    totalWidth = measureTracked(size, tracking);
  }

  let cursorX =
    options.align === 'left'
      ? cx
      : options.align === 'right'
        ? cx - totalWidth
        : cx - totalWidth * 0.5;

  ctx.font = `${weight} ${size}px ${options.fontFamily}`;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, cy);
    cursorX += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();
}

/**
 * Draws circular arc text along a ring of `radius` centered at `(cx, cy)`.
 */
function drawArcText(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  cx: number,
  cy: number,
  radius: number,
  isTopArc: boolean,
  font: string,
  color: string,
  maxSpanRad = Math.PI * 0.78
): void {
  const text = rawText.trim().toUpperCase();
  if (!text) return;

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const charAngles = Array.from(text).map((ch) => Math.max(0.045, (ctx.measureText(ch).width + 5) / radius));
  const rawSpan = charAngles.reduce((a, b) => a + b, 0);
  const scale = rawSpan > maxSpanRad ? maxSpanRad / rawSpan : 1;

  if (isTopArc) {
    let angle = -Math.PI * 0.5 - (rawSpan * scale) * 0.5;
    for (let i = 0; i < text.length; i++) {
      const step = charAngles[i] * scale;
      const mid = angle + step * 0.5;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
      ctx.rotate(mid + Math.PI * 0.5);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      angle += step;
    }
  } else {
    let angle = Math.PI * 0.5 + (rawSpan * scale) * 0.5;
    for (let i = 0; i < text.length; i++) {
      const step = charAngles[i] * scale;
      const mid = angle - step * 0.5;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
      ctx.rotate(mid - Math.PI * 0.5);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      angle -= step;
    }
  }

  ctx.restore();
}

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const ang = (i * Math.PI) / 4 - Math.PI * 0.5;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Renders one of the 6 luxury `ProductGraphicMotif` studio designs onto a transparent 1024×1024 canvas.
 */
function renderStudioMotifArtwork(
  ctx: CanvasRenderingContext2D,
  spec: InventedProductSpec,
  inkPrimary: string,
  inkAccent: string
): void {
  const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
  const SANS = '"Inter", "Helvetica Neue", system-ui, -apple-system, sans-serif';
  const MONO = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';

  const headline = (spec.graphicHeadline || spec.title || 'ARCHIVE STUDIO').toUpperCase();
  const subtext = (spec.graphicSubtext || spec.subtitle || spec.sku || 'LIMITED EDITION').toUpperCase();
  const skuLabel = (spec.sku || 'ARC-01').toUpperCase();
  const monogram = extractMonogram(spec);
  const motif: ProductGraphicMotif = spec.graphicMotif || 'monogram_crest';

  ctx.clearRect(0, 0, 1024, 1024);

  switch (motif) {
    case 'monogram_crest': {
      const cx = 512;
      const cy = 438;

      // Double-ring framed shield medallion
      ctx.save();
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 174, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 158, 0, Math.PI * 2);
      ctx.stroke();

      // Inner heraldic crest shield silhouette
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 88, cy - 88);
      ctx.lineTo(cx + 88, cy - 88);
      ctx.lineTo(cx + 88, cy + 4);
      ctx.bezierCurveTo(cx + 88, cy + 76, cx + 28, cy + 114, cx, cy + 128);
      ctx.bezierCurveTo(cx - 28, cy + 114, cx - 88, cy + 76, cx - 88, cy + 4);
      ctx.closePath();
      ctx.stroke();

      // Symmetric laurel sprigs framing the crest
      for (const side of [-1, 1]) {
        ctx.strokeStyle = inkAccent;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let t = 0; t <= 20; t++) {
          const frac = t / 20;
          const ang = Math.PI * 0.5 + side * (0.22 + frac * 1.98);
          const lx = cx + Math.cos(ang) * 204;
          const ly = cy + Math.sin(ang) * 204;
          if (t === 0) ctx.moveTo(lx, ly);
          else ctx.lineTo(lx, ly);
        }
        ctx.stroke();

        // Laurel leaves along each arc
        ctx.fillStyle = inkPrimary;
        for (let k = 1; k <= 7; k++) {
          const frac = k / 8;
          const ang = Math.PI * 0.5 + side * (0.26 + frac * 1.88);
          const lx = cx + Math.cos(ang) * 204;
          const ly = cy + Math.sin(ang) * 204;
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(ang + side * 0.85);
          ctx.beginPath();
          ctx.ellipse(0, 0, 15, 5.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Three championship stars at crest crown
      drawFourPointStar(ctx, cx, cy - 122, 14, 4.5, inkAccent);
      drawFourPointStar(ctx, cx - 34, cy - 115, 9.5, 3.2, inkPrimary);
      drawFourPointStar(ctx, cx + 34, cy - 115, 9.5, 3.2, inkPrimary);

      // Large sculpted serif monogram initials
      ctx.fillStyle = inkPrimary;
      ctx.font = `700 116px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(monogram, cx, cy + 8);
      ctx.restore();

      // Editorial headline & tracked subtext below crest
      drawTrackedText(ctx, headline, cx, 694, {
        fontWeight: 700,
        fontSize: 50,
        fontFamily: SERIF,
        tracking: 7,
        maxWidth: 680,
        color: inkPrimary,
      });

      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 170, 740);
      ctx.lineTo(cx + 170, 740);
      ctx.stroke();

      drawTrackedText(ctx, subtext, cx, 778, {
        fontWeight: 600,
        fontSize: 23,
        fontFamily: SANS,
        tracking: 6,
        maxWidth: 640,
        color: inkPrimary,
      });

      drawTrackedText(ctx, `ARCHIVE NO. ${skuLabel}`, cx, 822, {
        fontWeight: 500,
        fontSize: 17,
        fontFamily: MONO,
        tracking: 4,
        maxWidth: 500,
        color: inkAccent,
      });
      break;
    }

    case 'geometric_grid': {
      const x0 = 202;
      const y0 = 196;
      const w = 620;
      const h = 632;

      ctx.save();
      // Outer Swiss modernist hairline box
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 3.5;
      ctx.strokeRect(x0, y0, w, h);

      // Internal modular divisions
      const row1 = y0 + 74;
      const row2 = y0 + 436;
      const row3 = y0 + 558;
      const colMid = x0 + 372;

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, row1);
      ctx.lineTo(x0 + w, row1);
      ctx.moveTo(x0, row2);
      ctx.lineTo(x0 + w, row2);
      ctx.moveTo(x0, row3);
      ctx.lineTo(x0 + w, row3);
      ctx.moveTo(colMid, row1);
      ctx.lineTo(colMid, row2);
      ctx.stroke();

      // Bauhaus / Linear bold accent block & precision circle geometry
      ctx.fillStyle = inkAccent;
      ctx.fillRect(colMid + 18, row1 + 18, x0 + w - colMid - 36, row2 - row1 - 36);

      // Negative-space geometric arc & crosshair inside left main viewport
      const gcx = x0 + 186;
      const gcy = (row1 + row2) * 0.5;
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(gcx, gcy, 122, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = inkPrimary;
      ctx.beginPath();
      ctx.moveTo(gcx, gcy);
      ctx.arc(gcx, gcy, 122, -Math.PI * 0.5, 0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(gcx, gcy, 68, 0, Math.PI * 2);
      ctx.stroke();

      // Precision coordinate crosshair ticks (+)
      const crossPts = [
        [x0, y0],
        [x0 + w, y0],
        [x0, y0 + h],
        [x0 + w, y0 + h],
        [gcx, gcy],
      ];
      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 2.4;
      for (const [px, py] of crossPts) {
        ctx.beginPath();
        ctx.moveTo(px - 12, py);
        ctx.lineTo(px + 12, py);
        ctx.moveTo(px, py - 12);
        ctx.lineTo(px, py + 12);
        ctx.stroke();
      }

      // Top technical header bar
      drawTrackedText(ctx, `SYS // ${skuLabel}`, x0 + 24, (y0 + row1) * 0.5, {
        fontWeight: 600,
        fontSize: 20,
        fontFamily: MONO,
        tracking: 3,
        maxWidth: 320,
        color: inkPrimary,
        align: 'left',
      });
      drawTrackedText(ctx, 'MOD. 01 — SPEC', x0 + w - 24, (y0 + row1) * 0.5, {
        fontWeight: 600,
        fontSize: 19,
        fontFamily: MONO,
        tracking: 3,
        maxWidth: 240,
        color: inkAccent,
        align: 'right',
      });

      // Bold Swiss sans headline
      drawTrackedText(ctx, headline, x0 + 26, (row2 + row3) * 0.5 + 2, {
        fontWeight: 800,
        fontSize: 48,
        fontFamily: SANS,
        tracking: 4,
        maxWidth: w - 52,
        color: inkPrimary,
        align: 'left',
      });

      // Bottom spec subtext row
      drawTrackedText(ctx, subtext, x0 + 26, (row3 + y0 + h) * 0.5, {
        fontWeight: 600,
        fontSize: 21,
        fontFamily: MONO,
        tracking: 4,
        maxWidth: w - 52,
        color: inkPrimary,
        align: 'left',
      });
      ctx.restore();
      break;
    }

    case 'botanical_line': {
      const cx = 512;

      ctx.save();
      // Minimalist arched apothecary botanical window frame
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(cx, 386, 184, Math.PI, 0, false);
      ctx.lineTo(cx + 184, 622);
      ctx.lineTo(cx - 184, 622);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, 386, 172, Math.PI, 0, false);
      ctx.lineTo(cx + 172, 610);
      ctx.lineTo(cx - 172, 610);
      ctx.closePath();
      ctx.stroke();

      // Graceful organic S-curve botanical stem
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 18, 588);
      ctx.bezierCurveTo(cx - 56, 488, cx + 62, 376, cx + 8, 252);
      ctx.stroke();

      // Secondary delicate offshoot branch
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx - 10, 466);
      ctx.bezierCurveTo(cx + 58, 444, cx + 96, 398, cx + 114, 344);
      ctx.stroke();

      // Sculpted organic leaves (alternating solid accent & fine-line veined leaves)
      const leaves: Array<{ x: number; y: number; rot: number; rx: number; ry: number; filled: boolean }> = [
        { x: cx - 54, y: 520, rot: -0.68, rx: 42, ry: 15, filled: false },
        { x: cx + 44, y: 500, rot: 0.55, rx: 38, ry: 14, filled: true },
        { x: cx - 52, y: 424, rot: -0.58, rx: 46, ry: 16, filled: true },
        { x: cx + 56, y: 382, rot: 0.48, rx: 44, ry: 15, filled: false },
        { x: cx - 36, y: 332, rot: -0.52, rx: 38, ry: 13, filled: false },
        { x: cx + 38, y: 294, rot: 0.54, rx: 34, ry: 12, filled: true },
        { x: cx + 4, y: 238, rot: -1.48, rx: 30, ry: 11, filled: false },
        { x: cx + 98, y: 374, rot: 0.35, rx: 30, ry: 11, filled: false },
      ];

      for (const lf of leaves) {
        ctx.save();
        ctx.translate(lf.x, lf.y);
        ctx.rotate(lf.rot);
        ctx.beginPath();
        ctx.moveTo(-lf.rx, 0);
        ctx.quadraticCurveTo(0, -lf.ry * 1.5, lf.rx, 0);
        ctx.quadraticCurveTo(0, lf.ry * 1.5, -lf.rx, 0);
        ctx.closePath();

        if (lf.filled) {
          ctx.fillStyle = inkAccent;
          ctx.fill();
        } else {
          ctx.strokeStyle = inkPrimary;
          ctx.lineWidth = 2.6;
          ctx.stroke();
          // Central leaf vein
          ctx.beginPath();
          ctx.moveTo(-lf.rx * 0.82, 0);
          ctx.lineTo(lf.rx * 0.78, 0);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Tiny botanical seed berries
      ctx.fillStyle = inkAccent;
      for (const [bx, by] of [
        [cx - 72, 376],
        [cx + 122, 336],
        [cx - 24, 278],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Aesop / Kinfolk editorial serif typography below arch
      drawTrackedText(ctx, headline, cx, 692, {
        fontWeight: 600,
        fontSize: 52,
        fontFamily: SERIF,
        tracking: 6,
        maxWidth: 680,
        color: inkPrimary,
      });

      drawTrackedText(ctx, subtext, cx, 752, {
        fontWeight: 500,
        fontSize: 22,
        fontFamily: SANS,
        tracking: 5.5,
        maxWidth: 640,
        color: inkPrimary,
      });

      drawTrackedText(ctx, `BOTANICAL FORMULATION · ${skuLabel}`, cx, 804, {
        fontWeight: 500,
        fontSize: 17,
        fontFamily: MONO,
        tracking: 3.5,
        maxWidth: 520,
        color: inkAccent,
      });
      break;
    }

    case 'minimal_typo': {
      const x0 = 192;
      const y0 = 292;
      const w = 640;
      const h = 440;
      const cx = 512;

      ctx.save();
      // High-fashion Acne / Jil Sander boxed atelier label frame
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 4;
      ctx.strokeRect(x0, y0, w, h);

      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0 + 14, y0 + 14, w - 28, h - 28);

      // 4 hand-tacked diagonal atelier corner stitches in accent color
      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const tackCorners = [
        [x0 - 8, y0 + 24, x0 + 24, y0 - 8],
        [x0 + w - 24, y0 - 8, x0 + w + 8, y0 + 24],
        [x0 - 8, y0 + h - 24, x0 + 24, y0 + h + 8],
        [x0 + w - 24, y0 + h + 8, x0 + w + 8, y0 + h - 24],
      ];
      for (const [ax, ay, bx, by] of tackCorners) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // Top metadata row
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x0 + 14, y0 + 82);
      ctx.lineTo(x0 + w - 14, y0 + 82);
      ctx.moveTo(x0 + 14, y0 + h - 94);
      ctx.lineTo(x0 + w - 14, y0 + h - 94);
      ctx.moveTo(cx, y0 + h - 94);
      ctx.lineTo(cx, y0 + h - 14);
      ctx.stroke();

      drawTrackedText(ctx, 'ATELIER ARCHIVE EDITION', cx, y0 + 48, {
        fontWeight: 600,
        fontSize: 19,
        fontFamily: MONO,
        tracking: 5,
        maxWidth: w - 80,
        color: inkAccent,
      });

      // Architectural central chest typography
      drawTrackedText(ctx, headline, cx, y0 + 196, {
        fontWeight: 700,
        fontSize: 64,
        fontFamily: SANS,
        tracking: 7,
        maxWidth: w - 84,
        color: inkPrimary,
      });

      drawTrackedText(ctx, subtext, cx, y0 + 278, {
        fontWeight: 500,
        fontSize: 23,
        fontFamily: SERIF,
        tracking: 5,
        maxWidth: w - 96,
        color: inkPrimary,
      });

      // Bottom split SKU & micro-serial cells
      drawTrackedText(ctx, `REF // ${skuLabel}`, x0 + w * 0.25 + 6, y0 + h - 54, {
        fontWeight: 600,
        fontSize: 19,
        fontFamily: MONO,
        tracking: 3,
        maxWidth: w * 0.44,
        color: inkPrimary,
      });
      drawTrackedText(ctx, 'LOT 001 · CERTIFIED', x0 + w * 0.75 - 6, y0 + h - 54, {
        fontWeight: 600,
        fontSize: 18,
        fontFamily: MONO,
        tracking: 2.5,
        maxWidth: w * 0.44,
        color: inkAccent,
      });
      ctx.restore();
      break;
    }

    case 'archival_seal': {
      const cx = 512;
      const cy = 496;
      const outerR = 278;
      const innerR = 192;

      ctx.save();
      // Concentric championship seal rings
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR - 14, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR - 12, 0, Math.PI * 2);
      ctx.stroke();

      // Curved circular path text along top & bottom seal band
      drawArcText(
        ctx,
        headline,
        cx,
        cy,
        (outerR - 14 + innerR) * 0.5,
        true,
        `700 31px ${SERIF}`,
        inkPrimary,
        Math.PI * 0.82
      );
      drawArcText(
        ctx,
        subtext,
        cx,
        cy,
        (outerR - 14 + innerR) * 0.5,
        false,
        `600 22px ${SANS}`,
        inkPrimary,
        Math.PI * 0.78
      );

      // Left & right star rosettes separating top/bottom seal text
      drawFourPointStar(ctx, cx - (outerR - 14 + innerR) * 0.5, cy, 14, 4.5, inkAccent);
      drawFourPointStar(ctx, cx + (outerR - 14 + innerR) * 0.5, cy, 14, 4.5, inkAccent);

      // Central heritage court / archive emblem
      ctx.strokeStyle = inkAccent;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 118, cy);
      ctx.lineTo(cx + 118, cy);
      ctx.moveTo(cx, cy - 118);
      ctx.lineTo(cx, cy + 118);
      ctx.stroke();

      ctx.fillStyle = inkPrimary;
      ctx.font = `700 108px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(monogram, cx, cy - 14);

      drawTrackedText(ctx, `EST · ${skuLabel}`, cx, cy + 72, {
        fontWeight: 600,
        fontSize: 20,
        fontFamily: MONO,
        tracking: 4,
        maxWidth: 230,
        color: inkAccent,
      });
      ctx.restore();
      break;
    }

    case 'orbital_rings': {
      const cx = 512;
      const cy = 442;

      ctx.save();
      // Concentric tilted futuristic orbital ellipses
      const orbits: Array<{ rx: number; ry: number; rot: number; dash: number[]; color: string; lw: number }> = [
        { rx: 268, ry: 96, rot: -0.38, dash: [], color: inkPrimary, lw: 3.4 },
        { rx: 244, ry: 112, rot: 0.42, dash: [], color: inkAccent, lw: 2.6 },
        { rx: 196, ry: 196, rot: 0, dash: [8, 8], color: inkPrimary, lw: 2 },
        { rx: 132, ry: 52, rot: -0.38, dash: [], color: inkPrimary, lw: 2 },
      ];

      for (const orb of orbits) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(orb.rot);
        ctx.strokeStyle = orb.color;
        ctx.lineWidth = orb.lw;
        ctx.setLineDash(orb.dash);
        ctx.beginPath();
        ctx.ellipse(0, 0, orb.rx, orb.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);

      // Polar axis line & central core
      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 228);
      ctx.lineTo(cx, cy + 228);
      ctx.moveTo(cx - 248, cy);
      ctx.lineTo(cx + 248, cy);
      ctx.stroke();

      ctx.fillStyle = inkAccent;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = inkPrimary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 32, 0, Math.PI * 2);
      ctx.stroke();

      // Technical orbital node markers
      const nodes = [
        [cx + 216, cy - 118, true],
        [cx - 218, cy + 114, false],
        [cx + 168, cy + 112, false],
        [cx - 142, cy - 134, true],
      ] as const;

      for (const [nx, ny, solid] of nodes) {
        if (solid) {
          ctx.fillStyle = inkAccent;
          ctx.beginPath();
          ctx.arc(nx, ny, 9.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = inkPrimary;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(nx, ny, 9.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Crisp geometric sans typography & telemetry readout below orbital field
      drawTrackedText(ctx, headline, cx, 724, {
        fontWeight: 700,
        fontSize: 54,
        fontFamily: SANS,
        tracking: 7,
        maxWidth: 690,
        color: inkPrimary,
      });

      drawTrackedText(ctx, subtext, cx, 780, {
        fontWeight: 500,
        fontSize: 22,
        fontFamily: SANS,
        tracking: 5.5,
        maxWidth: 650,
        color: inkPrimary,
      });

      drawTrackedText(ctx, `ORBITAL TELEMETRY // ${skuLabel}`, cx, 826, {
        fontWeight: 600,
        fontSize: 17,
        fontFamily: MONO,
        tracking: 4,
        maxWidth: 520,
        color: inkAccent,
      });
      break;
    }
  }
}

/**
 * Renders a 512×512 warm cotton-rag archival apothecary / studio packaging label
 * (ideal for apothecary glass bottles, luxury rigid boxes, and inner garment labels).
 */
function createArchivalLabelTexture(
  spec: InventedProductSpec,
  decalCanvas: HTMLCanvasElement
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const paperHex = '#F6F1E6';
  const paperColor = safeColor(paperHex, '#F6F1E6');
  const inkDark = ensureContrastHex('#1D1E1C', paperColor, 7.0);
  const inkAccent = ensureContrastHex(spec.accentColor, paperColor, 2.8, spec.secondaryColor);

  ctx.fillStyle = paperHex;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle cotton-rag fiber grain
  const grainPattern = ctx.createPattern(getSharedGrainCanvas(), 'repeat');
  if (grainPattern) {
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, 512, 512);
  }

  // Double hairline archival border
  ctx.strokeStyle = inkDark;
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 476, 476);
  ctx.strokeStyle = inkAccent;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(28, 28, 456, 456);

  // Top laboratory / atelier header band
  ctx.strokeStyle = inkDark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(28, 86);
  ctx.lineTo(484, 86);
  ctx.moveTo(28, 424);
  ctx.lineTo(484, 424);
  ctx.stroke();

  drawTrackedText(ctx, `FORMULATION // ${(spec.sku || 'ARC-01').toUpperCase()}`, 256, 58, {
    fontWeight: 600,
    fontSize: 15,
    fontFamily: '"JetBrains Mono", Consolas, monospace',
    tracking: 3,
    maxWidth: 410,
    color: inkDark,
  });

  // Composite scaled studio motif emblem cleanly into upper-middle window
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(decalCanvas, 116, 92, 280, 280);
  ctx.restore();

  // Crisp apothecary bottom specification lines
  drawTrackedText(
    ctx,
    (spec.graphicHeadline || spec.title || 'BOTANICAL ARCHIVE').toUpperCase(),
    256,
    394,
    {
      fontWeight: 700,
      fontSize: 24,
      fontFamily: 'Georgia, "Times New Roman", serif',
      tracking: 3,
      maxWidth: 420,
      color: inkDark,
    }
  );

  drawTrackedText(
    ctx,
    `${(spec.graphicSubtext || spec.subtitle || 'SMALL BATCH').toUpperCase()} · 100 ML / 3.4 FL.OZ.`,
    256,
    454,
    {
      fontWeight: 600,
      fontSize: 13,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      tracking: 2.2,
      maxWidth: 420,
      color: inkAccent,
    }
  );

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Synchronously generates and caches `1024×1024` luxury studio product graphics (`SRGBColorSpace`, `anisotropy = 8`)
 * plus seamless tactile surface normal/bump maps (`NoColorSpace`) in <5ms per new product (`0ms` on cache hit).
 */
export function getOrCreateProductTextures(spec: InventedProductSpec): ProductTextureSet {
  const finish = inferMaterialFinish(spec);
  const cacheKey = [
    spec.id,
    spec.sku,
    spec.category,
    spec.primaryColor,
    spec.secondaryColor,
    spec.accentColor,
    spec.graphicMotif,
    spec.graphicHeadline,
    spec.graphicSubtext ?? '',
    finish,
  ].join('|');

  const existing = productTextureCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  // LRU eviction guard for long interactive sessions
  if (productTextureCache.size >= MAX_PRODUCT_CACHE) {
    const oldestKey = productTextureCache.keys().next().value;
    if (oldestKey !== undefined) {
      const evicted = productTextureCache.get(oldestKey);
      evicted?.frontMap.dispose();
      evicted?.decalMap.dispose();
      evicted?.archivalLabelMap.dispose();
      productTextureCache.delete(oldestKey);
    }
  }

  const primaryBg = safeColor(spec.primaryColor, '#F2EFE9');
  const resolvedInkPrimary = ensureContrastHex(
    spec.secondaryColor,
    primaryBg,
    4.1,
    spec.accentColor
  );
  const resolvedInkAccent = ensureContrastHex(
    spec.accentColor,
    primaryBg,
    2.7,
    spec.secondaryColor
  );

  // 1. Render crisp 1024×1024 transparent-background studio motif decal
  const decalCanvas = document.createElement('canvas');
  decalCanvas.width = 1024;
  decalCanvas.height = 1024;
  const decalCtx = decalCanvas.getContext('2d')!;
  renderStudioMotifArtwork(decalCtx, spec, resolvedInkPrimary, resolvedInkAccent);

  const decalMap = new THREE.CanvasTexture(decalCanvas);
  decalMap.colorSpace = THREE.SRGBColorSpace;
  decalMap.anisotropy = 8;
  decalMap.needsUpdate = true;

  // 2. Compose 1024×1024 grounded studio graphic texture (`primaryColor` + tactile grain + motif)
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = 1024;
  frontCanvas.height = 1024;
  const frontCtx = frontCanvas.getContext('2d')!;

  frontCtx.fillStyle = `#${primaryBg.getHexString()}`;
  frontCtx.fillRect(0, 0, 1024, 1024);

  const grainPattern = frontCtx.createPattern(getSharedGrainCanvas(), 'repeat');
  if (grainPattern) {
    frontCtx.fillStyle = grainPattern;
    frontCtx.fillRect(0, 0, 1024, 1024);
  }

  frontCtx.drawImage(decalCanvas, 0, 0);

  const frontMap = new THREE.CanvasTexture(frontCanvas);
  frontMap.colorSpace = THREE.SRGBColorSpace;
  frontMap.anisotropy = 8;
  frontMap.needsUpdate = true;

  // 3. Compose 512×512 archival paper label texture for apothecary / book / woven tag details
  const archivalLabelMap = createArchivalLabelTexture(spec, decalCanvas);

  // 4. Shared cached surface weave/stoneware/glass normal & bump maps
  const { normalMap, bumpMap } = getOrCreateFinishSurfaceMaps(finish);

  const bundle: ProductTextureSet = {
    frontMap,
    decalMap,
    archivalLabelMap,
    normalMap,
    bumpMap,
    resolvedInkPrimary,
    resolvedInkAccent,
  };

  productTextureCache.set(cacheKey, bundle);
  return bundle;
}
