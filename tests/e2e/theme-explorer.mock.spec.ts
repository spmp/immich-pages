import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/theme/representative-journey.json', import.meta.url), 'utf8')) as {
  share: { kind: string; ref: string; href: string; title: string; assetIds: string[] };
  library: { href: string };
  states: { name: string; coverage: string }[];
  presets: string[];
  viewports: { desktop: { width: number; height: number }; tablet: { width: number; height: number }; mobile: { width: number; height: number } };
};

const screenshotRoot = resolve('docs/theme-evaluation/screenshots');
const presets = fixture.presets;
const viewports = [fixture.viewports.desktop, fixture.viewports.tablet, fixture.viewports.mobile] as const;
const requiredScreenshotPaths = presets.flatMap((preset) => [
  `docs/theme-evaluation/screenshots/${preset}/1440x900.png`,
  `docs/theme-evaluation/screenshots/${preset}/375x812.png`
]);
const tabletScreenshotPaths = presets.map((preset) => `docs/theme-evaluation/screenshots/${preset}/768x1024.png`);
test.describe.configure({ mode: 'serial' });

function screenshotPath(preset: string, viewport: { width: number; height: number }) {
  const path = join(screenshotRoot, preset, `${viewport.width}x${viewport.height}.png`);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function pngDimensions(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

function allPngPaths() {
  return readdirSync(screenshotRoot, { withFileTypes: true }).flatMap((preset) => {
    if (!preset.isDirectory()) return [];
    return readdirSync(join(screenshotRoot, preset.name), { withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith('.png'))
      .map((file) => `docs/theme-evaluation/screenshots/${preset.name}/${file.name}`);
  }).sort();
}

test('compares every allowlisted theme on the representative share journey', async ({ page, context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
  await page.setExtraHTTPHeaders({ authorization: 'Bearer fixture' });
  const browserRequests: string[] = [];
  page.on('request', (request) => browserRequests.push(request.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(fixture.viewports.desktop);
  await page.goto(fixture.share.href);
  await expect(page.getByRole('heading', { name: fixture.share.title })).toBeVisible();
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'studio-modern');
  await expect(page.getByText('Active preset: Studio Modern')).toBeVisible();
   await expect(page.getByRole('region', { name: 'Gallery' })).toBeVisible();
  await expect(page.locator('[id^="asset-"]')).toHaveCount(fixture.share.assetIds.length);
  await expect(page.locator('.gallery-grid img').first()).toHaveAttribute('loading', 'lazy');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  const relevantRequests = () => browserRequests.filter((url) => {
    const path = new URL(url).pathname;
    return path.startsWith('/share/') || path === '/library';
  });

  const invariant = async () => ({
    title: await page.getByRole('heading', { name: fixture.share.title }).textContent(),
    hrefs: await page.locator('a').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute('href'))),
    assets: await page.locator('[id^="asset-"]').evaluateAll((items) => items.map((item) => ({
      id: item.id,
      media: [...item.querySelectorAll('img, video')].map((media) => ({ tag: media.tagName, src: media.getAttribute('src') }))
    }))),
    metadata: await page.locator('[data-date-iso]').count(),
    map: await page.locator('.journey-slot').getAttribute('class'),
    url: page.url(),
    ref: page.url().split('/').pop()
  });
  const baseline = await invariant();
  const initialRequestCount = browserRequests.length;

  for (const preset of presets) {
    await page.selectOption('#desktop-theme-choice', preset);
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', preset);
    expect(await invariant()).toEqual(baseline);
    await page.screenshot({ path: screenshotPath(preset, fixture.viewports.desktop), animations: 'disabled' });
  }
  const afterDesktopRequests = browserRequests.length;
  expect(afterDesktopRequests).toBe(initialRequestCount);

  await page.reload();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'studio-modern');
  await page.setViewportSize(fixture.viewports.tablet);
  for (const preset of presets) {
    await page.getByRole('button', { name: 'Open journeys' }).click();
    const drawer = page.getByRole('dialog', { name: 'Journeys' });
    await expect(drawer).toBeVisible();
    await page.selectOption('#mobile-theme-choice', preset);
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', preset);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    expect(await invariant()).toEqual(baseline);
    await page.screenshot({ path: screenshotPath(preset, fixture.viewports.tablet), animations: 'disabled' });
  }

  await page.setViewportSize(fixture.viewports.mobile);
  await page.reload();
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'studio-modern');
  const beforeMobileSelectionRelevantRequests = relevantRequests();
  for (const preset of presets) {
    await page.getByRole('button', { name: 'Open journeys' }).click();
    await page.getByRole('dialog', { name: 'Journeys' }).getByLabel('Explore theme').selectOption(preset);
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', preset);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: screenshotPath(preset, fixture.viewports.mobile), animations: 'disabled' });
  }

  await expect(page).toHaveURL(fixture.share.href);
  expect([...new Set(relevantRequests())]).toEqual([...new Set(beforeMobileSelectionRelevantRequests)]);
  expect(browserRequests.some((url) => /\/login|\/users\/me|\/albums(?:[/?]|$)/.test(new URL(url).pathname))).toBe(false);
  expect(browserRequests.some((url) => /^\/(?:settings|database|volume|file-store)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
});

test('proves share-only state and interaction coverage without an Immich session', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewportSize(fixture.viewports.mobile);
  await page.goto(fixture.share.href);
  await expect(page.getByRole('heading', { name: fixture.share.title })).toBeVisible();
  await expect(page).not.toHaveURL(/login/);
  await page.evaluate(() => localStorage.setItem('immich-pages:theme', 'noir'));
  await page.reload();
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'noir');
  await expect.poll(() => page.locator('[data-theme]').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.backgroundColor, image: style.backgroundImage };
  })).toEqual({ color: 'rgb(22, 22, 22)', image: expect.stringContaining('rgb(22, 22, 22)') });
  expect(requests.some((url) => /\/login|\/users\/me|\/albums(?:[/?]|$)/.test(new URL(url).pathname))).toBe(false);
  expect(requests.some((url) => /^\/(?:settings|database|volume|file-store)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
  await context.close();
});

test('resolves System mode from the OS and reacts to OS preference changes', async ({ page, context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
  await page.setExtraHTTPHeaders({ authorization: 'Bearer fixture' });
  await page.setViewportSize(fixture.viewports.desktop);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(fixture.share.href);
  await page.evaluate(() => localStorage.setItem('immich-pages:theme', 'system'));
  await page.reload();
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'monograph');
  await expect(page.getByText('Selected mode: System (OS default)')).toBeVisible();
  await expect(page.getByText('Active preset: Monochrome Reference')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'noir');
  await expect.poll(() => page.locator('[data-theme]').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.backgroundColor, image: style.backgroundImage };
  })).toEqual({ color: 'rgb(22, 22, 22)', image: expect.stringContaining('rgb(22, 22, 22)') });
  await expect(page.getByText('Active preset: Noir')).toBeVisible();
});

test('validates the exact deterministic screenshot manifest and PNG dimensions', async () => {
  expect(allPngPaths()).toEqual([...requiredScreenshotPaths, ...tabletScreenshotPaths].sort());
  expect(requiredScreenshotPaths).toHaveLength(14);
  expect(tabletScreenshotPaths).toHaveLength(7);
  for (const preset of presets) {
    for (const viewport of viewports) {
      const path = screenshotPath(preset, viewport);
      expect(statSync(path).isFile()).toBe(true);
      const dimensions = pngDimensions(path);
      expect(dimensions.bytes).toBeGreaterThan(0);
      expect(dimensions.width).toBe(viewport.width);
      expect(dimensions.height).toBe(viewport.height);
    }
  }
});

test('covers the documented presentation-state fixture cases', async ({ page }) => {
  expect(fixture.states.map((state) => state.name)).toEqual(expect.arrayContaining([
    'long-title', 'no-hero', 'narrative', 'mixed-media', 'map-warnings', 'library', 'empty', 'error', 'lightbox'
  ]));
  await page.goto('/share/key/error');
  await expect(page.getByRole('heading', { name: /unavailable|try again/i })).toBeVisible();
  await page.goto(fixture.library.href);
  await expect(page.getByRole('heading', { name: /published journeys|no published journeys|your library/i })).toBeVisible();
});
