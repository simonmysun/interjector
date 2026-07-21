import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketConnection } from './ws.ts';
import { config } from './config.ts';

/**
 * WebSocket proxy: browser <-> this server <-> Deepgram.
 *
 * Why a proxy: browsers cannot set the `Authorization` header on a WebSocket,
 * and Deepgram's documented browser auth (the API key as a Sec-WebSocket-Protocol
 * subprotocol) is rejected by some browsers (notably Firefox, which enforces the
 * RFC 7230 token grammar on subprotocol values). Proxying lets us authenticate
 * to Deepgram server-side with a clean `Authorization: Token` header that works
 * for every browser, and keeps the key entirely off the client.
 *
 * The recognition settings (model, language, diarization) come from the server
 * environment. Only the audio-format params (encoding, sample_rate, channels),
 * which must match the bytes the browser actually sends, are taken from the
 * client request.
 */

const DEEPGRAM_HOST = 'api.deepgram.com';

// Audio-format params the client may set (they describe its own PCM stream).
const CLIENT_AUDIO_PARAMS = new Set(['encoding', 'sample_rate', 'channels']);

function buildUpstreamUrl(reqUrl: URL): string {
  const params = new URLSearchParams();
  // Audio format: trust the client, since it produced the audio.
  for (const [key, value] of reqUrl.searchParams) {
    if (CLIENT_AUDIO_PARAMS.has(key)) {
      params.set(key, value);
    }
  }
  // Recognition settings: server-controlled.
  params.set('model', config.speech.deepgramModel);
  params.set('language', config.speech.deepgramLanguage);
  params.set('interim_results', 'true');
  params.set('smart_format', 'true');
  if (config.speech.diarize) {
    params.set('diarize', 'true');
  }
  return `wss://${DEEPGRAM_HOST}/v1/listen?${params.toString()}`;
}

/**
 * Handle an HTTP upgrade for `/api/asr`. Returns true if it consumed the
 * upgrade (so the caller knows not to fall through).
 */
export function handleAsrUpgrade(req: IncomingMessage, socket: Duplex): boolean {
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const apiKey = config.speech.deepgramApiKey;

  const client = WebSocketConnection.accept(req, socket);
  if (!client) {
    return true;
  }

  if (!apiKey) {
    client.sendText(
      JSON.stringify({
        type: 'Error',
        error: 'No Deepgram API key configured on the server (set DEEPGRAM_API_KEY).',
      }),
    );
    client.close(1008);
    return true;
  }

  // Node 18+/26 ships a global WebSocket client; use it for the upstream leg.
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(buildUpstreamUrl(reqUrl), {
      // Node's undici WebSocket accepts headers via the (non-standard) options arg.
      headers: { Authorization: `Token ${apiKey}` },
    } as unknown as string[]);
  } catch (error) {
    client.sendText(
      JSON.stringify({ type: 'Error', error: `Upstream connect failed: ${(error as Error).message}` }),
    );
    client.close(1011);
    return true;
  }

  upstream.binaryType = 'arraybuffer';

  // Buffer client audio that arrives before the upstream socket is open.
  const pending: Buffer[] = [];
  let upstreamOpen = false;

  upstream.addEventListener('open', () => {
    upstreamOpen = true;
    for (const chunk of pending) {
      upstream.send(chunk);
    }
    pending.length = 0;
  });
  upstream.addEventListener('message', (event: MessageEvent) => {
    // Deepgram sends JSON text frames; forward them verbatim to the browser.
    if (typeof event.data === 'string') {
      client.sendText(event.data);
    }
  });
  upstream.addEventListener('close', () => client.close());
  upstream.addEventListener('error', () => {
    client.sendText(JSON.stringify({ type: 'Error', error: 'Upstream Deepgram connection error.' }));
    client.close(1011);
  });

  client.onMessage((data, isBinary) => {
    if (isBinary) {
      if (upstreamOpen) {
        upstream.send(data);
      } else {
        pending.push(data);
      }
    } else {
      // Control messages (KeepAlive / CloseStream) pass straight through.
      if (upstreamOpen) {
        upstream.send(data.toString('utf8'));
      }
    }
  });

  client.onClose(() => {
    try {
      upstream.close();
    } catch {
      // already closed
    }
  });

  return true;
}
