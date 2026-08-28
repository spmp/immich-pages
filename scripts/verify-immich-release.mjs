import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'immich-server:v1.143.1';
const fixtureRoot = resolve(root, 'tests/fixtures/immich/v1.143.1');
const live = process.argv.includes('--live');

function resultOutputPath() {
  const option = process.argv.find((argument) => argument === '--result-path' || argument.startsWith('--result-path='));
  if (!option) return resolve(fixtureRoot, 'contract-result.json');
  const value = option === '--result-path' ? process.argv[process.argv.indexOf(option) + 1] : option.slice('--result-path='.length);
  if (!value) throw new Error('--result-path requires a file path');
  return resolve(value);
}

const resultPath = resultOutputPath();

function emptyChecks() {
  return {
    serverVersion: false,
    dtoFields: false,
    mediaReferences: false,
    requestScopedAuthorization: false,
    separateHost: false
  };
}

const result = {
  image,
  mode: live ? 'live' : 'fixture',
  liveVerified: false,
  observedVersion: null,
  checks: emptyChecks(),
  status: 'failed'
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(name) {
  return JSON.parse(await readFile(resolve(fixtureRoot, name), 'utf8'));
}

function dockerState() {
  const available = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status === 0;
  result.dockerAvailable = available;
  result.dockerImagePresent = available && spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
}

function checkVersion(version) {
  assert(version && Number(version.major) === 1 && Number(version.minor) === 143 && Number(version.patch) === 1,
    'observed Immich version is not v1.143.1');
  result.observedVersion = `v${version.major}.${version.minor}.${version.patch}`;
  result.checks.serverVersion = true;
}

function checkDirectShare(contract, { cookie, authorization, upstreamSetCookie }) {
  const fields = ['album', 'assets', 'allowDownload', 'allowUpload', 'expiresAt', 'showMetadata', 'password'];
  assert(fields.every((field) => Object.hasOwn(contract, field)), 'SharedLinkResponseDto field contract is incomplete');
  result.checks.dtoFields = true;

  const assets = Array.isArray(contract.assets) ? contract.assets : [];
  assert(assets.every((asset) => {
    if (!asset || typeof asset.id !== 'string') return false;
    return [asset.thumbnailPath, asset.viewPath].filter(Boolean).every((path) =>
      typeof path === 'string' && path.startsWith(`/api/assets/${asset.id}/`));
  }), 'media references must be endpoint-relative and bound to their asset ID');
  result.checks.mediaReferences = true;

  assert(!process.env.IMMICH_API_KEY && !process.env.IMMICH_OWNER_API_KEY,
    'owner/API-key fallback is forbidden');
  assert(cookie === undefined || typeof cookie === 'string', 'invalid operator cookie context');
  assert(authorization === undefined || typeof authorization === 'string', 'invalid operator authorization context');
  result.checks.requestScopedAuthorization = true;

  assert(upstreamSetCookie === false, 'live probe must not treat upstream Set-Cookie as Pages state');
  result.checks.separateHost = true;
}

async function runFixtureContract() {
  const version = await json('server-version.json');
  const contract = await json('shared-link-contract.json');
  checkVersion(version);
  const fields = ['album', 'assets', 'allowDownload', 'allowUpload', 'expiresAt', 'showMetadata', 'password'];
  assert(fields.every((field) => contract.dtoFields.includes(field)), 'fixture DTO field contract is incomplete');
  result.checks.dtoFields = true;
  assert(contract.mediaReferences.every((entry) => /^\/api\/assets\/\{assetId\}\/(thumbnail|original)$/.test(entry)),
    'fixture media references must be endpoint-relative asset references');
  result.checks.mediaReferences = true;
  assert(contract.authorization.forwardedHeaders.join(',') === 'Cookie,Authorization' &&
    contract.authorization.ownerCredentialFallback === false && contract.authorization.persistence === false,
    'fixture authorization contract is not request scoped');
  result.checks.requestScopedAuthorization = true;
  assert(contract.separateHost.pagesHost === 'pages.example.xyz' &&
    contract.separateHost.immichHost === 'immich.example.xyz' &&
    contract.separateHost.pagesRelaysSetCookie === false && contract.queryBehavior.join(',') === 'key,slug',
    'fixture separate-host contract is incomplete');
  result.checks.separateHost = true;
}

async function liveJson(url, headers, signal) {
  const response = await fetch(url, { headers, signal, redirect: 'error' });
  assert(response.ok, `live endpoint returned HTTP ${response.status}`);
  return { body: await response.json(), setCookie: response.headers.has('set-cookie') };
}

async function runLiveContract() {
  const baseUrl = process.env.IMMICH_RELEASE_BASE_URL;
  assert(baseUrl, 'IMMICH_RELEASE_BASE_URL is required for --live');
  const origin = new URL(baseUrl);
  assert(origin.protocol === 'http:' || origin.protocol === 'https:', 'live endpoint must use HTTP(S)');
  const key = process.env.IMMICH_RELEASE_SHARE_KEY;
  const slug = process.env.IMMICH_RELEASE_SHARE_SLUG;
  assert((key ? 1 : 0) + (slug ? 1 : 0) === 1,
    'exactly one disposable IMMICH_RELEASE_SHARE_KEY or IMMICH_RELEASE_SHARE_SLUG is required for --live');

  const headers = new Headers({ accept: 'application/json' });
  if (process.env.IMMICH_RELEASE_COOKIE) headers.set('cookie', process.env.IMMICH_RELEASE_COOKIE);
  if (process.env.IMMICH_RELEASE_AUTHORIZATION) headers.set('authorization', process.env.IMMICH_RELEASE_AUTHORIZATION);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const version = await liveJson(new URL('/api/server/version', origin), headers, controller.signal);
    checkVersion(version.body);
    const shareUrl = new URL('/api/shared-links/me', origin);
    shareUrl.searchParams.set(key ? 'key' : 'slug', key ?? slug);
    const share = await liveJson(shareUrl, headers, controller.signal);
    checkDirectShare(share.body, {
      cookie: process.env.IMMICH_RELEASE_COOKIE,
      authorization: process.env.IMMICH_RELEASE_AUTHORIZATION,
      upstreamSetCookie: share.setCookie
    });
  } finally {
    clearTimeout(timer);
  }
  result.liveVerified = true;
  result.status = 'passed';
}

try {
  assert(existsSync(fixtureRoot), 'committed release fixture is missing');
  dockerState();
  if (live) await runLiveContract();
  else {
    await runFixtureContract();
    result.status = 'passed';
  }
} catch (error) {
  result.errorCategory = error?.name === 'AbortError' ? 'timeout' :
    error instanceof Error && error.message.includes('required') ? 'configuration' : 'contract-failure';
}

await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (result.status !== 'passed') process.exitCode = 1;
