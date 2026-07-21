// Quick standalone check for a Deepgram API key.
//
// Usage:
//   DEEPGRAM_API_KEY=your_key node scripts/check-deepgram-key.mjs
//
// It calls a lightweight authenticated endpoint and reports whether the key is
// accepted. This isolates "bad key" from "browser/WebSocket/network" issues
// when the in-app Deepgram provider fails to connect.

const key = (process.env.DEEPGRAM_API_KEY ?? '').trim();
if (!key) {
  console.error('Set DEEPGRAM_API_KEY first, e.g. DEEPGRAM_API_KEY=xxxx node scripts/check-deepgram-key.mjs');
  process.exit(2);
}

try {
  const res = await fetch('https://api.deepgram.com/v1/auth/token', {
    headers: { Authorization: `Token ${key}` },
  });
  if (res.ok) {
    console.log('OK: Deepgram accepted the API key. The key is valid.');
    process.exit(0);
  }
  const body = await res.text();
  console.error(`FAILED: Deepgram rejected the key (HTTP ${res.status}).`);
  console.error(body);
  process.exit(1);
} catch (err) {
  console.error('Network error reaching Deepgram:', err.message);
  process.exit(3);
}
