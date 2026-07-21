import type { TranslationBackend } from './@types';
import { isTranslationBackend } from './translation-api.ts';

/**
 * Server-side configuration, sourced entirely from environment variables
 * (typically a `.env` file loaded via `node --env-file`). The frontend no
 * longer holds any of this — it only captures audio and sends raw text. API
 * keys never leave the server.
 */

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;

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
    prompt: env('COMPLETION_PROMPT'),
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
  };
}
