import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import fixture from '../fixtures/shared-link/v3-valid-page.json';

const a = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';
const description = (map = '') => `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n${map}---\n# Story`;

describe('map SSR tracer', () => {
	it('projects authorized markers and derives an auto route without browser map code', async () => {
		const response = { ...fixture, album: { ...fixture.album, description: description('    enabled: true\n') }, assets: [{ ...fixture.assets[0], id: a, localDateTime: '2024-01-01T00:00:00Z' }, { ...fixture.assets[0], id: b, localDateTime: '2024-01-02T00:00:00Z' }] };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.includes('map-markers') ? JSON.stringify([{ id: a, lat: 10, lon: 20, city: 'A', state: null, country: null }, { id: b, lat: 11, lon: 21, city: null, state: null, country: null }]) : JSON.stringify(response)));
		const result = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), { shareRef: { kind: 'key', value: 'opaque_ref' }, cookie: null, authorization: null }, 'trace');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.markers).toHaveLength(2);
		expect(result.page.routeData?.coordinates).toEqual([[20, 10], [21, 11]]);
	});

	it('keeps the default disabled and makes unsupported sources markers-only', async () => {
		const response = { ...fixture, album: { ...fixture.album, description: description('    enabled: true\n    source: geojson\n') } };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.includes('map-markers') ? JSON.stringify([]) : JSON.stringify(response)));
		const result = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), { shareRef: { kind: 'key', value: 'opaque_ref' }, cookie: null, authorization: null }, 'trace');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.markers).toEqual([]);
		expect(result.page.routeData).toBeNull();
		expect(result.page.warnings).toContain('map-source-unsupported');
	});
});
