import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import fixture from '../fixtures/shared-link/v3-valid-page.json';

const description = (map = '') => `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n${map}---\n# Story`;

describe('route SSR tracer', () => {
	it('traces an asymmetric closed waypoint route into the normalized page model', async () => {
		const response = { ...fixture, album: { ...fixture.album, description: description('    enabled: true\n    source: waypoints\n    waypoints:\n      - [20, 10]\n      - [21, 11]\n      - [20, 10]\n') } };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.includes('map-markers') ? JSON.stringify([]) : JSON.stringify(response)));
		const result = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), { shareRef: { kind: 'key', value: 'opaque_ref' }, cookie: null, authorization: null }, 'trace');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.routeData).toEqual({ type: 'LineString', coordinates: [[20, 10], [21, 11], [20, 10]] });
	});
});
