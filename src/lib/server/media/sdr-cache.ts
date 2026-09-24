export type CachedMedia = { body: Uint8Array; contentType: string };

type Entry = { value: CachedMedia; expiresAt: number; bytes: number };
type QueueItem<T> = { task: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const SDR_CACHE_VERSION = 'heic-jpeg-v1';
export const SDR_CACHE_TTL_MS = positiveEnv('SDR_CACHE_TTL_MS', 30 * 60 * 1000, 24 * 60 * 60 * 1000);
export const SDR_CACHE_MAX_ENTRIES = positiveEnv('SDR_CACHE_MAX_ENTRIES', 128, 2048);
export const SDR_CACHE_MAX_BYTES = positiveEnv('SDR_CACHE_MAX_BYTES', 128 * 1024 * 1024, 1024 * 1024 * 1024);
export const SDR_MAX_CONCURRENT = positiveEnv('SDR_MAX_CONCURRENT', 4, 32);
export const SDR_MAX_QUEUE = positiveEnv('SDR_MAX_QUEUE', 64, 256);

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedMedia>>();
let totalBytes = 0;
let activeConversions = 0;
const waitingConversions: Array<QueueItem<unknown>> = [];

/** Cache identity deliberately contains pipeline and source facts, never auth material. */
export function buildSdrCacheKey(input: { assetId: string; sourceIdentity: string; version?: string }): string {
	const safe = (value: string) => value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
	return [input.version ?? SDR_CACHE_VERSION, safe(input.assetId), safe(input.sourceIdentity)].join(':');
}

function evict(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) {
			entries.delete(key);
			totalBytes -= entry.bytes;
		}
	}
	while (entries.size > SDR_CACHE_MAX_ENTRIES || totalBytes > SDR_CACHE_MAX_BYTES) {
		const oldest = entries.keys().next().value as string | undefined;
		if (!oldest) break;
		const entry = entries.get(oldest);
		entries.delete(oldest);
		totalBytes -= entry?.bytes ?? 0;
	}
}

export function getCachedSdr(key: string, now = Date.now()): CachedMedia | undefined {
	evict(now);
	const entry = entries.get(key);
	if (!entry) return undefined;
	entries.delete(key);
	entries.set(key, entry);
	return entry.value;
}

function cacheSuccessful(key: string, value: CachedMedia): CachedMedia {
	if (!(value.body instanceof Uint8Array) || value.body.byteLength === 0 || value.body.byteLength > SDR_CACHE_MAX_BYTES) return value;
	if (!/^image\/jpeg$/i.test(value.contentType)) return value;
	const old = entries.get(key);
	if (old) totalBytes -= old.bytes;
	entries.delete(key);
	entries.set(key, { value, expiresAt: Date.now() + SDR_CACHE_TTL_MS, bytes: value.body.byteLength });
	totalBytes += value.body.byteLength;
	evict(Date.now());
	return value;
}

export function getOrCreateSdr(key: string, create: () => Promise<CachedMedia>, now = Date.now()): Promise<CachedMedia> {
	const cached = getCachedSdr(key, now);
	if (cached) return Promise.resolve(cached);
	const current = inFlight.get(key);
	if (current) return current;
	const promise = create().then((value) => cacheSuccessful(key, value)).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

export function clearSdrCache(): void {
	entries.clear();
	inFlight.clear();
	totalBytes = 0;
	while (waitingConversions.length) waitingConversions.shift()?.reject(new Error('sdr-cache-cleared'));
}

function pump(): void {
	while (activeConversions < SDR_MAX_CONCURRENT && waitingConversions.length) {
		const item = waitingConversions.shift()!;
		activeConversions += 1;
		item.task().then(item.resolve, item.reject).finally(() => {
			activeConversions -= 1;
			pump();
		});
	}
}

export function withSdrConcurrency<T>(task: () => Promise<T>): Promise<T> {
	if (activeConversions >= SDR_MAX_CONCURRENT && waitingConversions.length >= SDR_MAX_QUEUE) return Promise.reject(new Error('sdr-queue-full'));
	return new Promise<T>((resolve, reject) => {
		waitingConversions.push({ task: async () => task(), resolve: (value) => resolve(value as T), reject });
		pump();
	});
}
