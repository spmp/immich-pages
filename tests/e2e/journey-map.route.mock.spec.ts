import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' }, locale: 'en-GB' });
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
});

const waypointRoute = { type: 'LineString', coordinates: [[-0.1278, 51.5074], [-0.1278, 51.5074], [2.3522, 48.8566]] };
const geojsonRoute = { type: 'MultiLineString', coordinates: [[[-0.1278, 51.5074], [-1.2577, 51.752]], [[2.3522, 48.8566], [2.1734, 41.3851]]] };
const brouterRoute = { type: 'LineString', coordinates: [[-0.1278, 51.5074], [0.9, 50.9], [2.3522, 48.8566]] };

async function expectPageSurvives(page: any, proof: string) {
  await expect(page.getByText('Mock Journey')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(page.locator('#journal-gallery [id^="asset-"]')).toHaveCount(4);
  await expect(page.locator('[data-phase="3-map-seam"]')).toHaveAttribute('data-marker-count', '2');
  await expect(page.getByText(proof)).toBeVisible();
}

async function expectRouteSource(page: any, route: object) {
  await expect(page.locator('[data-phase="3-map-seam"]')).toHaveAttribute('data-route-ready', 'true');
  await expect(page.locator('[data-phase="3-map-seam"]')).toHaveAttribute('data-route-layer-ready', 'true');
  await expect.poll(() => page.evaluate(() => {
    const map = (globalThis as typeof globalThis & { __immichPagesMap?: any }).__immichPagesMap;
    const source = map?.getSource('journey-route') as any;
    const data = source?._data ?? source?.serialize?.().data ?? null;
    return { styleLoaded: Boolean(map?.isStyleLoaded()), source: data?.geojson ?? data, rendered: (map?.queryRenderedFeatures(undefined, { layers: ['journey-route'] }).length ?? 0) > 0 };
  })).toMatchObject({ styleLoaded: true, source: { type: 'FeatureCollection', features: [{ geometry: route }] }, rendered: true });
}

test('renders repeated-origin waypoints exactly and preserves the page', async ({ page }) => {
  await page.goto('/share/key/route-waypoints');
  await expect(page.locator('[data-phase="3-map-seam"]')).toHaveAttribute('data-route-vertex-count', '3');
  await expectRouteSource(page, waypointRoute);
  await expectPageSurvives(page, 'Waypoint route proof');
});

test('renders exact MultiLineString GeoJSON without flattening segments', async ({ page }) => {
  await page.goto('/share/key/route-geojson');
  await expect(page.locator('[data-phase="3-map-seam"]')).toHaveAttribute('data-route-vertex-count', '4');
  await expectRouteSource(page, geojsonRoute);
  await expectPageSurvives(page, 'Exact GeoJSON route proof');
});

test('renders a supported BRouter permalink response from the local fixture', async ({ page }) => {
  await page.goto('/share/key/route-brouter');
  await expectRouteSource(page, brouterRoute);
  await expectPageSurvives(page, 'BRouter success proof');
});

test('renders the supplied BRouter-Web permalink through the live BRouter service', async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_BROUTER_E2E, 'set RUN_LIVE_BROUTER_E2E=true to exercise public BRouter');
  const diagnostics: string[] = [];
  page.on('console', (message) => { if (message.text().includes('route-failure')) diagnostics.push(message.text()); });
  await page.goto('/share/key/route-brouter-live');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveAttribute('data-route-ready', 'true');
  await expect(seam).toHaveAttribute('data-route-layer-ready', 'true');
  expect(diagnostics).toEqual([]);
});

test('shows deterministic route failure while narrative, gallery, and markers survive', async ({ page }) => {
  await page.goto('/share/key/route-brouter-failure');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveAttribute('data-route-ready', 'false');
  await expect(seam).toHaveAttribute('data-marker-count', '2');
  await expect(page.locator('p[role="status"]', { hasText: 'The map route service failed; showing locations only.' })).toBeVisible();
  await expect(page.locator('p[role="status"]', { hasText: 'Interactive journey map' })).toBeVisible();
  await expectPageSurvives(page, 'BRouter failure proof');
});

test('rejects an unsupported BRouter profile without falling back to GPS', async ({ page }) => {
  await page.goto('/share/key/route-brouter-unsupported');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveAttribute('data-route-ready', 'false');
  await expect(page.locator('p[role="status"]', { hasText: 'The selected route profile is not supported; showing locations only.' })).toBeVisible();
  await expectPageSurvives(page, 'Unsupported route proof');
});

test('reset view button re-fits the map after panning away', async ({ page }) => {
  await page.goto('/share/key/route-waypoints');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveAttribute('data-route-ready', 'true');
  const button = page.locator('.maplibregl-ctrl-reset-view');
  await expect(button).toBeVisible();

  await page.waitForFunction(() => (globalThis as typeof globalThis & { __immichPagesMap?: any }).__immichPagesMap?.isStyleLoaded?.());
  const readState = () => page.evaluate(() => {
    const map = (globalThis as typeof globalThis & { __immichPagesMap?: any }).__immichPagesMap;
    const center = map?.getCenter();
    return { lng: center?.lng, lat: center?.lat, zoom: map?.getZoom() };
  });
  // The initial fitBounds() call on load animates over up to 600ms; give it time to settle
  // before recording the baseline, or "before" would just be the pre-fit construction center.
  await page.waitForTimeout(900);
  const before = await readState();

  await page.evaluate(() => (globalThis as typeof globalThis & { __immichPagesMap?: any }).__immichPagesMap?.jumpTo({ center: [0, 0], zoom: 1 }));
  await expect.poll(async () => {
    const panned = await readState();
    return Math.abs(panned.lng - before.lng) > 1;
  }, { timeout: 5000 }).toBe(true);

  await button.click();
  await expect.poll(async () => {
    const after = await readState();
    return Math.abs(after.lng - before.lng) < 0.5 && Math.abs(after.lat - before.lat) < 0.5 && Math.abs(after.zoom - before.zoom) < 0.5;
  }, { timeout: 5000 }).toBe(true);
});

