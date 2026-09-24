import { expect, test } from '@playwright/test';
import { readFileSync, unlinkSync } from 'node:fs';

const orders = {
  'heic-reverse-ref': Array.from({ length: 20 }, (_, index) => 20 - index),
  'heic-forward-ref': Array.from({ length: 20 }, (_, index) => index + 1)
} as const;
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fixtureRoot = new URL('../resources/heic-test-set/', import.meta.url);
const bridgeLog = process.env.HDR_BRIDGE_LOG;
const authHeaders = { authorization: 'Bearer fixture', cookie: 'immich_shared_link_token=fixture' };

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
  if (bridgeLog) {
    try { unlinkSync(bridgeLog); } catch { /* The bridge creates it on first invocation. */ }
  }
});

async function enableHdrHints(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => query === '(dynamic-range: high)' || query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
      ? { ...nativeMatchMedia(query), matches: true }
      : nativeMatchMedia(query);
  });
}

test('renders both upstream album orders and converts HEIC originals to browser-displayable JPEG', async ({ page, request, browserName }) => {
  for (const [ref, order] of Object.entries(orders)) {
    await page.goto(`/share/key/${ref}`);
    await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
    await expect.poll(async () => page.locator('[id^="asset-"]').evaluateAll((nodes) => nodes.map((node) => node.id.replace('asset-', '')))).toEqual(order.map(assetId));

    for (const number of [order[0], order[order.length - 1]]) {
      const id = assetId(number);
      const fullsizeUrl = new URL(`/share/key/${ref}/media/${id}/image/fullsize?key=${ref}`, page.url()).toString();
      const response = await request.get(fullsizeUrl, { headers: authHeaders });
      expect(response.status()).toBe(200);
      // Most non-Safari browsers can't decode HEIC in <img>; Pages must convert the HEIC
      // original into a universally displayable JPEG rather than forwarding raw HEIC bytes.
      expect(response.headers()['content-type']).toBe('image/jpeg');
      const body = await response.body();
      expect(body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(body).not.toEqual(readFileSync(new URL(`originals/${String(number).padStart(2, '0')}.HEIC`, fixtureRoot)));

      if (browserName === 'chromium' && number === order[0]) {
        const requestPromise = page.waitForRequest((request) => request.url() === fullsizeUrl);
        const browserResponseStatus = await page.evaluate(async (url) => (await fetch(url)).status, fullsizeUrl);
        expect(browserResponseStatus).toBe(200);
        await requestPromise;
      }
    }
  }
});

test('runs the HDR bridge through the authenticated request context', async ({ page, request }) => {
  // Only meaningful under the dedicated npm run test:e2e:heic:{chromium,webkit} scripts, which set
  // the HDR_*_PATH bridge env vars; skip (not fail) under the generic npm run test:e2e:mock gate.
  test.skip(!bridgeLog, 'HDR_BRIDGE_LOG is required for executable bridge evidence');
  await enableHdrHints(page);
  const id = assetId(7);
  await page.goto('/share/key/heic-forward-ref');
  const candidate = page.locator(`#asset-${id} a`);
  await expect(candidate).toHaveAttribute('data-pswp-type', 'video');
  await expect(candidate).toHaveAttribute('data-video-src', /\/image\/hdr/);
  const hdrHref = await candidate.getAttribute('data-video-src');
  const response = await request.get(new URL(hdrHref!, page.url()).toString(), { headers: authHeaders });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect((await response.body()).subarray(4, 8).toString()).toBe('ftyp');
  await expect.poll(() => readBridgeInvocations().filter((invocation) => invocation.assetId === id)).toEqual([
    { method: 'extractAppleHdrMetadata', assetId: id },
    { method: 'composeHdr', assetId: id },
    { method: 'encodeHdrMp4', assetId: id }
  ]);
});

function readBridgeInvocations() {
  if (!bridgeLog) return [];
  try { return readFileSync(bridgeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}
