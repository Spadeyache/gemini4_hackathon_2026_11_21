import { loadEnv, type Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import type { StoreConfig } from '../src/types/storeConfig';

/**
 * Official Gemini 4 + Gemini Decision 1 (`@google/genai` >= 3.2.0) Vite Server Plugin
 *
 * Exposes `POST /api/decisions-eval`:
 *  1. Evaluates all shopper personas' calibrated P(BUY) (`type: "noul"`) + optimal store mutation
 *     (`type: "choice"`) in ONE SINGLE PASS via `ai.decisions.create({ model: "gemini-decision-1" })` (`v1beta`, 0 output tokens!).
 *  2. Optionally accepts a live 3D WebGL viewport JPEG/PNG (`screenshotBase64`) so `gemini-decision-1`
 *     scores visual clutter, lighting warmth, and merchandising directly from the rendered 3D shop!
 *  3. Calls `gemini-4-hydrogen` (`ai.interactions.create`) for fast persona thought blurbs,
 *     with automatic calibrated fallback when `GEMINI_API_KEY` is not yet configured.
 */
export interface PersonaEvalInput {
  id: string;
  name: string;
  roleTag: string;
  priceCeiling: number;
}

export interface DecisionsEvalRequest {
  storeConfig: StoreConfig;
  personas: PersonaEvalInput[];
  /** Optional base64 image (without data: prefix) of the rendered 3D WebGL canvas */
  screenshotBase64?: string;
  screenshotMimeType?: string;
}

export function gemini4DecisionsVitePlugin(): Plugin {
  let viteEnv: Record<string, string> = {};

  return {
    name: 'gemini-4-decisions-api-plugin',
    configResolved(config) {
      try {
        viteEnv = loadEnv(config.mode, config.root, '');
      } catch {
        viteEnv = {};
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/decisions-eval') || req.method !== 'POST') {
          next();
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as DecisionsEvalRequest;
          const { storeConfig, personas, screenshotBase64, screenshotMimeType } = body;

          const apiKey = (
            viteEnv.GEMINI_API_KEY ||
            process.env.GEMINI_API_KEY ||
            viteEnv.GOOGLE_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            ''
          ).trim();

          const decisionsModel =
            viteEnv.GEMINI_DECISIONS_MODEL ||
            process.env.GEMINI_DECISIONS_MODEL ||
            'gemini-decision-1';
          const swarmModel =
            viteEnv.GEMINI_SWARM_MODEL || process.env.GEMINI_SWARM_MODEL || 'gemini-4-hydrogen';

          if (!apiKey) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                usedGeminiDecisions: false,
                message: 'Set GEMINI_API_KEY in .env to enable live gemini-decision-1 calibration.',
              })
            );
            return;
          }

          // 1. Build shared multimodal input (Store JSON summary + optional live 3D WebGL render!)
          const heroItem = storeConfig.racks[0]?.items[0];
          const storeSummaryText = JSON.stringify({
            brandName: storeConfig.brandName,
            vibe: storeConfig.vibe,
            lightingPreset: storeConfig.lightingPreset,
            palette: storeConfig.palette,
            racks: storeConfig.racks.map((r) => ({
              label: r.label,
              style: r.style,
              items: r.items.map((i) => ({ title: i.title, price: i.price, featured: i.featured })),
            })),
          });

          const sharedInput: Array<
            | { type: 'text'; text: string }
            | { type: 'image'; data: string; mime_type: string }
          > = [
            {
              type: 'text',
              text: `3D Retail Boutique Scene & Merchandising State:\n${storeSummaryText}`,
            },
          ];

          if (screenshotBase64) {
            sharedInput.push({
              type: 'image',
              data: screenshotBase64.replace(/^data:image\/\w+;base64,/, ''),
              mime_type: screenshotMimeType || 'image/jpeg',
            });
          }

          // 2. Single-pass calibrated evaluation across ALL personas + mutation router via `gemini-decision-1` (`v1beta`)
          const decisionsAi = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
          const questions: Record<string, any> = {
            recommended_mutation: {
              type: 'choice',
              instructions:
                'Which single 3D store mutation will yield the largest shopper conversion increase given the current visual merchandising, pricing, and lighting?',
              criteria: {
                swap_hero_sku:
                  'Promote a stronger, higher-appeal capsule garment onto the front Centre Court hero stand',
                adjust_lighting:
                  'Switch gallery lighting temperature and contrast to better flatter the garment palette',
                declutter_aisle:
                  'Reduce visual clutter by focusing the hero rail on fewer statement pieces',
                reprice:
                  'Apply a 12% introductory capsule price adjustment to overcome budget resistance',
              },
            },
          };

          for (const p of personas) {
            questions[`buy_${p.id}`] = {
              type: 'noul',
              instructions: `Shopper Persona: ${p.name} (${p.roleTag}), budget ceiling $${p.priceCeiling}. Inspecting hero item "${heroItem?.title ?? 'Featured Garment'}" ($${heroItem?.price ?? 68}) inside this 3D boutique. Will this shopper decide YES to buy?`,
            };
          }

          const [decisionRes, thoughtRes] = await Promise.all([
            decisionsAi.decisions.create({
              model: decisionsModel,
              input: sharedInput,
              questions,
            }),
            new GoogleGenAI({ apiKey }).interactions
              .create({
                model: swarmModel,
                input: `Given this 3D boutique:\n${storeSummaryText}\nWrite one ultra-short (<12 words) first-person shopper reaction per persona (${personas
                  .map((p) => `${p.id}: ${p.name}/${p.roleTag}/max $${p.priceCeiling}`)
                  .join('; ')}) as a flat JSON object mapping persona id to string.`,
              })
              .catch(() => null),
          ]);

          let thoughtMap: Record<string, string> = {};
          if (thoughtRes?.output_text) {
            try {
              const cleaned = thoughtRes.output_text
                .replace(/^```json\s*/i, '')
                .replace(/\s*```$/, '')
                .trim();
              thoughtMap = JSON.parse(cleaned) as Record<string, string>;
            } catch {
              thoughtMap = {};
            }
          }

          const personaScores: Record<
            string,
            { buyProbability: number; confidence: number; decision: 'BUY' | 'SKIP'; thought?: string }
          > = {};

          for (const p of personas) {
            const ans = decisionRes.answers?.[`buy_${p.id}`];
            const prob = ans && ans.type === 'noul' ? ans.noul : 0.5;
            const conf = ans ? ans.confidence : 0.5;
            personaScores[p.id] = {
              buyProbability: prob,
              confidence: conf,
              decision: prob >= 0.5 ? 'BUY' : 'SKIP',
              thought: thoughtMap[p.id],
            };
          }

          const mutAns = decisionRes.answers?.recommended_mutation;
          const mutation =
            mutAns && mutAns.type === 'choice'
              ? {
                  choice: mutAns.choice,
                  confidence: mutAns.confidence,
                  probabilities: mutAns.probabilities,
                }
              : null;

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              usedGeminiDecisions: true,
              modelsUsed: {
                decisions: decisionsModel,
                swarmThoughts: swarmModel,
              },
              personaScores,
              mutation,
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              usedGeminiDecisions: false,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      });
    },
  };
}
