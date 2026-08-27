import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'immich-server:v1.143.1';
const fixtureRoot = resolve(root, 'tests/fixtures/immich/v1.143.1');
const resultPath = resolve(fixtureRoot, 'contract-result.json');
const checks = {
  serverVersion: false,
  dtoFields: false,
  mediaReferences: false,
  requestScopedAuthorization: false,
  separateHost: false
};

const result = { image, mode: 'fixture', observedVersion: null, checks, status: 'failed' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(name) {
  return JSON.parse(await readFile(resolve(fixtureRoot, name), 'utf8'));
}

async function runFixtureContract() {
  const version = await json('server-version.json');
  const contract = await json('shared-link-contract.json');
  assert(version.major === 1 && version.minor === 143 && version.patch === 1, 'fixture server version is not v1.143.1');
  result.observedVersion = `v${version.major}.${version.minor}.${version.patch}`;
  checks.serverVersion = result.observedVersion === 'v1.143.1';

  const fields = ['album', 'assets', 'allowDownload', 'allowUpload', 'expiresAt', 'showMetadata', 'password'];
  assert(fields.every((field) => contract.dtoFields.includes(field)), 'SharedLinkResponseDto field contract is incomplete');
  checks.dtoFields = true;
  assert(contract.mediaReferences.every((entry) => entry.startsWith('/api/assets/')),
    'media references must be endpoint-relative asset references');
  checks.mediaReferences = true;
  assert(contract.authorization.forwardedHeaders.join(',') === 'Cookie,Authorization' &&
    contract.authorization.ownerCredentialFallback === false &&
    contract.authorization.persistence === false, 'authorization contract is not request scoped');
  checks.requestScopedAuthorization = true;
  assert(contract.separateHost.pagesHost === 'pages.example.xyz' &&
    contract.separateHost.immichHost === 'immich.example.xyz' &&
    contract.separateHost.pagesRelaysSetCookie === false &&
    contract.queryBehavior.join(',') === 'key,slug', 'separate-host contract is incomplete');
  checks.separateHost = true;
}

function dockerAvailable() {
  return spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status === 0;
}

try {
  assert(existsSync(fixtureRoot), 'committed release fixture is missing');
  // A live target may be supplied by operators, but the image/version remains pinned
  // and the deterministic contract is always checked as the portable release gate.
  if (dockerAvailable()) {
    const inspected = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    result.dockerImagePresent = inspected.status === 0;
  } else {
    result.dockerImagePresent = false;
    result.dockerUnavailable = true;
  }
  await runFixtureContract();
  result.status = 'passed';
} catch (error) {
  result.error = error instanceof Error ? error.message : 'release contract failed';
}

await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (result.status !== 'passed') process.exitCode = 1;
