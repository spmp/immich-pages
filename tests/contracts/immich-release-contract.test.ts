import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
import result from '../fixtures/immich/v3.3.1/contract-result.json';

describe('pinned Immich release contract', () => {
  it('records a complete fixture-only v3.3.1 contract', () => {
    expect(result).toMatchObject({
       image: 'immich-server:v3.3.1',
      mode: 'fixture',
      exactImage: false,
      liveVerified: false,
       expectedVersion: 'v3.3.1',
       observedVersion: 'v3.3.1',
      status: 'passed',
      checks: {
        serverVersion: true,
        dtoFields: true,
        mediaReferences: true,
        requestScopedAuthorization: true,
        separateHost: true
      }
    });
  });

  it('does not allow fixture evidence to satisfy explicit live verification', () => {
    const script = 'scripts/verify-immich-release.mjs';
    const fixturePath = 'tests/fixtures/immich/v3.3.1/contract-result.json';
    const fixtureBefore = readFileSync(fixturePath, 'utf8');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'immich-release-contract-'));
    const liveResultPath = join(tempDirectory, 'live-result.json');

    try {
      expect(() => execFileSync(process.execPath, [script, '--live', '--result-path', liveResultPath], {
        cwd: process.cwd(),
        env: { ...process.env, IMMICH_RELEASE_BASE_URL: '' },
        stdio: 'pipe'
      })).toThrow();

      const liveResult = JSON.parse(readFileSync(liveResultPath, 'utf8'));
       expect(liveResult.mode).toBe('endpoint');
      expect(liveResult.liveVerified).toBe(false);
      expect(liveResult.status).toBe('failed');
      expect(readFileSync(fixturePath, 'utf8')).toBe(fixtureBefore);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('requires a separate result path for live verification', () => {
    const script = 'scripts/verify-immich-release.mjs';
    const fixturePath = 'tests/fixtures/immich/v3.3.1/contract-result.json';
    const fixtureBefore = readFileSync(fixturePath, 'utf8');

    expect(() => execFileSync(process.execPath, [script, '--live'], {
      cwd: process.cwd(),
      env: { ...process.env, IMMICH_RELEASE_BASE_URL: '' },
      stdio: 'pipe'
    })).toThrow();
    expect(readFileSync(fixturePath, 'utf8')).toBe(fixtureBefore);
  });

  it('records operator endpoint evidence without claiming exact-image execution', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/server/version') {
         response.end(JSON.stringify({ major: 3, minor: 3, patch: 1 }));
        return;
      }

      if (request.url?.startsWith('/api/shared-links/me?key=operator-share')) {
        response.end(JSON.stringify({
          id: '550e8400-e29b-41d4-a716-446655440000',
          description: null,
          password: null,
          userId: '550e8400-e29b-41d4-a716-446655440001',
          key: 'operator-share',
          type: 'ALBUM',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          assets: [{ id: '550e8400-e29b-41d4-a716-446655440002', type: 'IMAGE' }],
          album: { id: '550e8400-e29b-41d4-a716-446655440003' },
          allowUpload: false,
          allowDownload: false,
          showMetadata: true,
          slug: null
        }));
        return;
      }

      response.statusCode = 404;
      response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'immich-release-endpoint-'));
    const resultPath = join(tempDirectory, 'endpoint-result.json');

    try {
      await execFileAsync(process.execPath, ['scripts/verify-immich-release.mjs', '--live', '--result-path', resultPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          IMMICH_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
          IMMICH_RELEASE_SHARE_KEY: 'operator-share',
          IMMICH_RELEASE_EXACT_IMAGE_CONFIRMED: 'false'
        }
      });
      expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
        mode: 'endpoint',
        provenance: 'endpoint',
        exactImage: false,
        liveVerified: true,
         expectedVersion: 'v3.3.1',
         observedVersion: 'v3.3.1',
        status: 'passed'
      });
    } finally {
      server.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('reports a sanitized observed-versus-expected version mismatch', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ major: 3, minor: 0, patch: 1, secret: 'upstream-body-secret' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'immich-release-mismatch-'));
    const resultPath = join(tempDirectory, 'mismatch-result.json');

    try {
      await expect(execFileAsync(process.execPath, ['scripts/verify-immich-release.mjs', '--live', '--result-path', resultPath], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          IMMICH_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}/secret-share?token=secret-token`,
          IMMICH_RELEASE_SHARE_KEY: 'secret-share-key'
        }
      })).rejects.toThrow();

      const output = readFileSync(resultPath, 'utf8');
      const mismatch = JSON.parse(output);
      expect(mismatch).toMatchObject({
        expectedVersion: 'v3.3.1',
        observedVersion: 'v3.0.1',
        mode: 'endpoint',
        errorCategory: 'version-mismatch',
        liveVerified: false
      });
      expect(output).not.toContain('secret-token');
      expect(output).not.toContain('secret-share-key');
      expect(output).not.toContain('upstream-body-secret');
      expect(output).not.toContain('/secret-share');
    } finally {
      server.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('does not contain an image runner or obsolete release fixture root', () => {
     expect(readFileSync('scripts/verify-immich-release.mjs', 'utf8')).not.toMatch(/docker|spawnSync|v1\.143\.1|v3\.0\.1|v3\.1\.0/);
     expect(readFileSync('scripts/verify-immich-release.mjs', 'utf8')).toMatch(/expectedVersion/);
     expect(() => readFileSync('tests/fixtures/immich/v1.143.1/contract-result.json')).toThrow();
     expect(() => readFileSync('tests/fixtures/immich/v3.0.1/contract-result.json')).toThrow();
     expect(() => readFileSync('tests/fixtures/immich/v3.1.0/contract-result.json')).toThrow();
  });

  it('keeps Immich DTO fields separate from Pages-derived media references', async () => {
    const contract = JSON.parse(readFileSync('tests/fixtures/immich/v3.3.1/shared-link-contract.json', 'utf8'));
    expect(contract.immichAssetFields).not.toContain('thumbnailPath');
    expect(contract.immichAssetFields).not.toContain('viewPath');
    expect(contract.pagesDerivedReferences).toEqual(['thumbnail', 'view']);
    // A vendored excerpt of the v3.3.1 OpenAPI spec, so this runs without an Immich checkout.
    const openApi = JSON.parse(readFileSync('tests/fixtures/immich/v3.3.1/openapi-excerpt.json', 'utf8'));
    expect(openApi.version).toBe('3.3.1');
    const sharedLink: string[] = openApi.schemas.SharedLinkResponseDto.properties;
    const asset: string[] = openApi.schemas.AssetResponseDto.properties;
    expect(sharedLink).toEqual(expect.arrayContaining(['id', 'description', 'password', 'userId', 'key', 'type', 'createdAt', 'expiresAt', 'assets', 'album', 'allowUpload', 'allowDownload', 'showMetadata', 'slug']));
    expect(asset).not.toContain(['thumbnail', 'Path'].join(''));
    expect(asset).not.toContain(['view', 'Path'].join(''));
  });
});
