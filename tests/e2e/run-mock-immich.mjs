import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const children = [];
// Keep the deterministic mock gate independent of whether libheif's real heif-convert is
// installed on the host; a real bridge process still exercises actual spawn/temp-file plumbing.
const defaultSdrConverterPath = fileURLToPath(new URL('../unit/fixtures/fake-heif-convert.mjs', import.meta.url));

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: process.platform !== 'win32',
    ...options
  });
  children.push(child);
  return child;
}

function waitForOutput(child, pattern, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), timeout);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (process.env.MOCK_PAGES_LOG === 'true') process.stderr.write(chunk);
      const match = output.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`child exited with ${code} while waiting for ${pattern}`));
      }
    });
  });
}

async function waitForHttp(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Pages dev server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
  else child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

const playwrightArgs = process.argv.slice(2);
const playwrightConfig = process.env.MOCK_PLAYWRIGHT_CONFIG ?? 'playwright.mock.config.ts';
let failure;
const mock = start(process.execPath, ['tests/e2e/mock-immich-server.mjs'], { env: { ...process.env, MOCK_IMMICH_PORT: '0' } });
try {
  const match = await waitForOutput(mock, /MOCK_IMMICH_READY (\d+)/);
  const pages = start(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], {
      env: {
        ...process.env,
         IMMICH_BASE_URL: `http://127.0.0.1:${match[1]}`,
         PAGES_LOCATOR_SECRET: process.env.PAGES_LOCATOR_SECRET ?? 'fixture-locator-secret-0123456789012345',
         PAGES_VISITED_SHARES_SECRET: process.env.PAGES_VISITED_SHARES_SECRET ?? 'fixture-visited-shares-secret-0123456789012345',
         MOCK_IMMICH_URL: `http://127.0.0.1:${match[1]}`,
        MAP_STYLE_URL_QUIET_ATLAS: `http://127.0.0.1:${match[1]}/api/map-style.json`,
        BROUTER_ENDPOINT: process.env.BROUTER_ENDPOINT ?? `http://127.0.0.1:${match[1]}/brouter`,
        BROUTER_ALLOWED_ORIGINS: process.env.BROUTER_ALLOWED_ORIGINS ?? `http://127.0.0.1:${match[1]}`,
        BROUTER_ALLOW_LOOPBACK_FOR_TESTS: 'true',
        SDR_HEIC_CONVERTER_PATH: process.env.SDR_HEIC_CONVERTER_PATH ?? defaultSdrConverterPath
      }
  });
  if (process.env.MOCK_PAGES_LOG === 'true') pages.stdout.on('data', (chunk) => process.stderr.write(chunk));
  await waitForHttp('http://127.0.0.1:4173/health');
  await new Promise((resolve, reject) => {
    const test = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', `--config=${playwrightConfig}`, ...playwrightArgs], {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4173', MOCK_IMMICH_URL: `http://127.0.0.1:${match[1]}` }
    });
    test.once('error', reject);
    test.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`playwright exited with ${code ?? signal}`)));
  });
  await stop(pages);
} catch (error) {
  failure = error;
} finally {
  for (const child of children.reverse()) await stop(child);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
