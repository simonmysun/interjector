# Interjector

Interjector is a web application designed to enhance your communication experience. This tool offers a unique blend of features that can translate, summarize, and process your speech to provide a more comprehensive and engaging interaction. 

## Features

1. **Transcription**: Interjector generates a transcript of your speech from your microphone. 

2. **Translation & Summarization**: This feature can be particularly helpful when dealing with foreign languages or lengthy dialogues. 

3. **Completion with GPT**: Interjector can process the transcript using GPT models. This allows for potential insights, suggestions, or even jokes to be generated based on the context of the conversation.

## Potential Use Cases

1. **Language Learning**: Interjector can help you pick up new words and phrases in a foreign language. It can also assist in understanding and constructing sentences in a new language.

2. **Dialog Enhancement**: While listening to a dialog, such as during an interview or discussion, Interjector provides additional information to enrich your understanding of the topic.

3. **Humour Generation**: Interjector can generate related jokes based on the context of your conversation, helping you talk with humour and making your interactions more enjoyable.

## Getting Started

To get started with Interjector:

1. Clone this repository.
1. Install the dependencies via `npm install`.
1. Copy `.env.example` to `.env` and fill in your configuration (at minimum `DEEPGRAM_API_KEY` and the translation languages).
1. Run `npm run build`.
1. Run `npm start` (loads `.env`, serves from `./dist`).

All configuration lives in `.env` on the server. There is **no in-app settings
page**: API keys, languages, models and prompts are server-side and never sent
to the browser. The only thing chosen in the browser is which audio sources to
capture (microphones / computer output), since that requires user interaction.

Notes:

- Speech recognition uses [Deepgram](https://deepgram.com) streaming ASR: **multiple audio sources** (mix several microphones and/or computer/tab output), **multilingual** recognition (`DEEPGRAM_LANGUAGE=multi` for code-switching) and **speaker diarization (角色识别)** via `DEEPGRAM_DIARIZE=true`. Audio is proxied through this server's `/api/asr` WebSocket endpoint, which authenticates to Deepgram with a server-side `Authorization` header — this works in all browsers (browser-direct subprotocol auth is rejected by Firefox), and the key never leaves the server.
- Audio source selection (on the main page) lets you pick and mix one or more microphones plus computer/tab output. Output capture uses the browser screen/tab share prompt with "share audio" enabled — full system audio works on Chrome (Windows/ChromeOS); elsewhere it is usually limited to tab audio.
- Capturing microphone/output audio requires a secure context. `http://localhost` qualifies; for a non-localhost host use HTTPS. No certificate is bundled. For local HTTPS generate a self-signed cert with `npm run gen-cert` and set `KEY_PATH`/`CERT_PATH` with `HTTP_ONLY=false`. For production, supply your own certificate or set `HTTP_ONLY=true` and terminate TLS at a reverse proxy (Nginx/Caddy).

### Configuration

All settings are environment variables, placed in a `.env` file at the repo root
(see `.env.example` for the full list). `npm run dev` and `npm start` load `.env`
automatically (via Node's built-in `--env-file-if-exists`, no extra dependency).
`.env` is gitignored; do not commit secrets.

| Variable | Description |
|----------|-------------|
| `PORT` / `HOST` | Listen address (default `8000` / `localhost`). |
| `HTTP_ONLY` | `true` serves plain HTTP (TLS handled by a reverse proxy). |
| `KEY_PATH` / `CERT_PATH` | Required for HTTPS. No certificate is bundled. |
| `DEEPGRAM_API_KEY` | Deepgram key for the `/api/asr` proxy. Stays on the server. |
| `DEEPGRAM_MODEL` / `DEEPGRAM_LANGUAGE` | Model (default `nova-3`) and language (`multi` for multilingual). |
| `DEEPGRAM_DIARIZE` | `true` to enable speaker diarization (角色识别). |
| `TRANSLATION_SOURCE_LANGUAGE` / `TRANSLATION_TARGET_LANGUAGE` | BCP 47 language tags. |
| `TRANSLATION_BACKEND` | `free-google-translate` \| `google-translate` \| `bing-translate` \| `deepl-translate` \| `openai-translate`. |
| `TRANSLATION_API_URL` / `TRANSLATION_API_KEY` / `TRANSLATION_MODEL` / `TRANSLATION_PROMPT` | Per-backend translation settings. |
| `COMPLETION_API_URL` / `COMPLETION_API_KEY` / `COMPLETION_MODEL` | Optional LLM completion (the per-preset "Complete" buttons). |
| `COMPLETION_PROMPTS_DIR` | Directory of prompt presets — one `*.md` file per completion panel (default `prompts`). See [Completion prompts](#completion-prompts). |
| `COMPLETION_PROMPT` | Fallback single prompt, used only when `COMPLETION_PROMPTS_DIR` contains no prompts. |

All API keys are read from the environment on the server and are never returned to
the browser. The frontend sends only the text to translate/complete and the audio
to transcribe.

### Development

- `npm run dev` — one-command dev environment. Builds the frontend + backend bundles, copies static assets, starts the server, and watches for changes: frontend edits rebuild the client bundle, `frontend/public/*` edits re-copy static assets, and backend edits rebuild and automatically restart the server. Loads `.env` automatically. Defaults to `HTTP_ONLY=true` on `http://localhost:8000/`; override via `.env` or the shell, e.g. `PORT=8080 npm run dev`.
- `npm start` — run the built server from `dist/` for production-like use; loads `.env` from the repo root. Run `npm run build` first.
- `npm run check-deepgram-key` — verify the `DEEPGRAM_API_KEY` from `.env` (or the shell) is accepted by Deepgram.
- `npm run typecheck` — type-check the whole project.
- `npm test` — run the unit and integration tests (`node:test`).

## Configuration tips

- Use BCP 47 language tags for `TRANSLATION_SOURCE_LANGUAGE` / `TRANSLATION_TARGET_LANGUAGE`.
- `TRANSLATION_BACKEND=free-google-translate` needs no key; `google-translate` / `bing-translate` / `deepl-translate` each need their own `TRANSLATION_API_KEY`; `openai-translate` needs `TRANSLATION_MODEL` + `TRANSLATION_PROMPT`.
- For completion, set `COMPLETION_API_URL` + `COMPLETION_API_KEY` + `COMPLETION_MODEL` (+ `COMPLETION_PROMPT`). If the model starts with `gemini`, the URL is treated as Google Gemini style (e.g. `https://generativelanguage.googleapis.com/v1beta/models/`); otherwise OpenAI style.
- [Prompt Examples](./docs/prompt-examples.md) are provided to help you get started.

### Completion prompts

The right-hand column shows one completion panel per prompt preset, each with its
own **Complete** button and scrollable history. Presets are loaded from the
directory given by `COMPLETION_PROMPTS_DIR` (default `prompts/`): drop one
Markdown file per panel, e.g.

```
prompts/
  10-summarize.md
  20-background-knowledge.md
  30-possible-answer.md
  40-joke.md
```

- Files are shown in file-name order, so a numeric prefix (`10-`, `20-`, …)
  controls the on-screen order.
- The panel title is derived from the file name: the numeric prefix and `.md`
  extension are dropped and separators become spaces, e.g.
  `20-background-knowledge.md` → **Background knowledge**.
- The file's contents are the system prompt for that panel. Prompt text stays on
  the server; only the derived id/label is sent to the browser.
- If the directory is empty or unset, the single `COMPLETION_PROMPT` is used
  instead (one unnamed panel).

## Running with Docker

A `Dockerfile` is included; it builds the bundles and runs the server on plain
HTTP (`HTTP_ONLY=true`, `HOST=0.0.0.0`, `PORT=8000`) with TLS expected to be
terminated by a reverse proxy.

```sh
docker build -t interjector .
docker run --rm -p 8000:8000 --env-file .env interjector
```

The image does **not** bundle a `prompts/` directory, so completion panels are
empty unless you mount your prompts in. The server runs with its working
directory at `/app/dist`, and the default `COMPLETION_PROMPTS_DIR=prompts`
resolves to **`/app/dist/prompts`** (a `../prompts` fallback also covers
`/app/prompts`). Mount your host prompt directory there, read-only:

```sh
docker run --rm -p 8000:8000 \
  --env-file .env \
  -v "$(pwd)/prompts:/app/dist/prompts:ro" \
  interjector
```

To keep prompts somewhere else in the container, set `COMPLETION_PROMPTS_DIR` to
an absolute path and mount to match, e.g.
`-e COMPLETION_PROMPTS_DIR=/prompts -v "$(pwd)/prompts:/prompts:ro"`.

## Screenshot

Screenshot demonstrating interjector generating response while listening to an interview:

![Screenshot demonstrating interjector generating response while listening to an interview](https://raw.githubusercontent.com/simonmysun/interjector/master/docs/screenshots/1.png)


## TODO

1. More built-in streaming ASR providers (e.g. AssemblyAI, OpenAI realtime). The `SpeechRecognitionProvider` interface and a Deepgram provider are in place.
1. Multi-language UI.
1. More prompts.

## License
See [LICENSE](LICENSE).

