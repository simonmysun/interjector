export interface CompletionHandlers {
  onToken: (token: string) => void;
  onError?: (error: unknown) => void;
  /** Called once the stream finishes naturally or is aborted. */
  onDone?: () => void;
}

/**
 * Read an NDJSON stream body line by line, invoking `onLine` per complete line.
 */
async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
  if (!res.body) {
    throw new Error('Response has no body to stream.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? '' : decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop()!;
    for (const line of lines) {
      onLine(line);
    }
    if (done) {
      if (buffer) {
        onLine(buffer);
      }
      return;
    }
  }
}

/**
 * Run an LLM completion over the current transcript via the backend proxy. The
 * browser sends only the transcript; the model/prompt/key live on the server.
 * Returns an AbortController so the caller can cancel the stream.
 */
export function runCompletion(transcript: string, handlers: CompletionHandlers): AbortController {
  const controller = new AbortController();

  const work = (async () => {
    const res = await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Completion failed: ${res.status} ${res.statusText}`);
    }
    // The backend emits one JSON-encoded string per line (NDJSON), preserving
    // newlines inside tokens. Decode each frame back into its original text.
    await readLines(res, (line) => {
      if (line.length === 0) {
        return;
      }
      try {
        const token = JSON.parse(line);
        if (typeof token === 'string') {
          handlers.onToken(token);
        }
      } catch {
        // Ignore malformed frames.
      }
    });
  })();

  work
    .catch((error) => {
      if ((error as Error)?.name === 'AbortError') {
        return;
      }
      handlers.onError?.(error);
    })
    .finally(() => handlers.onDone?.());

  return controller;
}
