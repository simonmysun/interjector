/**
 * Pure, transport-agnostic parsers for streamed LLM responses. Kept free of any
 * I/O so they can be unit-tested directly (see tests/).
 */

/** A small incremental buffer that yields complete newline-delimited lines. */
export class LineBuffer {
  private buffer = '';

  /** Push a chunk; returns any complete lines that became available. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  /** Flush the trailing partial line (call when the stream ends). */
  flush(): string[] {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining ? [remaining] : [];
  }
}

/** Extract the text delta from one OpenAI SSE line, or null if none. */
export function parseOpenAILine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]') {
    return null;
  }
  try {
    const content = JSON.parse(trimmed.replace(/^data: /, ''));
    const delta = content?.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : null;
  } catch {
    return null;
  }
}

/**
 * Incremental parser for Gemini's `streamGenerateContent` JSON-array stream.
 *
 * Gemini returns a single JSON array whose elements arrive progressively. We
 * scan the byte stream tracking brace depth (ignoring braces inside strings) so
 * we can extract each top-level array element the moment it closes, regardless
 * of how the response is chunked or whitespace-formatted.
 */
export class GeminiStreamParser {
  private buffer = '';

  /** Feed an arbitrary chunk (line or partial); returns any decoded token texts. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const tokens: string[] = [];

    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectStart = -1;

    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        if (depth === 0) {
          objectStart = i;
        }
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objectStart >= 0) {
          const slice = this.buffer.slice(objectStart, i + 1);
          try {
            const data = JSON.parse(slice);
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text === 'string') {
              tokens.push(text);
            }
          } catch {
            // Should not happen for a balanced object, but stay defensive.
          }
          // Drop everything up to and including this object from the buffer.
          this.buffer = this.buffer.slice(i + 1);
          i = -1;
          objectStart = -1;
        }
      }
    }
    return tokens;
  }
}
