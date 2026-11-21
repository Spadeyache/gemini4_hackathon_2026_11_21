import type { StoreConfig } from '../types/storeConfig';

/**
 * Milestone 2–4 Multi-Model Pipeline Interfaces (Gemini 4 + Decisions API + Shopify)
 * Ready to wire directly once your hackathon Gemini 4 API key / shop.dev token are added.
 */
export interface BrandExtractionResult {
  storeConfig: StoreConfig;
  extractedPaletteHex: string[];
  detectedCategory: string;
  confidence: number;
}

export interface SyntheticShopperReaction {
  personaId: string;
  personaName: string;
  archetype:
    | 'Minimalist Aesthetics'
    | 'Vintage Collector'
    | 'Budget Hunter'
    | 'Impulse Gift Buyer'
    | 'Skeptical First-Timer';
  decision: 'buy' | 'skip' | 'bounce';
  score: number;
  thought: string;
  suggestedMutation?:
    | 'swap_hero_sku'
    | 'declutter_aisle'
    | 'adjust_lighting'
    | 'reprice';
}

/**
 * Extracts dominant garment & trim palette directly from an uploaded image canvas
 * so dropping ANY new brand image can dynamically re-theme a custom Brand DNA room!
 */
export function extractLivePaletteFromImage(img: HTMLImageElement): {
  dominantBody: string;
  accentTrim: string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dominantBody: '#F3EFE6', accentTrim: '#547049' };
  }
  ctx.drawImage(img, 0, 0, 96, 96);
  const { data } = ctx.getImageData(0, 0, 96, 96);
  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];

  let bodyR = 0,
    bodyG = 0,
    bodyB = 0,
    bodyCount = 0;
  let accentR = 84,
    accentG = 112,
    accentB = 73,
    maxSat = -1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const distBg =
      (r - bgR) * (r - bgR) + (g - bgG) * (g - bgG) + (b - bgB) * (b - bgB);
    if (distBg < 900) continue; // skip background

    bodyR += r;
    bodyG += g;
    bodyB += b;
    bodyCount++;

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    if (sat > maxSat && maxC > 45 && minC < 220) {
      maxSat = sat;
      accentR = r;
      accentG = g;
      accentB = b;
    }
  }

  const toHex = (r: number, g: number, b: number) =>
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('');

  if (bodyCount === 0) {
    return { dominantBody: '#F3EFE6', accentTrim: '#547049' };
  }

  return {
    dominantBody: toHex(bodyR / bodyCount, bodyG / bodyCount, bodyB / bodyCount),
    accentTrim: toHex(accentR, accentG, accentB),
  };
}
