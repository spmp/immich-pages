import type { MapWarning } from './types';
import type { Waypoint } from './path-adapters';

export const BRouterWebProfiles = ['trekking', 'fastbike', 'safety', 'shortest', 'car-fast', 'car-eco'] as const;
export type BRouterWebProfile = (typeof BRouterWebProfiles)[number];
export type BRouterWebParseResult =
	| { kind: 'resolved'; waypoints: Waypoint[]; profile: BRouterWebProfile; warnings: MapWarning[] }
	| { kind: 'unavailable'; warnings: MapWarning[] };

const invalid = (warning: MapWarning = 'brouter-permalink-invalid'): BRouterWebParseResult => ({ kind: 'unavailable', warnings: [warning] });

export function parseBrouterWebPermalink(value: string): BRouterWebParseResult {
	let url: URL;
	try { url = new URL(value); } catch { return invalid(); }
	if (url.protocol !== 'https:' || url.hostname !== 'brouter.de' || url.port || url.pathname !== '/brouter-web/' || url.username || url.password || url.search) return invalid();
	let fragment: string;
	try { fragment = decodeURIComponent(url.hash.slice(1)); } catch { return invalid(); }
	const params = new URLSearchParams(fragment);
	const allowed = new Set(['lonlats', 'profile', 'alternativeidx']);
	if ([...params.keys()].some((key) => !allowed.has(key))) {
		// View state is intentionally ignored, but is still surfaced as a safe warning.
	}
	if (params.getAll('lonlats').length !== 1 || params.getAll('profile').length !== 1 || params.getAll('alternativeidx').length > 1) return invalid();
	if (params.has('alternativeidx') && params.get('alternativeidx') !== '0') return invalid('brouter-permalink-unsupported');
	const profile = params.get('profile');
	if (!BRouterWebProfiles.includes(profile as BRouterWebProfile)) return invalid('brouter-profile-unsupported');
	const rawWaypoints = params.get('lonlats')?.split('|') ?? [];
	if (rawWaypoints.length < 2) return invalid();
	const waypoints: Waypoint[] = [];
	for (const raw of rawWaypoints) {
		const parts = raw.split(',');
		if (parts.length !== 2 || !parts.every((part) => part.trim() !== '' && /^[-+]?\d+(?:\.\d+)?$/.test(part.trim()))) return invalid();
		const point = parts.map(Number) as Waypoint;
		if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) return invalid();
		waypoints.push(point);
	}
	const warnings: MapWarning[] = [...params.keys()].some((key) => !allowed.has(key)) ? ['brouter-permalink-unsupported'] : [];
	return { kind: 'resolved', waypoints, profile: profile as BRouterWebProfile, warnings };
}
