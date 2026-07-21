import type { CompletionOptions, CompletionProvider, CompletionStyle } from './@types';
import { LineBuffer, parseOpenAILine, GeminiStreamParser } from '../../shared/stream-parser.ts';

const detectStyle = (model: string): CompletionStyle =>
  model.startsWith('gemini') ? 'gemini' : 'openai';

/**
 * Iterate a fetch Response body line by line. Resolves when the stream ends.
 * Works in Node 18+ where `res.body` is a web ReadableStream.
 */
async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
  if (!res.body) {
    throw new Error('Upstream response has no body.');
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const lineBuffer = new LineBuffer();
  for (;;) {
    const { done, value } = await reader.read();
    const lines = done ? lineBuffer.flush() : lineBuffer.push(decoder.decode(value, { stream: true }));
    for (const line of lines) {
      onLine(line);
    }
    if (done) {
      return;
    }
  }
}

class OpenAICompletionProvider implements CompletionProvider {
  async complete(
    options: CompletionOptions,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${options.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.prompt },
          { role: 'user', content: options.text },
        ],
        stream: true,
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Upstream completion failed: ${res.status}`);
    }
    await readLines(res, (line) => {
      const delta = parseOpenAILine(line);
      if (delta) {
        onToken(delta);
      }
    });
  }
}

class GeminiCompletionProvider implements CompletionProvider {
  async complete(
    options: CompletionOptions,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${options.apiUrl}${options.model}:streamGenerateContent${options.apiKey ? `?key=${encodeURIComponent(options.apiKey)}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { 'x-goog-api-key': options.apiKey } : {}),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${options.prompt}\n\n${options.text}` }] }],
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Upstream completion failed: ${res.status}`);
    }
    const parser = new GeminiStreamParser();
    await readLines(res, (line) => {
      for (const token of parser.push(line)) {
        onToken(token);
      }
    });
  }
}

const providers: Record<CompletionStyle, CompletionProvider> = {
  openai: new OpenAICompletionProvider(),
  gemini: new GeminiCompletionProvider(),
};

export function getCompletionProvider(model: string): CompletionProvider {
  return providers[detectStyle(model)];
}

export { detectStyle };
