/**
 * Translate a piece of text via the backend proxy. The browser sends only the
 * text; all translation config (languages, backend, key, model, prompt) lives
 * in the server environment.
 */
export async function translate(text: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Translation failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}
