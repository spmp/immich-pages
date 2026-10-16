import type { AppleHdrMetadata } from './hdr-metadata';

type Entry = { value: AppleHdrMetadata | undefined; expiresAt: number };

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const HDR_METADATA_CACHE_TTL_MS = positiveEnv('HDR_METADATA_CACHE_TTL_MS', 30 * 60 * 1000, 24 * 60 * 60 * 1000);
export const HDR_METADATA_CACHE_MAX_ENTRIES = positiveEnv('HDR_METADATA_CACHE_MAX_ENTRIES', 512, 8192);
// Caching dedupes repeat requests for the SAME asset, but a first page load of N distinct,
// never-before-seen assets still spawns up to N concurrent exiftool processes with nothing
// bounding the total -- observed directly during real-backend UAT (several exiftool processes
// simultaneously at ~100% CPU each). Mirrors sdr-cache.ts's withSdrConcurrency exactly.
export const HDR_METADATA_MAX_CONCURRENT = positiveEnv('HDR_METADATA_MAX_CONCURRENT', 3, 32);
export const HDR_METADATA_MAX_QUEUE = positiveEnv('HDR_METADATA_MAX_QUEUE', 64, 256);

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<AppleHdrMetadata | undefined>>();

type QueueItem<T> = { task: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
let activeExtractions = 0;
const waitingExtractions: Array<QueueItem<unknown>> = [];

function pump(): void {
	while (activeExtractions < HDR_METADATA_MAX_CONCURRENT && waitingExtractions.length) {
		const item = waitingExtractions.shift()!;
		activeExtractions += 1;
		item.task().then(item.resolve, item.reject).finally(() => {
			activeExtractions -= 1;
			pump();
		});
	}
}

export function withHdrMetadataConcurrency<T>(task: () => Promise<T>): Promise<T> {
	if (activeExtractions >= HDR_METADATA_MAX_CONCURRENT && waitingExtractions.length >= HDR_METADATA_MAX_QUEUE) return Promise.reject(new Error('hdr-metadata-queue-full'));
	return new Promise<T>((resolve, reject) => {
		waitingExtractions.push({ task: async () => task(), resolve: (value) => resolve(value as T), reject });
		pump();
	});
}

/**
 * Whether an asset carries Apple HDR gain-map metadata is a property of its bytes, independent
 * of what the metadata itself says, so this only needs asset identity + upstream cache-validator
 * headers -- available without reading the (potentially 100MB) original body first. Caching the
 * negative result matters most: most HEIC photos are not HDR, and without this every one of them
 * paid a full re-download of the original plus an exiftool spawn on every single request.
 */
export function buildHdrMetadataCacheKey(input: { assetId: string; sourceIdentity: string }): string {
	const safe = (value: string) => value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
	return [safe(input.assetId), safe(input.sourceIdentity)].join(':');
}

function evict(now: number): void {
	for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
	while (entries.size > HDR_METADATA_CACHE_MAX_ENTRIES) {
		const oldest = entries.keys().next().value as string | undefined;
		if (!oldest) break;
		entries.delete(oldest);
	}
}

export function getCachedHdrMetadata(key: string, now = Date.now()): { hit: true; value: AppleHdrMetadata | undefined } | { hit: false } {
	evict(now);
	const entry = entries.get(key);
	if (!entry) return { hit: false };
	entries.delete(key);
	entries.set(key, entry);
	return { hit: true, value: entry.value };
}

export function getOrExtractHdrMetadata(key: string, extract: () => Promise<AppleHdrMetadata | undefined>, now = Date.now()): Promise<AppleHdrMetadata | undefined> {
	const cached = getCachedHdrMetadata(key, now);
	if (cached.hit) return Promise.resolve(cached.value);
	const current = inFlight.get(key);
	if (current) return current;
	const promise = withHdrMetadataConcurrency(extract).then((value) => {
		entries.delete(key);
		entries.set(key, { value, expiresAt: Date.now() + HDR_METADATA_CACHE_TTL_MS });
		evict(Date.now());
		return value;
	}).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

export function clearHdrMetadataCache(): void {
	entries.clear();
	inFlight.clear();
	while (waitingExtractions.length) waitingExtractions.shift()?.reject(new Error('hdr-metadata-cache-cleared'));
}
