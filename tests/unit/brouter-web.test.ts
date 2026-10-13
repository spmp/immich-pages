import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseBrouterWebPermalink, BRouterWebProfiles } from '../../src/lib/server/map/brouter-web';
import { DEFAULT_BROUTER_ALLOWED_ORIGINS, DEFAULT_BROUTER_ENDPOINT } from '../../src/lib/server/map/path-adapters';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/brouter-web/${name}`, import.meta.url), 'utf8').trim();
const forward = [[13.377485, 52.516247], [13.351221, 52.515004], [13.337, 52.52]];

describe('BRouter-Web permalink parser', () => {
	it('has a public BRouter service default for the built-in adapter', () => {
		expect(DEFAULT_BROUTER_ENDPOINT).toBe('https://brouter.de/brouter');
		expect(DEFAULT_BROUTER_ALLOWED_ORIGINS).toEqual(['https://brouter.de']);
	});

	it('decodes the checked-in forward, reverse, and encoded fixtures without fetching', () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		expect(parseBrouterWebPermalink(fixture('forward-trekking.txt'))).toMatchObject({ kind: 'resolved', profile: 'trekking', waypoints: forward });
		expect(parseBrouterWebPermalink(fixture('reverse-trekking.txt'))).toMatchObject({ kind: 'resolved', waypoints: [...forward].reverse() });
		expect(parseBrouterWebPermalink(fixture('encoded-forward-trekking.txt'))).toMatchObject({ kind: 'resolved', waypoints: forward });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('approves exactly the built-in profile allowlist', () => {
		for (const profile of BRouterWebProfiles) expect(parseBrouterWebPermalink(`https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=${profile}`).kind).toBe('resolved');
	});

	it('accepts the BRouter-Web map view and semicolon-separated waypoints', () => {
		const result = parseBrouterWebPermalink('https://brouter.de/brouter-web/#map=9/39.2914/-105.4253/standard&lonlats=-105.273743,40.014994;-105.24031,39.910964;-105.089607,39.553118&profile=car-fast');
		expect(result).toMatchObject({
			kind: 'resolved',
			profile: 'car-fast',
			waypoints: [[-105.273743, 40.014994], [-105.24031, 39.910964], [-105.089607, 39.553118]]
		});
	});

	it('ignores tracking query parameters that BRouter-Web also ignores', () => {
		const result = parseBrouterWebPermalink('https://brouter.de/brouter-web/?utm_source=chatgpt.com#map=18/37.74353/-105.50588/standard&lonlats=-105.273743,40.014994;-105.24031,39.910964;-105.089607,39.553118;-104.990787,39.475724;-105.505185,37.744602;-105.747645,38.021343;-105.258356,39.997946&profile=car-fast');
		expect(result).toMatchObject({ kind: 'resolved', profile: 'car-fast', waypoints: [[-105.273743, 40.014994], [-105.24031, 39.910964], [-105.089607, 39.553118], [-104.990787, 39.475724], [-105.505185, 37.744602], [-105.747645, 38.021343], [-105.258356, 39.997946]] });
	});

	it('rejects non-tracking query parameters', () => {
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/?profile=car-fast#lonlats=1,2%7C3,4')).toEqual({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
	});

	// Real-backend UAT (2026-10-12): no waypoint cap existed at all -- each waypoint beyond the
	// first costs one real, sequential, up-to-8s network round trip in BrouterClient.resolve(),
	// so an album owner pasting a permalink with hundreds of stops could make every visitor's
	// page load take minutes. Reported as "the map does not show" because nothing bounded it.
	it('caps the waypoint count so an unbounded permalink cannot force unbounded sequential network calls', () => {
		const tooMany = Array.from({ length: 66 }, (_, index) => `${index},${index % 90}`).join(';');
		const atLimit = Array.from({ length: 65 }, (_, index) => `${index},${index % 90}`).join(';');
		expect(parseBrouterWebPermalink(`https://brouter.de/brouter-web/#lonlats=${tooMany}&profile=trekking`)).toEqual({ kind: 'unavailable', warnings: ['map-route-limit'] });
		expect(parseBrouterWebPermalink(`https://brouter.de/brouter-web/#lonlats=${atLimit}&profile=trekking`).kind).toBe('resolved');
	});

	it('returns deterministic warnings for ambiguity, unsafe hosts, malformed coordinates, and unsupported profiles', () => {
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=custom_test')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-profile-unsupported'] });
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&lonlats=1,2%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
		expect(parseBrouterWebPermalink('https://evil.example/brouter-web/#lonlats=1,2%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,not-a-number%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
	});
});
