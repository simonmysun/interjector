import fs from 'node:fs';
import path from 'node:path';
import type { CompletionPreset, TranslationBackend } from './@types';
import { isTranslationBackend } from './translation-api.ts';

/**
 * Server-side configuration, sourced entirely from environment variables
 * (typically a `.env` file loaded via `node --env-file`). The frontend no
 * longer holds any of this — it only captures audio and sends raw text. API
 * keys never leave the server.
 */

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;

/**
 * Derive a human-readable label from a prompt file name, e.g.
 * `10-background-knowledge.md` → `Background knowledge`. A leading numeric
 * ordering prefix (`10-`, `20_`, ...) is stripped, the extension is dropped,
 * and separators become spaces.
 */
function labelFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/^\d+\s*[-_.]?\s*/, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  if (!words) {
    return fileName;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Load completion prompt presets from a directory of `*.md` files. Files are
 * listed in file-name order (so a numeric prefix controls the on-screen order),
 * and each file's full contents become one preset's system prompt. The prompt
 * text itself is NEVER exposed to the browser — only `id` and `label` are (see
 * `publicConfig`). Returns an empty array when the directory is unset/missing.
 */
function loadCompletionPresets(): CompletionPreset[] {
  const configured = env('COMPLETION_PROMPTS_DIR', 'prompts');
  // The server runs with its CWD in dist/ (see package.json / dev.mjs), while
  // the prompts live at the repo root. For a relative path, try it as-is first
  // and then one level up, mirroring how the server loads `../.env`.
  const candidates = path.isAbsolute(configured)
    ? [configured]
    : [configured, path.join('..', configured)];
  let dir: string | undefined;
  let entries: string[] = [];
  for (const candidate of candidates) {
    try {
      entries = fs.readdirSync(candidate);
      dir = candidate;
      break;
    } catch {
      // Try the next candidate.
    }
  }
  if (dir === undefined) {
    return [];
  }
  const resolvedDir = dir;
  return entries
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => {
      const prompt = fs.readFileSync(path.join(resolvedDir, name), 'utf8').trim();
      return { id: name, label: labelFromFileName(name), prompt };
    })
    .filter((preset) => preset.prompt.length > 0);
}

function resolveTranslationBackend(): TranslationBackend {
  const value = env('TRANSLATION_BACKEND', 'free-google-translate');
  if (!isTranslationBackend(value)) {
    throw new Error(
      `Invalid TRANSLATION_BACKEND="${value}". Allowed: free-google-translate, ` +
        'google-translate, bing-translate, deepl-translate, openai-translate.',
    );
  }
  return value;
}

export const config = {
  server: {
    port: process.env.PORT === undefined ? 8000 : parseInt(process.env.PORT, 10),
    host: env('HOST', 'localhost'),
    httpOnly: process.env.HTTP_ONLY === 'true',
    keyPath: process.env.KEY_PATH,
    certPath: process.env.CERT_PATH,
  },

  translation: {
    sourceLanguage: env('TRANSLATION_SOURCE_LANGUAGE'),
    targetLanguage: env('TRANSLATION_TARGET_LANGUAGE'),
    backend: resolveTranslationBackend(),
    apiUrl: env('TRANSLATION_API_URL'),
    apiKey: env('TRANSLATION_API_KEY'),
    model: env('TRANSLATION_MODEL'),
    prompt: env('TRANSLATION_PROMPT'),
  },

  completion: {
    apiUrl: env('COMPLETION_API_URL'),
    apiKey: env('COMPLETION_API_KEY'),
    model: env('COMPLETION_MODEL'),
    // Fallback single prompt, used when no preset directory is configured or
    // when a request supplies no (valid) preset id.
    prompt: env('COMPLETION_PROMPT'),
    // Named prompt presets loaded from COMPLETION_PROMPTS_DIR. Each becomes its
    // own completion panel in the UI.
    presets: loadCompletionPresets(),
  },

  speech: {
    deepgramApiKey: env('DEEPGRAM_API_KEY'),
    deepgramModel: env('DEEPGRAM_MODEL', 'nova-3'),
    deepgramLanguage: env('DEEPGRAM_LANGUAGE', 'multi'),
    diarize: env('DEEPGRAM_DIARIZE', 'false') === 'true',
  },
} as const;

/**
 * Non-secret configuration exposed to the browser via `/api/config`. This must
 * never include API keys.
 */
export function publicConfig() {
  return {
    speech: {
      provider: 'deepgram' as const,
      diarize: config.speech.diarize,
      language: config.speech.deepgramLanguage,
    },
    translation: {
      sourceLanguage: config.translation.sourceLanguage,
      targetLanguage: config.translation.targetLanguage,
      backend: config.translation.backend,
    },
    completion: {
      // Expose only the preset id/label so the frontend can render one panel
      // (with its own button and scrollable history) per preset. The prompt
      // text stays on the server.
      presets: config.completion.presets.map(({ id, label }) => ({ id, label })),
    },
  };
}

/** Look up a completion preset's prompt by id; undefined when not found. */
export function getCompletionPrompt(presetId?: string): string | undefined {
  if (presetId === undefined) {
    return undefined;
  }
  return config.completion.presets.find((preset) => preset.id === presetId)?.prompt;
}
