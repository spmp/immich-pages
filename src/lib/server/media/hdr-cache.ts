import { HdrDiskCache } from './hdr-disk-cache';

export type CachedMedia = { body: Uint8Array; contentType: string; width?: number; height?: number };

type Entry = { value: CachedMedia; expiresAt: number; bytes: number };
export type HdrConversionPriority = 'background' | 'interactive';
type QueueItem<T> = { task: (signal: AbortSignal) => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; signal?: AbortSignal; timeoutMs?: number; priority: HdrConversionPriority; sequence: number };

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
export const HDR_MAX_INTERACTIVE_BURST = positiveEnv('HDR_MAX_INTERACTIVE_BURST', 4, 32);
// Memory is always the fast tier. HDR_CACHE_BACKEND=disk adds HDR_CACHE_DIRECTORY as a second,
// larger tier that survives restarts (see hdr-disk-cache.ts); without a usable directory it
// falls back to memory only and says so in the log.
export type HdrCacheBackendName = 'memory' | 'disk';
export const HDR_CACHE_DIRECTORY = process.env.HDR_CACHE_DIRECTORY?.trim() ? process.env.HDR_CACHE_DIRECTORY.trim().slice(0, 256) : undefined;
export const HDR_CACHE_DISK_MAX_BYTES = positiveEnv('HDR_CACHE_DISK_MAX_BYTES', 2 * 1024 * 1024 * 1024, 1024 * 1024 * 1024 * 1024);
const diskRequested = process.env.HDR_CACHE_BACKEND === 'disk';
if (diskRequested && !HDR_CACHE_DIRECTORY) console.warn(JSON.stringify({ event: 'direct-share.hdr-disk-cache-unavailable', reason: 'no-directory' }));
const diskCache = diskRequested && HDR_CACHE_DIRECTORY ? new HdrDiskCache({ directory: HDR_CACHE_DIRECTORY, maxBytes: HDR_CACHE_DISK_MAX_BYTES, log: (event) => console.info(JSON.stringify(event)) }) : undefined;
let diskAvailable = false;
const diskReady: Promise<void> = diskCache ? diskCache.init().then((available) => { diskAvailable = available; }) : Promise.resolve();
const pendingDiskWrites = new Set<Promise<void>>();
/** The backend actually in use: 'disk' only once the directory has proven writable. */
export let HDR_CACHE_BACKEND: HdrCacheBackendName = 'memory';
void diskReady.then(() => { if (diskAvailable) HDR_CACHE_BACKEND = 'disk'; });

/** Resolves once the disk tier (if configured) has indexed its directory. */
export function hdrDiskCacheReady(): Promise<void> {
	return diskReady;
}

/** Resolves once every disk write started so far has finished; for tests and orderly shutdown. */
export async function hdrDiskWritesSettled(): Promise<void> {
	while (pendingDiskWrites.size) await Promise.all([...pendingDiskWrites]);
}

export type HdrCacheStats = { entries: number; bytes: number; inFlight: number };
export type HdrCacheBackend = {
	get: (key: string, now?: number) => CachedMedia | undefined;
	put: (key: string, value: CachedMedia, now?: number) => CachedMedia;
	delete: (key: string) => void;
	clear: () => void;
	stats: () => HdrCacheStats;
};

/** Shared source identity for page/control prewarm and media routes. */
export function buildHdrSourceIdentity(input: {
	headers: Headers;
	assetId: string;
	metadata?: { version: string; sourceProfile: string; sourceTransfer: string; orientation: number };
	byteLength?: number;
}): string {
	const identity = [input.headers.get('etag'), input.headers.get('last-modified'), input.headers.get('content-length'), input.metadata?.version, input.metadata?.sourceProfile, input.metadata?.sourceTransfer, input.metadata?.orientation].filter(Boolean).join('|');
	return identity || `bytes-${input.byteLength ?? 0}` || `asset-${input.assetId}`;
}

console.info(JSON.stringify({ event: 'direct-share.hdr-cache-config', ttlMs: HDR_CACHE_TTL_MS, maxEntries: HDR_CACHE_MAX_ENTRIES, maxBytes: HDR_CACHE_MAX_BYTES, maxConcurrent: HDR_MAX_CONCURRENT, maxQueue: HDR_MAX_QUEUE, maxInteractiveBurst: HDR_MAX_INTERACTIVE_BURST }));

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedMedia>>();
let totalBytes = 0;
let activeConversions = 0;
const waitingConversions: Array<QueueItem<unknown>> = [];
const queuedConversions = new Map<string, QueueItem<unknown>>();
let queueSequence = 0;
let consecutiveInteractiveStarts = 0;

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
	return [input.version ?? HDR_CACHE_VERSION, safe(input.assetId), safe(input.sourceIdentity), input.width ?? 'auto', input.height ?? 'auto', safe(input.outputContract ?? 'mp4-hevc-main10-pq-bt2020-w203')].join(':');
}

function evict(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.expiresAt <= now) {
			entries.delete(key);
			totalBytes -= entry.bytes;
			console.info(JSON.stringify({ event: 'direct-share.hdr-cache-evict', reason: 'expired', cacheEntries: entries.size, cacheBytes: totalBytes }));
		}
	}
	while (entries.size > HDR_CACHE_MAX_ENTRIES || totalBytes > HDR_CACHE_MAX_BYTES) {
		const oldest = entries.keys().next().value as string | undefined;
		if (!oldest) break;
		const entry = entries.get(oldest);
		entries.delete(oldest);
		totalBytes -= entry?.bytes ?? 0;
		console.info(JSON.stringify({ event: 'direct-share.hdr-cache-evict', reason: 'capacity', cacheEntries: entries.size, cacheBytes: totalBytes }));
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

export function getHdrCacheState(): { entries: number; bytes: number; inFlight: number; activeConversions: number; waitingConversions: number; interactiveWaitingConversions: number } {
	return { entries: entries.size, bytes: totalBytes, inFlight: inFlight.size, activeConversions, waitingConversions: waitingConversions.length, interactiveWaitingConversions: waitingConversions.filter((item) => item.priority === 'interactive').length };
}

function cacheSuccessful(key: string, value: CachedMedia, assetId?: string, persist = true): CachedMedia {
	if (persist && diskAvailable && diskCache) {
		const write = diskCache.write(key, value).finally(() => pendingDiskWrites.delete(write));
		pendingDiskWrites.add(write);
	}
	if (!(value.body instanceof Uint8Array) || value.body.byteLength === 0 || value.body.byteLength > HDR_CACHE_MAX_BYTES) return value;
	if (!/^(video\/mp4|image\/avif)$/i.test(value.contentType)) return value;
	const old = entries.get(key);
	if (old) totalBytes -= old.bytes;
	entries.delete(key);
	entries.set(key, { value, expiresAt: Date.now() + HDR_CACHE_TTL_MS, bytes: value.body.byteLength });
	totalBytes += value.body.byteLength;
	// assetId + the full cache key (hdr-caching-uat-20261010 finding 6a): without these, no log
	// could identify WHICH asset a given miss/hit/store was for. The key is already sanitized by
	// buildHdrCacheKey's own safe() escaping -- it contains pipeline/output facts, never auth
	// material -- so it is safe to log verbatim, same as the rest of this module's diagnostics.
	console.info(JSON.stringify({ event: 'direct-share.hdr-cache-store', assetId, cacheKey: key, bytes: value.body.byteLength, cacheEntries: entries.size, cacheBytes: totalBytes }));
	evict(Date.now());
	return value;
}

export function getOrCreateHdr(key: string, create: () => Promise<CachedMedia>, now = Date.now(), priority: HdrConversionPriority = 'background', assetId?: string): Promise<CachedMedia> {
	const cached = getCachedHdr(key, now);
	if (cached) {
		console.info(JSON.stringify({ event: 'direct-share.hdr-cache-hit', assetId, cacheKey: key, cacheEntries: entries.size, cacheBytes: totalBytes }));
		return Promise.resolve(cached);
	}
	const current = inFlight.get(key);
	if (current) {
		if (priority === 'interactive') {
			const queued = queuedConversions.get(key);
			if (queued) queued.priority = 'interactive';
		}
		console.info(JSON.stringify({ event: 'direct-share.hdr-cache-inflight-join', assetId, cacheKey: key, inFlight: inFlight.size }));
		return current;
	}
	console.info(JSON.stringify({ event: 'direct-share.hdr-cache-miss', assetId, cacheKey: key, cacheEntries: entries.size, cacheBytes: totalBytes }));
	// Without a disk tier, create() starts synchronously exactly as before.
	const convert = () => create().then((value) => cacheSuccessful(key, value, assetId));
	const promise = (diskAvailable && diskCache?.has(key)
		? readFromDisk(key, assetId).then((value) => value ?? convert())
		: convert()
	).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

async function readFromDisk(key: string, assetId?: string): Promise<CachedMedia | undefined> {
	const value = await diskCache?.read(key);
	if (!value) return undefined;
	console.info(JSON.stringify({ event: 'direct-share.hdr-cache-hit', source: 'disk', assetId, cacheKey: key, cacheEntries: entries.size, cacheBytes: totalBytes }));
	// Back into the memory tier for the synchronous fast paths; it is already on disk.
	return cacheSuccessful(key, value, assetId, false);
}

/** Whether a result is kept in either tier, without reading it. */
export function hasCachedHdr(key: string, now = Date.now()): boolean {
	const entry = entries.get(key);
	if (entry && entry.expiresAt > now) return true;
	return diskAvailable && Boolean(diskCache?.has(key));
}

/**
 * Memory, then disk. For the media routes' fast path, which must know whether a conversion is
 * cached BEFORE paying to download the original from Immich.
 */
export async function lookupCachedHdr(key: string, now = Date.now()): Promise<CachedMedia | undefined> {
	const cached = getCachedHdr(key, now);
	if (cached) return cached;
	await diskReady;
	return diskAvailable && diskCache?.has(key) ? readFromDisk(key) : undefined;
}

/** Empties the memory tier (and the disk tier, if present) -- the disk tier asynchronously. */
export function clearHdrCache(): void {
	if (diskCache) void diskCache.clear();
	entries.clear();
	inFlight.clear();
	queuedConversions.clear();
	totalBytes = 0;
	consecutiveInteractiveStarts = 0;
	while (waitingConversions.length) waitingConversions.shift()?.reject(new Error('hdr-cache-cleared'));
}

function pump(): void {
	while (activeConversions < HDR_MAX_CONCURRENT && waitingConversions.length) {
		const backgroundWaiting = waitingConversions.some((item) => item.priority === 'background');
		const forceBackground = backgroundWaiting && consecutiveInteractiveStarts >= HDR_MAX_INTERACTIVE_BURST;
		const itemIndex = forceBackground
			? waitingConversions.findIndex((item) => item.priority === 'background')
			: waitingConversions.reduce((best, item, index, queue) => {
				const current = queue[best];
				return item.priority === 'interactive' && current.priority !== 'interactive' || item.priority === current.priority && item.sequence < current.sequence ? index : best;
			}, 0);
		const item = waitingConversions.splice(itemIndex, 1)[0];
		for (const [key, queued] of queuedConversions) if (queued === item) queuedConversions.delete(key);
		if (item.priority === 'interactive') consecutiveInteractiveStarts += 1;
		else consecutiveInteractiveStarts = 0;
		if (item.signal?.aborted) {
			item.reject(new DOMException('The HDR task was cancelled', 'AbortError'));
			continue;
		}
		activeConversions += 1;
		console.info(JSON.stringify({ event: 'direct-share.hdr-queue-start', activeConversions, queueDepth: waitingConversions.length, priority: item.priority }));
		const timeout = item.timeoutMs && Number.isFinite(item.timeoutMs) ? Math.max(1, Math.min(item.timeoutMs, 120_000)) : undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const controller = new AbortController();
		if (item.signal) item.signal.addEventListener('abort', () => controller.abort(), { once: true });
		const work = item.task(controller.signal);
		const timed = timeout ? Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('hdr-scheduler-timeout')); }, timeout); })]) : work;
			timed.then(item.resolve, item.reject).finally(() => {
			if (timer) clearTimeout(timer);
			activeConversions -= 1;
			console.info(JSON.stringify({ event: 'direct-share.hdr-queue-finish', activeConversions, queueDepth: waitingConversions.length, priority: item.priority }));
			pump();
		});
	}
}

/**
 * Whether a task of this priority would be admitted right now. The queue cap applies per
 * priority: background prewarm work can fill its share of the queue, but never blocks a photo a
 * visitor has just opened.
 */
export function hdrQueueHasRoom(priority: HdrConversionPriority = 'background'): boolean {
	if (activeConversions < HDR_MAX_CONCURRENT) return true;
	return waitingConversions.filter((item) => item.priority === priority).length < HDR_MAX_QUEUE;
}

export function withHdrConcurrency<T>(task: (signal?: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; timeoutMs?: number; priority?: HdrConversionPriority; queueKey?: string } = {}): Promise<T> {
	if (options.signal?.aborted) return Promise.reject(new DOMException('The HDR task was cancelled', 'AbortError'));
	if (!hdrQueueHasRoom(options.priority ?? 'background')) return Promise.reject(new Error('hdr-queue-full'));
	return new Promise<T>((resolve, reject) => {
		const priority = options.priority ?? 'background';
		const item = { task: async (signal: AbortSignal) => task(signal), resolve: (value: T) => resolve(value), reject, signal: options.signal, timeoutMs: options.timeoutMs, priority, sequence: queueSequence++ } satisfies QueueItem<T>;
		waitingConversions.push(item as QueueItem<unknown>);
		if (options.queueKey) queuedConversions.set(options.queueKey, item as QueueItem<unknown>);
		console.info(JSON.stringify({ event: 'direct-share.hdr-queue-enqueue', activeConversions, queueDepth: waitingConversions.length, priority }));
		pump();
	});
}

export function getHdrCacheBackendConfig(): { backend: HdrCacheBackendName; directory?: string; diskWrites: boolean } {
	// Memory only by default: diskWrites: false unless HDR_CACHE_BACKEND=disk with a usable directory.
	return diskAvailable
		? { backend: 'disk', directory: HDR_CACHE_DIRECTORY, diskWrites: true }
		: { backend: 'memory', ...(HDR_CACHE_DIRECTORY ? { directory: HDR_CACHE_DIRECTORY } : {}), diskWrites: false };
}

export const memoryHdrCacheBackend: HdrCacheBackend = {
	get: getCachedHdr,
	// cacheSuccessful's 3rd parameter is an optional assetId (for logging), not the backend
	// interface's own optional `now` -- adapt rather than widen the public interface's shape.
	put: (key, value) => cacheSuccessful(key, value, undefined, false),
	delete: (key) => { const entry = entries.get(key); entries.delete(key); totalBytes -= entry?.bytes ?? 0; },
	clear: clearHdrCache,
	stats: () => ({ entries: entries.size, bytes: totalBytes, inFlight: inFlight.size })
};
