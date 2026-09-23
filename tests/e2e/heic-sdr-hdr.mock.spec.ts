import { expect, test } from '@playwright/test';
import { readFileSync, unlinkSync } from 'node:fs';

const order = [7, 1, 20, 3, 14, 9, 2, 18, 5, 11, 16, 4, 19, 8, 13, 6, 17, 10, 12, 15];
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fixtureRoot = new URL('../resources/heic-test-set/', import.meta.url);
const bridgeLog = process.env.HDR_BRIDGE_LOG;

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

test('renders all twenty assets in upstream album order and serves SDR fullsize JPEGs', async ({ page }) => {
  await page.goto('/share/key/heic-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  await expect.poll(async () => page.locator('[id^="asset-"]').evaluateAll((nodes) => nodes.map((node) => node.id.replace('asset-', '')))).toEqual(order.map(assetId));

  for (const number of [1, 20]) {
    const id = assetId(number);
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/media/${id}/image/fullsize`));
    await page.locator(`#asset-${id} a`).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/jpeg');
    expect(await response.body()).toEqual(readFileSync(new URL(`fullsize/${String(number).padStart(2, '0')}.jpg`, fixtureRoot)));
    await page.keyboard.press('Escape');
  }
});

test('runs the HDR bridge for a real HEIC asset and returns the valid MP4 fixture', async ({ page }) => {
  if (!bridgeLog) throw new Error('HDR_BRIDGE_LOG is required for executable bridge evidence');
  await enableHdrHints(page);
  const id = assetId(7);
  await page.goto('/share/key/heic-ref');
  const responsePromise = page.waitForResponse((response) => response.url().includes(`/media/${id}/image/hdr`));
  await page.locator(`#asset-${id} a`).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect((await response.body()).subarray(4, 8).toString()).toBe('ftyp');
  await expect.poll(() => readBridgeInvocations()).toEqual([
    { method: 'extractAppleHdrMetadata', assetId: id },
    { method: 'composeHdr', assetId: id },
    { method: 'encodeHdrMp4', assetId: id }
  ]);
});

function readBridgeInvocations() {
  if (!bridgeLog) return [];
  try { return readFileSync(bridgeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}
