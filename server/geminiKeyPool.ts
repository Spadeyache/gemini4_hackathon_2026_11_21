import * as fs from 'node:fs';
import * as path from 'node:path';

interface CachedDotEnv {
  mtimeMs: number;
  values: Record<string, string>;
}

let cachedDotEnv: CachedDotEnv | null = null;
let roundRobinCursor = 0;

function readHotDotEnv(projectRoot = process.cwd()): Record<string, string> {
  try {
    const envPath = path.resolve(projectRoot, '.env');
    if (!fs.existsSync(envPath)) return {};
    const stat = fs.statSync(envPath);
    if (cachedDotEnv && cachedDotEnv.mtimeMs === stat.mtimeMs) {
      return cachedDotEnv.values;
    }
    const raw = fs.readFileSync(envPath, 'utf-8');
    const parsed: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (k) parsed[k] = v;
    }
    cachedDotEnv = { mtimeMs: stat.mtimeMs, values: parsed };
    return parsed;
  } catch {
    return {};
  }
}

function isValidApiKeyCandidate(raw: string | undefined): raw is string {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length < 16) return false;
  if (/^(your_|insert_|placeholder|todo|<)/i.test(trimmed)) return false;
  return true;
}

/**
 * Collects all distinct configured Gemini API keys across `.env` (live-reloaded without server restart),
 * `viteEnv`, and `process.env`:
 * - `GEMINI_API_KEY`
 * - `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4`
 * - `GEMINI_BACKUP_API_KEY`
 * - `GEMINI_API_KEYS` (comma/semicolon/whitespace-separated pool)
 * - `GOOGLE_API_KEY`
 */
export function resolveGeminiKeyPool(
  viteEnv: Record<string, string> = {},
  projectRoot = process.cwd()
): string[] {
  const hotEnv = readHotDotEnv(projectRoot);
  const getVar = (name: string): string =>
    hotEnv[name] || viteEnv[name] || process.env[name] || '';

  const rawCandidates: string[] = [
    getVar('GEMINI_API_KEY'),
    getVar('GEMINI_API_KEY_2'),
    getVar('GEMINI_API_KEY_3'),
    getVar('GEMINI_API_KEY_4'),
    getVar('GEMINI_BACKUP_API_KEY'),
    ...getVar('GEMINI_API_KEYS').split(/[,;\s]+/),
    getVar('GOOGLE_API_KEY'),
  ];

  const uniqueKeys: string[] = [];
  const seen = new Set<string>();
  for (const candidate of rawCandidates) {
    if (!isValidApiKeyCandidate(candidate)) continue;
    const clean = candidate.trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      uniqueKeys.push(clean);
    }
  }
  return uniqueKeys;
}

/**
 * Picks the next healthy Gemini API key in round-robin order across the team's key pool.
 */
export function pickNextGeminiApiKey(
  viteEnv: Record<string, string> = {},
  projectRoot = process.cwd()
): string {
  const pool = resolveGeminiKeyPool(viteEnv, projectRoot);
  if (pool.length === 0) return '';
  const idx = roundRobinCursor % pool.length;
  roundRobinCursor = (roundRobinCursor + 1) % 1_000_000;
  return pool[idx];
}

/**
 * Executes an async Gemini SDK call with automatic multi-key round-robin & failover on 429 / quota / auth errors.
 */
export async function withGeminiKeyFailover<T>(
  viteEnv: Record<string, string>,
  fn: (apiKey: string) => Promise<T>,
  projectRoot = process.cwd()
): Promise<T> {
  const pool = resolveGeminiKeyPool(viteEnv, projectRoot);
  if (pool.length === 0) {
    throw new Error('No GEMINI_API_KEY configured in .env');
  }

  const startIdx = roundRobinCursor % pool.length;
  roundRobinCursor = (roundRobinCursor + 1) % 1_000_000;

  let lastError: unknown;
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const key = pool[(startIdx + attempt) % pool.length];
    try {
      return await fn(key);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetriableOnBackupKey =
        /429|quota|rate.?limit|resource_exhausted|403|permission_denied|api_key_invalid|503|overloaded/i.test(
          msg
        );
      if (!isRetriableOnBackupKey || attempt === pool.length - 1) {
        throw err;
      }
    }
  }
  throw lastError;
}
