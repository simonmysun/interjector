// Single-command dev environment.
//
// `npm run dev` will:
//   1. Build the frontend + backend bundles and copy static assets once.
//   2. Watch frontend sources and rebuild `main.bundle.js`.
//   3. Watch `frontend/public/*` and re-copy static assets.
//   4. Watch backend sources, rebuild `server.bundle.js`, and (re)start the
//      Node server process automatically.
//
// No extra dependencies: uses esbuild's JS API plus Node's built-ins, matching
// the project's no-framework constraint.

import esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const staticDir = path.join(distDir, 'static');
const publicDir = path.join(root, 'frontend', 'public');

// Server environment. Defaults to HTTP-only on localhost (a secure context for
// the Web Speech API), but every value can be overridden from the shell.
const serverEnv = {
  ...process.env,
  HTTP_ONLY: process.env.HTTP_ONLY ?? 'true',
  PORT: process.env.PORT ?? '8000',
  HOST: process.env.HOST ?? 'localhost',
};

function log(scope, message) {
  console.log(`[dev:${scope}] ${message}`);
}

async function copyPublic() {
  await fsp.mkdir(staticDir, { recursive: true });
  const entries = await fsp.readdir(publicDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map((e) => fsp.copyFile(path.join(publicDir, e.name), path.join(staticDir, e.name))),
  );
}

let serverProcess = null;
let restartTimer = null;

function startServer() {
  // The .env at the repo root is already loaded into this process (via the
  // npm `dev` script's --env-file-if-exists) and forwarded through serverEnv.
  // We also pass --env-file-if-exists to the child so it works even if dev.mjs
  // is launched directly without the npm wrapper. The child runs in dist/, so
  // the path is relative to that.
  serverProcess = spawn(
    process.execPath,
    ['--env-file-if-exists=../.env', 'server.bundle.js'],
    {
      cwd: distDir,
      env: serverEnv,
      stdio: 'inherit',
    },
  );
  serverProcess.on('exit', (code, signal) => {
    // Ignore exits we triggered ourselves during a restart.
    if (signal !== 'SIGTERM' && code !== null && code !== 0) {
      log('backend', `server exited with code ${code}`);
    }
  });
}

function restartServer() {
  // Debounce: a rebuild may fire several change events in quick succession.
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (serverProcess && serverProcess.exitCode === null) {
      const old = serverProcess;
      serverProcess = null;
      old.once('exit', () => startServer());
      old.kill('SIGTERM');
    } else {
      startServer();
    }
    log('backend', 'restarting server');
  }, 100);
}

// Re-copy static assets whenever a file under public/ changes.
function watchPublic() {
  fs.watch(publicDir, { persistent: true }, (_event, filename) => {
    copyPublic()
      .then(() => log('static', `copied public assets (${filename ?? 'change'})`))
      .catch((err) => log('static', `copy failed: ${err.message}`));
  });
}

async function main() {
  // Clean + initial static copy.
  await fsp.rm(staticDir, { recursive: true, force: true });
  await copyPublic();

  const frontendCtx = await esbuild.context({
    entryPoints: [path.join(root, 'frontend/src/main.ts')],
    bundle: true,
    sourcemap: true,
    outdir: staticDir,
    entryNames: '[name].bundle',
    platform: 'browser',
    logLevel: 'info',
  });

  const backendCtx = await esbuild.context({
    entryPoints: [path.join(root, 'backend/src/server.ts')],
    bundle: true,
    sourcemap: true,
    outfile: path.join(distDir, 'server.bundle.js'),
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'info',
    plugins: [
      {
        name: 'restart-server',
        setup(build) {
          let first = true;
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              log('backend', 'build failed, not restarting');
              return;
            }
            if (first) {
              first = false;
              startServer();
            } else {
              restartServer();
            }
          });
        },
      },
    ],
  });

  await Promise.all([frontendCtx.watch(), backendCtx.watch()]);
  watchPublic();

  log('main', `watching for changes — server on ${serverEnv.HTTP_ONLY === 'true' ? 'http' : 'https'}://${serverEnv.HOST}:${serverEnv.PORT}/`);

  const shutdown = async () => {
    log('main', 'shutting down');
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    await Promise.all([frontendCtx.dispose(), backendCtx.dispose()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
