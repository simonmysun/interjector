import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import mimes from './mimes.ts';
import type {
  ServerOptions,
  Routes,
  RouteHandler,
  TranslationOptions,
  CompletionOptions,
} from './@types';
import { config, publicConfig, getCompletionPrompt } from './config.ts';
import { getTranslationProvider, TranslationError } from './translation-api.ts';
import { getCompletionProvider } from './completion-api.ts';
import { handleAsrUpgrade } from './asr-proxy.ts';

const globalOptions: ServerOptions = {
  port: config.server.port,
  host: config.server.host,
  key: config.server.keyPath ? fs.readFileSync(config.server.keyPath) : '',
  cert: config.server.certPath ? fs.readFileSync(config.server.certPath) : '',
  httpOnly: config.server.httpOnly,
};

const STATIC_DIR = path.resolve('./static');

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

/** Serve a static file, guarding against path traversal. */
const serveStatic = (res: http.ServerResponse, requestPath: string): void => {
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(STATIC_DIR, safePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found!');
      return;
    }
    const ext = filePath.split('.').pop() ?? '';
    res.writeHead(200, { 'Content-Type': mimes[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
};

const handleTranslate: RouteHandler = async (req, res) => {
  const payload = await readBody(req);
  if (!payload) {
    sendJson(res, 400, { error: 'Empty request body' });
    return;
  }
  let parsed: { text?: unknown };
  try {
    parsed = JSON.parse(payload);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (typeof parsed.text !== 'string' || parsed.text.length === 0) {
    sendJson(res, 400, { error: 'Missing text' });
    return;
  }

  // All translation config comes from the server environment; the client only
  // supplies the text to translate.
  const options: TranslationOptions = {
    text: parsed.text,
    sourceLanguage: config.translation.sourceLanguage,
    targetLanguage: config.translation.targetLanguage,
    backend: config.translation.backend,
    apiUrl: config.translation.apiUrl,
    apiKey: config.translation.apiKey,
    model: config.translation.model,
    prompt: config.translation.prompt,
  };

  try {
    const result = await getTranslationProvider(config.translation.backend).translate(options);
    sendJson(res, 200, result);
  } catch (error) {
    const status = error instanceof TranslationError ? error.status : 502;
    sendJson(res, status, { error: `Translation failed: ${(error as Error).message}` });
  }
};

const handleComplete: RouteHandler = async (req, res) => {
  const payload = await readBody(req);
  if (!payload) {
    sendJson(res, 400, { error: 'Empty request body' });
    return;
  }
  let parsed: { text?: unknown; presetId?: unknown };
  try {
    parsed = JSON.parse(payload);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  // An empty transcript is allowed (prompt-only completion), but the field, if
  // present, must be a string.
  if (parsed.text !== undefined && typeof parsed.text !== 'string') {
    sendJson(res, 400, { error: 'Invalid text' });
    return;
  }
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (!config.completion.model || !config.completion.apiUrl) {
    sendJson(res, 500, { error: 'Completion is not configured on the server (COMPLETION_MODEL / COMPLETION_API_URL).' });
    return;
  }

  // The client selects a prompt by its preset id; the prompt text itself never
  // leaves the server. Fall back to the single COMPLETION_PROMPT when no (valid)
  // preset is supplied, preserving the previous single-panel behaviour.
  const presetId = typeof parsed.presetId === 'string' ? parsed.presetId : undefined;
  const prompt = getCompletionPrompt(presetId) ?? config.completion.prompt;

  // All completion config comes from the server environment; the client only
  // supplies the transcript text and which preset to run.
  const options: CompletionOptions = {
    text,
    prompt,
    model: config.completion.model,
    apiUrl: config.completion.apiUrl,
    apiKey: config.completion.apiKey,
  };

  // Stream tokens back as newline-delimited JSON-encoded strings. JSON.stringify
  // escapes any newlines inside a token, so the literal '\n' frame delimiter
  // stays unambiguous and multi-line completions are preserved on the client.
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    await getCompletionProvider(options.model).complete(
      options,
      (token) => res.write(JSON.stringify(token) + '\n'),
      controller.signal,
    );
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      res.write(JSON.stringify(`ERR: ${(error as Error).message}`) + '\n');
    }
  } finally {
    res.end();
  }
};

const handleConfig: RouteHandler = (_req, res) => {
  // Expose only non-secret configuration to the browser (never API keys).
  sendJson(res, 200, publicConfig());
};

// Nested route table dispatched by `route()` below. Leaf values are handlers;
// nested objects represent path prefixes (e.g. `/api/*`). Static file requests
// are delegated to the `/static` handler.
const routes: Routes = {
  '/': (req, res) => (routes['/index.html'] as RouteHandler)(req, res),
  '/index.html': (req, res) => (routes['/static'] as RouteHandler)(req, res, '/index.html'),
  '/favicon.ico': (req, res) => (routes['/static'] as RouteHandler)(req, res, '/favicon.ico'),
  '/static': (_req, res, ...pathSegments) => serveStatic(res, pathSegments.join('')),
  '/api': {
    '/config': handleConfig,
    '/translate': handleTranslate,
    '/complete': handleComplete,
  },
};

/** Resolve a path (split into `/segment` parts) to a handler in the route tree. */
const route = (segments: string[], node: Routes | RouteHandler): RouteHandler => {
  if (typeof node === 'function') {
    return (req, res) => node(req, res, ...segments);
  }
  if (segments[0] !== undefined && segments[0] in node) {
    return route(segments.slice(1), node[segments[0]]);
  }
  // Unknown path: fall back to serving it as a static asset.
  return (_req, res) => serveStatic(res, segments.join(''));
};

const requestListener: http.RequestListener = (req, res) => {
  try {
    // Strip the query string before routing (e.g. `/api/translate?x=1`).
    const pathname = (req.url ?? '/').split('?')[0];
    const segments = pathname.split(/(?=\/)/);
    Promise.resolve(route(segments, routes)(req, res)).catch((error) => {
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal Server Error');
    });
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
};

process.on('uncaughtException', (err) => {
  console.error('Caught exception: ', err);
});

/** WebSocket upgrade handler: proxy /api/asr to Deepgram, reject anything else. */
const upgradeListener = (req: http.IncomingMessage, socket: import('node:stream').Duplex): void => {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  if (pathname === '/api/asr') {
    handleAsrUpgrade(req, socket);
    return;
  }
  socket.destroy();
};

let server: http.Server | https.Server;
if (globalOptions.httpOnly) {
  server = http.createServer(requestListener);
  server.listen(globalOptions.port, globalOptions.host, () => {
    console.log(`Server running at http://${globalOptions.host}:${globalOptions.port}/`);
  });
} else {
  if (!globalOptions.key || !globalOptions.cert) {
    console.error(
      'HTTPS requires KEY_PATH and CERT_PATH environment variables.\n' +
        'Generate a development certificate with `npm run gen-cert`, or set HTTP_ONLY=true ' +
        'and terminate TLS at a reverse proxy.',
    );
    process.exit(1);
  }
  server = https.createServer(
    { key: globalOptions.key, cert: globalOptions.cert },
    requestListener,
  );
  server.listen(globalOptions.port, globalOptions.host, () => {
    console.log(`Server running at https://${globalOptions.host}:${globalOptions.port}/`);
  });
}

server.on('upgrade', upgradeListener);
