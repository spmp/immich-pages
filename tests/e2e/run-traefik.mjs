import { spawn } from 'node:child_process';
import https from 'node:https';

const compose = ['compose', '-f', 'tests/e2e/traefik-test.compose.yaml'];

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`docker exited with ${code ?? signal}`)));
  });
}

const run = (args, options) => runCommand('docker', args, options);

async function waitForTraefik() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const status = await new Promise((resolve, reject) => {
        const request = https.get('https://127.0.0.1:18080/health', { headers: { host: 'pages.example.xyz' }, rejectUnauthorized: false }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 599);
        });
        request.on('error', reject);
      });
      if (status !== 404 && status < 599) return;
    } catch {
      // The published entrypoint is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Timed out waiting for the Traefik published entrypoint');
}

const playwrightArgs = process.argv.slice(2);
let failure;
try {
  await run([...compose, 'up', '-d', '--build']);
  await waitForTraefik();
  await run([...compose, 'exec', '-T', 'traefik', 'traefik', 'healthcheck', '--ping']);
    await runCommand('npx', ['playwright', 'test', ...playwrightArgs], { env: { ...process.env, PLAYWRIGHT_BASE_URL: 'https://pages.example.xyz:18080' } });
} catch (error) {
  failure = error;
} finally {
  try {
    await run([...compose, 'down', '--volumes', '--remove-orphans']);
  } catch (error) {
    failure ??= error;
  }
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
