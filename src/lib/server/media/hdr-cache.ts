export type CachedMedia = { body: Uint8Array; contentType: string; width?: number; height?: number };

type Entry = { value: CachedMedia; expiresAt: number; bytes: number };
type QueueItem<T> = { task: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; signal?: AbortSignal; timeoutMs?: number };

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const HDR_CACHE_VERSION = 'apple-gainmap-v3';
export const HDR_CACHE_TTL_MS = positiveEnv('HDR_CACHE_TTL_MS', 10 * 60 * 1000, 24 * 60 * 60 * 1000);
export const HDR_CACHE_MAX_ENTRIES = positiveEnv('HDR_CACHE_MAX_ENTRIES', 64, 1024);
export const HDR_CACHE_MAX_BYTES = positiveEnv('HDR_CACHE_MAX_BYTES', 128 * 1024 * 1024, 1024 * 1024 * 1024);
export const HDR_MAX_CONCURRENT = positiveEnv('HDR_MAX_CONCURRENT', 2, 32);
export const HDR_MAX_QUEUE = positiveEnv('HDR_MAX_QUEUE', 32, 256);

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedMedia>>();
let totalBytes = 0;
let activeConversions = 0;
const waitingConversions: Array<QueueItem<unknown>> = [];

/** Cache identity deliberately contains pipeline and output facts, never auth material. */
export function buildHdrCacheKey(input: {
	assetId: string;
	sourceIdentity: string;
	version?: string;
	width?: number;
	height?: number;
	outputContract?: string;
}): string {
	const safe = (value: string) => value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
	return [input.version ?? HDR_CACHE_VERSION, safe(input.assetId), safe(input.sourceIdentity), input.width ?? 'auto', input.height ?? 'auto', safe(input.outputContract ?? 'mp4-hevc-main10-pq-bt2020')].join(':');
}

function evict(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) {
			entries.delete(key);
			totalBytes -= entry.bytes;
		}
	}
	while (entries.size > HDR_CACHE_MAX_ENTRIES || totalBytes > HDR_CACHE_MAX_BYTES) {
		const oldest = entries.keys().next().value as string | undefined;
		if (!oldest) break;
		const entry = entries.get(oldest);
		entries.delete(oldest);
		totalBytes -= entry?.bytes ?? 0;
	}
}

export function getCachedHdr(key: string, now = Date.now()): CachedMedia | undefined {
	evict(now);
	const entry = entries.get(key);
	if (!entry) return undefined;
	entries.delete(key);
	entries.set(key, entry);
	return entry.value;
}

function cacheSuccessful(key: string, value: CachedMedia): CachedMedia {
	if (!(value.body instanceof Uint8Array) || value.body.byteLength === 0 || value.body.byteLength > HDR_CACHE_MAX_BYTES) return value;
	if (!/^video\/mp4$/i.test(value.contentType)) return value;
	const old = entries.get(key);
	if (old) totalBytes -= old.bytes;
	entries.delete(key);
	entries.set(key, { value, expiresAt: Date.now() + HDR_CACHE_TTL_MS, bytes: value.body.byteLength });
	totalBytes += value.body.byteLength;
	evict(Date.now());
	return value;
}

export function getOrCreateHdr(key: string, create: () => Promise<CachedMedia>, now = Date.now()): Promise<CachedMedia> {
	const cached = getCachedHdr(key, now);
	if (cached) return Promise.resolve(cached);
	const current = inFlight.get(key);
	if (current) return current;
	const promise = create().then((value) => cacheSuccessful(key, value)).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

export function clearHdrCache(): void {
	entries.clear();
	inFlight.clear();
	totalBytes = 0;
	while (waitingConversions.length) waitingConversions.shift()?.reject(new Error('hdr-cache-cleared'));
}

function pump(): void {
	while (activeConversions < HDR_MAX_CONCURRENT && waitingConversions.length) {
		const item = waitingConversions.shift()!;
		if (item.signal?.aborted) {
			item.reject(new DOMException('The HDR task was cancelled', 'AbortError'));
			continue;
		}
		activeConversions += 1;
		const timeout = item.timeoutMs && Number.isFinite(item.timeoutMs) ? Math.max(1, Math.min(item.timeoutMs, 120_000)) : undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const work = item.task();
		const timed = timeout ? Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('hdr-scheduler-timeout')), timeout); })]) : work;
		timed.then(item.resolve, item.reject).finally(() => {
			if (timer) clearTimeout(timer);
			activeConversions -= 1;
			pump();
		});
	}
}

export function withHdrConcurrency<T>(task: () => Promise<T>, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
	if (options.signal?.aborted) return Promise.reject(new DOMException('The HDR task was cancelled', 'AbortError'));
	if (activeConversions >= HDR_MAX_CONCURRENT && waitingConversions.length >= HDR_MAX_QUEUE) return Promise.reject(new Error('hdr-queue-full'));
	return new Promise<T>((resolve, reject) => {
		waitingConversions.push({ task: async () => task(), resolve: (value) => resolve(value as T), reject, signal: options.signal, timeoutMs: options.timeoutMs });
		pump();
	});
}
