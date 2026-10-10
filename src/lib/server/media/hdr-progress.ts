import type { HdrProgressSnapshot, HdrRepresentation } from './hdr-prewarm';

export const HDR_PREWARM_MAX_BODY_BYTES = 16 * 1024;
export const HDR_PREWARM_MAX_POSITION = 100_000;
export const HDR_PREWARM_MAX_GENERATION = 2 ** 31 - 1;

const representations = new Set<HdrRepresentation>(['video', 'avif']);
const states = new Set<HdrProgressSnapshot['state']>(['preparing', 'ready', 'partial']);

/**
 * Copy only the aggregate fields that are safe to return to a browser. In
 * particular, coordinator jobs, cache keys, errors, URLs, and asset bytes do
 * not cross this boundary.
 */
export function redactHdrProgress(snapshot: HdrProgressSnapshot): HdrProgressSnapshot {
	const bounded = (value: number) => Number.isSafeInteger(value) ? Math.max(0, Math.min(value, 100_000)) : 0;
	const generation = Number.isSafeInteger(snapshot.generation) ? Math.max(0, Math.min(snapshot.generation, HDR_PREWARM_MAX_GENERATION)) : 0;
	const representation = representations.has(snapshot.representation) ? snapshot.representation : 'video';
	const state = states.has(snapshot.state) ? snapshot.state : 'partial';
	return {
		generation,
		representation,
		state,
		targeted: bounded(snapshot.targeted),
		queued: bounded(snapshot.queued),
		running: bounded(snapshot.running),
		completed: bounded(snapshot.completed),
		failed: bounded(snapshot.failed),
		skipped: bounded(snapshot.skipped)
	};
}

export function emptyHdrProgress(generation: number, representation: HdrRepresentation, state: HdrProgressSnapshot['state'] = 'ready'): HdrProgressSnapshot {
	return redactHdrProgress({ generation, representation, state, targeted: 0, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 });
}

export function progressHeaders(): Headers {
	return new Headers({ 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8', vary: 'Cookie, Authorization' });
}
