import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const composeFile = resolve('tests/fixtures/stateless/compose.yaml');
const project = `immich-pages-stateless-${randomUUID().slice(0, 8)}`;
const projectionPath = resolve(tmpdir(), `${project}-projection.json`);
const compose = ['compose', '-p', project, '-f', composeFile];

function command(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: options.quiet ? 'ignore' : 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`docker exited ${code ?? signal}`)));
  });
}

async function projection() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:18081/share/key/stateless-fixture', {
        headers: { cookie: 'fixture=stateless', authorization: 'Bearer fixture' }
      });
      if (response.ok) return { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() };
    } catch {
      // The compose healthcheck is the authoritative readiness signal; this is only a bounded retry.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error('Pages did not become ready at the direct-share URL');
}

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('Docker is required for test:stateless-recreate; refusing a Node-only substitute.');
  process.exitCode = 1;
} else {
  let before;
  try {
    await command([...compose, 'up', '-d', '--build', '--remove-orphans']);
    before = await projection();
    await writeFile(projectionPath, JSON.stringify(before));
    await command([...compose, 'down', '--volumes', '--remove-orphans']);
    await command([...compose, 'up', '-d', '--build', '--remove-orphans']);
    const after = await projection();
    const saved = JSON.parse(await readFile(projectionPath, 'utf8')).body;
    if (before.body !== after.body || before.body !== saved) throw new Error('page projection changed after destructive recreation');
    console.log('Stateless recreation passed: pre- and post-recreation projections match byte-for-byte.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await command([...compose, 'down', '--volumes', '--remove-orphans'], { quiet: true }).catch(() => {});
    await rm(projectionPath, { force: true });
  }
}
