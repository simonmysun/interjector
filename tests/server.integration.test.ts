import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '../backend/src/server.ts');
const PORT = 8123;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess;

async function waitForServer(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await fetch(`${BASE}/index.html`);
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Server did not start in time');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

test.before(async () => {
  server = spawn(
    process.execPath,
    ['--experimental-strip-types', serverEntry],
    {
      cwd: path.resolve(__dirname, '../dist'),
      // A controlled, minimal env so the server config is deterministic. Note
      // completion is intentionally left unconfigured to assert the 500 path.
      env: {
        PATH: process.env.PATH,
        HTTP_ONLY: 'true',
        PORT: String(PORT),
        HOST: 'localhost',
        TRANSLATION_SOURCE_LANGUAGE: 'en',
        TRANSLATION_TARGET_LANGUAGE: 'de',
        TRANSLATION_BACKEND: 'free-google-translate',
      },
      stdio: 'ignore',
    },
  );
  await waitForServer();
});

test.after(() => {
  server?.kill();
});

test('/api/config exposes non-secret config and no keys', async () => {
  const res = await fetch(`${BASE}/api/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.translation.sourceLanguage, 'en');
  assert.equal(body.translation.targetLanguage, 'de');
  assert.equal(body.translation.backend, 'free-google-translate');
  assert.equal(body.speech.provider, 'deepgram');
  // Must never leak secrets.
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('Key'), false);
});

test('rejects translate with empty body', async () => {
  const res = await fetch(`${BASE}/api/translate`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('rejects translate with missing text', async () => {
  const res = await fetch(`${BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notText: 'x' }),
  });
  assert.equal(res.status, 400);
});

test('rejects translate with invalid JSON', async () => {
  const res = await fetch(`${BASE}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});

test('complete returns 500 when not configured on the server', async () => {
  const res = await fetch(`${BASE}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /not configured/);
});

test('rejects complete with missing text', async () => {
  const res = await fetch(`${BASE}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notText: 'x' }),
  });
  assert.equal(res.status, 400);
});

test('unknown POST route returns 404', async () => {
  const res = await fetch(`${BASE}/api/nope`, { method: 'POST' });
  assert.equal(res.status, 404);
});
