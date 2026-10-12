import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const children = [];
const realImmichDir = fileURLToPath(new URL('./real-immich', import.meta.url));
const defaultSdrConverterPath = fileURLToPath(new URL('../unit/fixtures/fake-heif-convert.mjs', import.meta.url));
const IMMICH_PORT = 4101;
const IMMICH_BASE_URL = `http://127.0.0.1:${IMMICH_PORT}`;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: process.platform !== 'win32',
    ...options
  });
  children.push(child);
  return child;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`))));
  });
}

async function waitForHttp(url, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
let composeUp = false;
try {
  await run('docker', ['compose', 'up', '-d'], { cwd: realImmichDir });
  composeUp = true;
  await waitForHttp(`${IMMICH_BASE_URL}/api/server/ping`);

  await run(process.execPath, ['tests/e2e/real-immich/seed.mjs'], { env: { ...process.env, IMMICH_BASE_URL } });

  const pages = start(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], {
    env: {
      ...process.env,
      IMMICH_BASE_URL,
      PAGES_LOCATOR_SECRET: process.env.PAGES_LOCATOR_SECRET ?? 'fixture-locator-secret-0123456789012345',
      PAGES_VISITED_SHARES_SECRET: process.env.PAGES_VISITED_SHARES_SECRET ?? 'fixture-visited-shares-secret-0123456789012345',
      SDR_HEIC_CONVERTER_PATH: process.env.SDR_HEIC_CONVERTER_PATH ?? defaultSdrConverterPath
    }
  });
  if (process.env.MOCK_PAGES_LOG === 'true') pages.stdout.on('data', (chunk) => process.stderr.write(chunk));
  await waitForHttp('http://127.0.0.1:4173/health');
  await new Promise((resolve, reject) => {
    const test = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', `--config=${playwrightConfig}`, ...playwrightArgs], {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:4173', IMMICH_BASE_URL }
    });
    test.once('error', reject);
    test.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`playwright exited with ${code ?? signal}`))));
  });
  await stop(pages);
} catch (error) {
  failure = error;
} finally {
  for (const child of children.reverse()) await stop(child);
  if (composeUp) {
    try {
      await run('docker', ['compose', 'down'], { cwd: realImmichDir });
    } catch (teardownError) {
      console.error('Failed to tear down real-Immich stack:', teardownError);
    }
  }
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
