import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/journal/JourneyMapSlot.svelte', 'utf8');
const focus = readFileSync('src/lib/components/journal/map-focus.ts', 'utf8');

describe('journey map component contract', () => {
	it('keeps map enhancement client-only and disabled by default', () => {
		expect(source).toContain('onMount'); expect(source).toContain("import('maplibre-gl')"); expect(source).toContain('enabled = false'); expect(source).toContain('map?.remove()');
	});
	it('uses approved style and server marker data without browser Immich access', () => {
		expect(source).toContain('clusterRadius: 48'); expect(source).toContain('clusterMaxZoom: 14'); expect(source).not.toMatch(/fetch\(|\/api\/|authorization|cookie/i);
		expect(source).toContain('getClusterExpansionZoom'); expect(source).toContain('getClusterLeaves'); expect(source).toContain('collocated-marker-limit');
	});
	it('checks membership before exact gallery focus and highlight', () => {
		expect(focus).toMatch(/allowedIds\.has\(assetId\)/); expect(focus).toContain('asset-${assetId}'); expect(focus).toContain('scrollIntoView'); expect(focus).toContain('map-focus-highlight');
	});
});
