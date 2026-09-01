import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseBrouterWebPermalink, BRouterWebProfiles } from '../../src/lib/server/map/brouter-web';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/brouter-web/${name}`, import.meta.url), 'utf8').trim();
const forward = [[13.377485, 52.516247], [13.351221, 52.515004], [13.337, 52.52]];

describe('BRouter-Web permalink parser', () => {

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

	it('returns deterministic warnings for ambiguity, unsafe hosts, malformed coordinates, and unsupported profiles', () => {
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=custom_test')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-profile-unsupported'] });
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&lonlats=1,2%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
		expect(parseBrouterWebPermalink('https://evil.example/brouter-web/#lonlats=1,2%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
		expect(parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,not-a-number%7C3,4&profile=trekking')).toMatchObject({ kind: 'unavailable', warnings: ['brouter-permalink-invalid'] });
	});
});
