import type {
  TranslationOptions,
  TranslationResult,
  TranslationProvider,
  TranslationBackend,
  ChatCompletion,
} from './@types';

/**
 * Error carrying an HTTP status so the route can map provider failures to a
 * sensible response code (e.g. 400 for misconfiguration vs 502 for upstream).
 */
export class TranslationError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'TranslationError';
    this.status = status;
  }
}

/** Two-letter primary subtag, e.g. "en-US" -> "en". */
const langPrefix = (lang: string): string => lang.trim().slice(0, 2).toLowerCase();

/** Require a config value, throwing a 400-style error when missing. */
function require_(value: string | undefined, name: string): string {
  if (!value || !value.trim()) {
    throw new TranslationError(`Translation is misconfigured: ${name} is required.`, 400);
  }
  return value;
}

/** Parse a fetch response as JSON, surfacing upstream errors clearly. */
async function readJson<T>(res: Response, provider: string): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new TranslationError(`${provider} upstream error ${res.status}: ${snippet}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new TranslationError(`${provider} returned non-JSON response: ${snippet}`);
  }
}

/**
 * Free Google translate endpoint (undocumented dict-chrome-ex client).
 * No API key required.
 */
class FreeGoogleTranslationProvider implements TranslationProvider {
  async translate(options: TranslationOptions): Promise<TranslationResult> {
    const sl = langPrefix(require_(options.sourceLanguage, 'TRANSLATION_SOURCE_LANGUAGE'));
    const tl = langPrefix(require_(options.targetLanguage, 'TRANSLATION_TARGET_LANGUAGE'));

    const url = new URL(options.apiUrl || 'https://translate.google.com/translate_a/single');
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', sl);
    url.searchParams.set('tl', tl);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', options.text);
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('oe', 'UTF-8');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    // Response shape: [[["translated","source",...], ...], ...]
    const parsed = await readJson<unknown>(res, 'free-google-translate');
    const segments: string[] = [];
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      for (const chunk of parsed[0] as unknown[]) {
        if (Array.isArray(chunk) && typeof chunk[0] === 'string') {
          segments.push(chunk[0]);
        }
      }
    }
    if (segments.length === 0) {
      throw new TranslationError('free-google-translate returned no translation.');
    }
    return { text: segments.join('') };
  }
}

/**
 * Official Google Cloud Translation API (v2 REST).
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */
class GoogleTranslationProvider implements TranslationProvider {
  async translate(options: TranslationOptions): Promise<TranslationResult> {
    const apiKey = require_(options.apiKey, 'TRANSLATION_API_KEY (google-translate)');
    const target = langPrefix(require_(options.targetLanguage, 'TRANSLATION_TARGET_LANGUAGE'));
    const base = options.apiUrl || 'https://translation.googleapis.com/language/translate/v2';

    const res = await fetch(`${base}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: options.text,
        // `source` is optional for Google; omit it when not provided to allow
        // auto-detection.
        ...(options.sourceLanguage ? { source: langPrefix(options.sourceLanguage) } : {}),
        target,
        format: 'text',
      }),
    });
    const data = await readJson<{
      data?: { translations?: { translatedText: string }[] };
    }>(res, 'google-translate');
    const text = data.data?.translations?.[0]?.translatedText;
    if (text === undefined) {
      throw new TranslationError('google-translate returned no translation.');
    }
    return { text };
  }
}

/**
 * Microsoft Azure / Bing Translator (v3).
 * https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate
 */
class BingTranslationProvider implements TranslationProvider {
  async translate(options: TranslationOptions): Promise<TranslationResult> {
    const apiKey = require_(options.apiKey, 'TRANSLATION_API_KEY (bing-translate)');
    const to = langPrefix(require_(options.targetLanguage, 'TRANSLATION_TARGET_LANGUAGE'));
    const base = options.apiUrl || 'https://api.cognitive.microsofttranslator.com';

    const url = new URL(`${base}/translate`);
    url.searchParams.set('api-version', '3.0');
    if (options.sourceLanguage) {
      url.searchParams.set('from', langPrefix(options.sourceLanguage));
    }
    url.searchParams.set('to', to);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      body: JSON.stringify([{ Text: options.text }]),
    });
    const data = await readJson<{ translations?: { text: string }[] }[]>(res, 'bing-translate');
    const text = data[0]?.translations?.[0]?.text;
    if (text === undefined) {
      throw new TranslationError('bing-translate returned no translation.');
    }
    return { text };
  }
}

/**
 * DeepL translation API.
 * https://developers.deepl.com/docs/api-reference/translate
 */
class DeepLTranslationProvider implements TranslationProvider {
  async translate(options: TranslationOptions): Promise<TranslationResult> {
    const apiKey = require_(options.apiKey, 'TRANSLATION_API_KEY (deepl-translate)');
    const target = langPrefix(require_(options.targetLanguage, 'TRANSLATION_TARGET_LANGUAGE')).toUpperCase();
    const base = options.apiUrl || 'https://api-free.deepl.com/v2';

    const res = await fetch(`${base}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${apiKey}`,
      },
      body: JSON.stringify({
        text: [options.text],
        ...(options.sourceLanguage
          ? { source_lang: langPrefix(options.sourceLanguage).toUpperCase() }
          : {}),
        target_lang: target,
      }),
    });
    const data = await readJson<{ translations?: { text: string }[] }>(res, 'deepl-translate');
    const text = data.translations?.[0]?.text;
    if (text === undefined) {
      throw new TranslationError('deepl-translate returned no translation.');
    }
    return { text };
  }
}

/** Translate via an OpenAI-style chat completion using a prompt. */
class OpenAITranslationProvider implements TranslationProvider {
  async translate(options: TranslationOptions): Promise<TranslationResult> {
    const apiUrl = require_(options.apiUrl, 'TRANSLATION_API_URL (openai-translate)');
    const model = require_(options.model, 'TRANSLATION_MODEL (openai-translate)');
    const prompt = require_(options.prompt, 'TRANSLATION_PROMPT (openai-translate)');

    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: options.text },
        ],
      }),
    });
    const completion = await readJson<ChatCompletion>(res, 'openai-translate');
    const choice = completion.choices?.[0];
    if (!choice) {
      throw new TranslationError('openai-translate returned no choices.');
    }
    if (choice.finish_reason && choice.finish_reason !== 'stop') {
      throw new TranslationError(`openai-translate stopped early: ${choice.finish_reason}`);
    }
    return { text: choice.message.content };
  }
}

const providers: Record<TranslationBackend, TranslationProvider> = {
  'free-google-translate': new FreeGoogleTranslationProvider(),
  'google-translate': new GoogleTranslationProvider(),
  'bing-translate': new BingTranslationProvider(),
  'deepl-translate': new DeepLTranslationProvider(),
  'openai-translate': new OpenAITranslationProvider(),
};

export const TRANSLATION_BACKENDS = Object.keys(providers) as TranslationBackend[];

export function isTranslationBackend(value: unknown): value is TranslationBackend {
  return typeof value === 'string' && (TRANSLATION_BACKENDS as string[]).includes(value);
}

export function getTranslationProvider(backend: TranslationBackend): TranslationProvider {
  return providers[backend];
}
