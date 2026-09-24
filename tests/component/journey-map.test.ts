// Source-text contract: asserts on raw .svelte source, not rendered DOM/behavior. See tests/component/gallery-asset.render.test.ts for a real render-based example.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/journal/JourneyMapSlot.svelte', 'utf8');
const focus = readFileSync('src/lib/components/journal/map-focus.ts', 'utf8');

describe('journey map component contract', () => {
	it('keeps map enhancement client-only and disabled by default', () => {
		expect(source).toContain('onMount'); expect(source).toContain("import('maplibre-gl')"); expect(source).toContain('enabled = false'); expect(source).toContain('map?.remove()');
	});
	it('uses approved style and server marker data without browser Immich access', () => {
		expect(source).toContain('clusterRadius'); expect(source).toContain('clusterMaxZoom: 14'); expect(source).toContain('clustering = true'); expect(source).toContain('showMarkerList = false'); expect(source).toContain('markerColor'); expect(source).not.toMatch(/fetch\(|\/api\/|authorization|cookie/i);
		expect(source).toContain('routeColor'); expect(source).toContain('routeWidth');
		expect(source).toContain('routeStartColor'); expect(source).toContain('routeEndColor'); expect(source).toContain('journey-route-start'); expect(source).toContain('journey-route-end');
		expect(source.indexOf("id: 'journey-route'")).toBeLessThan(source.indexOf("id: 'journey-points'"));
		expect(source).toContain('data-route-layer-ready={routeLayerReady}');
		expect(source).toContain('map.on(\'error\', reportMapError)');
		expect(source).toContain('getClusterExpansionZoom'); expect(source).toContain('getClusterLeaves'); expect(source).toContain('collocated-marker-limit');
	});
	it('checks membership before exact gallery focus and highlight', () => {
		expect(focus).toMatch(/allowedIds\.has\(assetId\)/); expect(focus).toContain('asset-${assetId}'); expect(focus).toContain('scrollIntoView'); expect(focus).toContain('map-focus-highlight');
	});
	it('keeps semantic fallbacks and accessibility surfaces independent of WebGL', () => {
		expect(source).toContain('Map unavailable; the narrative and gallery remain available.');
		expect(source).toContain('No location data is available for this journey.');
		expect(source).toContain('aria-live="polite"');
		expect(source).toContain('aria-label="Journey map"');
		expect(source).not.toContain('>Journey map<');
		expect(source).not.toContain('Interactive journey map');
		expect(source).toContain('prefers-reduced-motion');
		expect(source).toContain('min-height: 280px');
	});
	it('renders deterministic safe copy for every route failure category', () => {
		expect(source).toContain('brouter-profile-unsupported');
		expect(source).toContain('brouter-endpoint-unsafe');
		expect(source).toContain('brouter-timeout');
		expect(source).toContain('brouter-route-rejected');
		expect(source).toContain('brouter-response-too-large');
		expect(source).toContain('showing locations only.');
		expect(source).toContain("reportJournalDebug('route-failure'");
		expect(source).toContain("return 'check-road-access'");
	});
	it('keeps bounded clusters and all semantic marker choices reachable', () => {
		expect(source).toContain('getClusterLeaves(Number(feature.properties.cluster_id), MAX_COLLOCATED_LEAVES, 0)');
		expect(source).toContain('markers as marker');
		expect(source).toContain('MAX_COLLOCATED_LEAVES');
	});
});
