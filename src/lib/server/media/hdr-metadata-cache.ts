import type { AppleHdrMetadata } from './hdr-metadata';

type Entry = { value: AppleHdrMetadata | undefined; expiresAt: number };

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const HDR_METADATA_CACHE_TTL_MS = positiveEnv('HDR_METADATA_CACHE_TTL_MS', 30 * 60 * 1000, 24 * 60 * 60 * 1000);
export const HDR_METADATA_CACHE_MAX_ENTRIES = positiveEnv('HDR_METADATA_CACHE_MAX_ENTRIES', 512, 8192);

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<AppleHdrMetadata | undefined>>();

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
	const promise = extract().then((value) => {
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
}
