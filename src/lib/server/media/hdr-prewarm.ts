import {
	buildHdrCacheKey,
	getCachedHdr,
	hasCachedHdr,
	hdrQueueHasRoom,
	HDR_MAX_CONCURRENT,
	getOrCreateHdr,
	withHdrConcurrency,
	type CachedMedia,
	type HdrConversionPriority
} from './hdr-cache';
import { targetLookahead, targetAllEligible, type HdrLookahead, type HdrProjectionAsset } from './hdr-prewarm-policy';
import type { AppleHdrMetadata } from './hdr-metadata';
import { composeHdr, decodeHdrAvifStream, encodeHdrAvif, encodeHdrMp4 } from './hdr-compositor';
import { createHdrAssetRegistry, type HdrRegistryEntry } from './hdr-registry';

export type HdrRepresentation = 'video' | 'avif';
export const HDR_OUTPUT_CONTRACT: Record<HdrRepresentation, string> = { video: 'mp4-hevc-main10-pq-bt2020', avif: 'avif-gainmap-p3' };
export type HdrJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AuthorizedHdrAsset = HdrProjectionAsset & {
	sourceBytes: Uint8Array;
	metadata?: AppleHdrMetadata;
};

// `scope` is required, not `scope?: string` defaulting to 'default' -- Specialist Review
// finding 1 (.planning/debug/hdr-caching-uat-20261010.md) was exactly a call site that forgot
// to pass its real share scope, filing interactive work into an internal bucket invisible to
// that share's own readiness snapshot. A projection built without scope now fails to compile.
export type AuthorizedHdrProjection = {
	assets: readonly AuthorizedHdrAsset[];
	activePosition: number;
	lookahead: HdrLookahead;
	generation: number;
	scope: string;
};

export type HdrConversionInput = {
	assetId: string;
	representation: HdrRepresentation;
	sourceBytes: Uint8Array;
	metadata?: AppleHdrMetadata;
	width?: number;
	height?: number;
	cacheKey: string;
	 signal: AbortSignal;
};

export type HdrPrewarmOptions = {
	convert: (input: HdrConversionInput) => Promise<CachedMedia>;
	maxAttempts?: number;
	timeoutMs?: number;
	onComplete?: (snapshot: HdrProgressSnapshot) => void;
};

type SourceBuffer = { bytes: Uint8Array; released: boolean };

// Both representations' job bookkeeping lives on the HdrAssetRegistry entry itself, decorated
// with these runtime-only fields, rather than a second parallel map (the now-removed private
// `jobs` Map this type replaces). `result`/`resolveResult`/`rejectResult` are absent exactly
// when no attempt has ever started for that entry (a brand-new 'pending' entry resolve() just
// created); present for every entry that has.
type DecoratedEntry = HdrRegistryEntry & {
	result?: Promise<CachedMedia>;
	resolveResult?: (value: CachedMedia) => void;
	rejectResult?: (error: unknown) => void;
	source?: SourceBuffer;
	asset?: AuthorizedHdrAsset;
	representation?: HdrRepresentation;
	priority?: HdrConversionPriority;
	scope?: string;
};

/** Status of the ONE asset the viewer currently has open -- see per-asset readiness, hdr-caching-uat-20261010 root_cause (3). */
export type HdrActiveAssetState = 'ineligible' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unavailable';

export type HdrProgressSnapshot = {
	generation: number;
	representation: HdrRepresentation;
	state: 'preparing' | 'ready' | 'partial';
	targeted: number;
	queued: number;
	running: number;
	completed: number;
	failed: number;
	skipped: number;
	/** Computed by the prewarm route for command.activeAssetId, not by the coordinator itself. Absent when not yet known. */
	activeAssetState?: HdrActiveAssetState;
};

const DEFAULT_ATTEMPTS = 2;

function safeReason(error: unknown): string {
	return error instanceof Error ? error.message.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80) || 'conversion-failed' : 'conversion-failed';
}

// How often an entry waiting for queue room checks again. Conversions take seconds, so this is
// frequent enough not to leave a slot idle and rare enough to cost nothing.
const QUEUE_ROOM_POLL_MS = 250;

/**
 * Fetches one photo's original (re-authorized against Immich at that moment) and prepares it for
 * conversion. 'ineligible': the photo has no HDR version to make (no HDR data, not HEIC, or the
 * share does not allow the original). 'revoked': Immich no longer authorizes the share.
 */
export type HdrSourceFetcher = (assetId: string) => Promise<AuthorizedHdrAsset | 'ineligible' | 'unavailable' | 'revoked'>;

type PendingShare = { representation: HdrRepresentation; order: string[]; fetch: HdrSourceFetcher };

export class HdrPrewarmCoordinator {
	private readonly registry = createHdrAssetRegistry();
	// inspectSourceBytes() needs to sum retained source bytes across both representations; the
	// registry's own public entry type deliberately carries no `source` field (hdr-registry.ts
	// keeps that decoration private to this module), so the decorated entries that exist are
	// tracked here instead of walking private registry internals. Released buffers contribute 0
	// and are left in place rather than removed -- a list of already-emptied Uint8Array(0)
	// references is a negligible, bounded cost for this coordinator's lifetime.
	private readonly trackedEntries = new Set<DecoratedEntry>();
	private generation = 0;
	private readonly scopedGenerations = new Map<string, number>();
	private readonly ineligible = new Map<string, Set<string>>();
	// Photos waiting for their original to be fetched, per share and representation, in the order
	// they should be converted. Shares take turns (round robin), so a large album opened first
	// does not hold back one opened later.
	private readonly pending = new Map<string, PendingShare>();
	private rotation: string[] = [];
	private sourcesInFlight = 0;
	private readonly fetching = new Map<string, number>();
	private pumpTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly maxAttempts: number;

	constructor(private readonly options: HdrPrewarmOptions) {
		this.maxAttempts = Math.max(1, Math.min(Math.trunc(options.maxAttempts ?? DEFAULT_ATTEMPTS), DEFAULT_ATTEMPTS));
	}

	/** Global, unscoped revoke -- only has production meaning for the 'default' scope (every scoped call is revoked via newScopedGeneration instead). */
	newGeneration(): number {
		this.generation += 1;
		this.registry.revokeScope('default');
		return this.generation;
	}

	revoke(): number {
		return this.newGeneration();
	}

	getGeneration(): number {
		return this.generation;
	}

	getScopedGeneration(scope: string): number {
		return this.scopedGenerations.get(scope) ?? 0;
	}

	/** Accepts only the server-produced normalized projection; callers never provide asset IDs separately. */
	schedule(projection: AuthorizedHdrProjection, representation: HdrRepresentation, priority: HdrConversionPriority = 'background'): HdrProgressSnapshot {
		const scope = projection.scope;
		const generation = projection.generation === this.getScopedGeneration(scope) ? projection.generation : this.newScopedGeneration(scope);
		const targets = projection.lookahead !== 0 && projection.lookahead.kind === 'all'
			? targetAllEligible(projection.assets)
			: targetLookahead(projection.assets, projection.activePosition, projection.lookahead);
		for (const asset of targets) this.enqueue(asset, representation, priority, scope);
		return this.snapshot(generation, representation, scope);
	}

	newScopedGeneration(scope: string): number {
		const next = this.getScopedGeneration(scope) + 1;
		this.scopedGenerations.set(scope, next);
		// Keeps the registry's own per-scope generation counter (hdr-registry.ts's
		// generationFor/revokeScope) in lockstep with this one -- both are bumped by exactly 1
		// here and nowhere else for a scoped bump, so entry.generation (stamped from the
		// registry's counter) and this coordinator's own scopedGenerations value stay
		// numerically interchangeable for any given scope. revokeScope() itself aborts every
		// in-flight entry's AbortController and marks it 'skipped'.
		this.registry.revokeScope(scope);
		return next;
	}

	/**
	 * Interactive media routes can promote existing work without creating a second conversion.
	 * `scope` and `generation` are required, not defaulted -- Specialist Review finding 1
	 * (.planning/debug/hdr-caching-uat-20261010.md) was exactly a call site that forgot to pass
	 * its real share scope, filing interactive work into an internal bucket invisible to that
	 * share's own readiness snapshot. Every production call site already supplies real values.
	 */
	ensureInteractive(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation: number, scope: string): HdrProgressSnapshot {
		this.enqueue(asset, representation, 'interactive', scope);
		return this.snapshot(generation, representation, scope);
	}

	/** Submit one freshly-authorized representation and await the shared result. Same scope/generation contract as ensureInteractive(). */
	submitInteractive(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation: number, scope: string): Promise<CachedMedia> {
		return this.enqueue(asset, representation, 'interactive', scope);
	}

	/**
	 * Direct O(1) per-asset status lookup through the registry -- the replacement for the old
	 * buildHdrCacheKey(...)-plus-lookup-by-key reconstruction this coordinator used before (now
	 * fully removed; see hdr-caching-uat-20261010 root_cause (1)/CR-01). Covers both
	 * representations.
	 */
	activeState(scope: string, assetId: string, representation: HdrRepresentation): HdrActiveAssetState | 'none' {
		const entry = this.registry.read(scope, assetId, representation);
		if (!entry) return 'none';
		switch (entry.status) {
			case 'pending': return 'queued';
			case 'converting': return 'running';
			case 'ready': return 'succeeded';
			case 'failed': return 'failed';
			case 'skipped': return 'skipped';
		}
	}

	/**
	 * Whether the control route still needs to fetch this photo's original to schedule it. False
	 * for anything already queued, converting, converted (and still cached in either tier),
	 * finally failed, or known to have no HDR data -- so a poll, or a revisit of a fully converted
	 * album, never downloads those originals again.
	 */
	needsSource(scope: string, assetId: string, representation: HdrRepresentation): boolean {
		if (this.ineligible.get(scope)?.has(assetId)) return false;
		const entry = this.registry.read(scope, assetId, representation) as DecoratedEntry | undefined;
		if (!entry || entry.generation !== this.registry.generationFor(scope)) return true;
		switch (entry.status) {
			case 'pending':
			case 'converting':
			case 'failed':
				return false;
			case 'ready':
				return !(entry.cacheKey && hasCachedHdr(entry.cacheKey));
			default:
				return true;
		}
	}

	/**
	 * Queue every photo of a share that still needs converting, on the server, independent of the
	 * page that asked: work continues after the visitor leaves, and another share's photos are
	 * added alongside rather than replacing them. A later call (the page polling, or the visitor
	 * moving to another photo) re-orders the share's queue from its new position and refreshes the
	 * fetcher, so originals are always fetched with the most recent visitor's authorization.
	 *
	 * The fetcher holds that share's link (and session token, if any) in memory until its queued
	 * photos have been fetched; nothing is written to disk, and Immich re-checks authorization on
	 * every fetch, so a revoked share empties its own queue.
	 */
	queueSources(scope: string, representation: HdrRepresentation, assetIds: string[], fetch: HdrSourceFetcher): void {
		const key = `${scope}|${representation}`;
		const order = assetIds.filter((id) => this.needsSource(scope, id, representation));
		if (!order.length) { this.pending.delete(key); this.rotation = this.rotation.filter((entry) => entry !== key); return; }
		this.pending.set(key, { representation, order, fetch });
		if (!this.rotation.includes(key)) this.rotation.push(key);
		this.pumpSources();
	}

	/** Stop fetching queued photos (tests, shutdown); work already holding an original finishes. */
	dispose(): void {
		this.pending.clear();
		this.rotation = [];
		if (this.pumpTimer) clearTimeout(this.pumpTimer);
		this.pumpTimer = undefined;
	}

	/** True once nothing is queued, being fetched, or holding an original. */
	idle(): boolean {
		return !this.rotation.length && this.sourcesInFlight === 0 && this.heldSources() === 0;
	}

	/** Forget a share's queued photos (Immich no longer authorizes it). */
	dropSources(scope: string): void {
		for (const key of [...this.pending.keys()]) if (key.slice(0, key.lastIndexOf('|')) === scope) this.pending.delete(key);
		this.rotation = this.rotation.filter((key) => this.pending.has(key));
	}

	private heldSources(): number {
		let held = 0;
		for (const entry of this.trackedEntries) if (entry.source && !entry.source.released && entry.source.bytes.byteLength > 0) held += 1;
		return held;
	}

	/** Photos of this share still waiting for their original to be fetched. */
	pendingSources(scope: string, representation: HdrRepresentation): number {
		const key = `${scope}|${representation}`;
		return (this.pending.get(key)?.order.length ?? 0) + (this.fetching.get(key) ?? 0);
	}

	private pumpSources(): void {
		// Originals held in memory (being fetched, waiting for a slot, or converting) stay at about
		// twice the conversion concurrency however many photos are queued: enough that a slot never
		// sits idle waiting for a download, no more.
		while (this.rotation.length && this.sourcesInFlight < HDR_MAX_CONCURRENT && this.heldSources() + this.sourcesInFlight < HDR_MAX_CONCURRENT * 2) {
			const key = this.rotation.shift()!;
			const share = this.pending.get(key);
			if (!share || !share.order.length) { this.pending.delete(key); continue; }
			const assetId = share.order.shift()!;
			const scope = key.slice(0, key.lastIndexOf('|'));
			if (share.order.length) this.rotation.push(key); else this.pending.delete(key);
			if (!this.needsSource(scope, assetId, share.representation)) continue;
			this.sourcesInFlight += 1;
			this.fetching.set(key, (this.fetching.get(key) ?? 0) + 1);
			void share.fetch(assetId).then((result) => {
				if (result === 'revoked') this.dropSources(scope); else if (result === 'ineligible') {
					this.markIneligible(scope, assetId);
				} else if (result !== 'unavailable') {
					this.enqueue(result, share.representation, 'background', scope);
				}
			}).catch(() => {}).finally(() => {
				this.sourcesInFlight -= 1;
				const left = (this.fetching.get(key) ?? 1) - 1;
				if (left > 0) this.fetching.set(key, left); else this.fetching.delete(key);
				this.pumpSources();
			});
		}
		// Blocked only by conversions still waiting: look again shortly.
		if (this.rotation.length && !this.pumpTimer) this.pumpTimer = setTimeout(() => { this.pumpTimer = undefined; this.pumpSources(); }, QUEUE_ROOM_POLL_MS);
	}

	/** Remember, per share, a photo found to have no HDR data, so it is not fetched again. */
	markIneligible(scope: string, assetId: string): void {
		let set = this.ineligible.get(scope);
		if (!set) { set = new Set(); this.ineligible.set(scope, set); }
		set.add(assetId);
	}

	isIneligible(scope: string, assetId: string): boolean {
		return Boolean(this.ineligible.get(scope)?.has(assetId));
	}

	snapshot(generation = this.generation, representation: HdrRepresentation = 'video', scope = 'default'): HdrProgressSnapshot {
		const entries = this.registry.entriesFor(scope, representation).filter((entry) => entry.generation === generation);
		const completed = entries.filter((entry) => entry.status === 'ready').length;
		const failed = entries.filter((entry) => entry.status === 'failed').length;
		const skipped = entries.filter((entry) => entry.status === 'skipped').length;
		const queued = entries.filter((entry) => entry.status === 'pending').length;
		const running = entries.filter((entry) => entry.status === 'converting').length;
		const terminal = completed + failed + skipped;
		// Photos queued on the server but not yet fetched count as queued work.
		const waiting = this.pendingSources(scope, representation);
		return {
			generation,
			representation,
			// 'skipped' is superseded work (a newer generation took over), not a failure: only real
			// failures make a finished prewarm 'partial'.
			state: terminal < entries.length || waiting > 0 ? 'preparing' : failed > 0 ? 'partial' : 'ready',
			targeted: entries.length + waiting,
			queued: queued + waiting,
			running,
			completed,
			failed,
			skipped
		};
	}

	inspectSourceBytes(): number {
		let bytes = 0;
		for (const entry of this.trackedEntries) if (entry.source && !entry.source.released) bytes += entry.source.bytes.byteLength;
		return bytes;
	}

	private enqueue(asset: AuthorizedHdrAsset, representation: HdrRepresentation, priority: HdrConversionPriority, scope: string): Promise<CachedMedia> {
		const entry = this.registry.resolve(scope, asset.id, representation, { sourceIdentity: asset.sourceIdentity, width: asset.width, height: asset.height }) as DecoratedEntry;
		entry.scope = scope;
		entry.representation = representation;
		this.trackedEntries.add(entry);
		if (entry.status === 'converting' && entry.result) {
			// Already in flight for this exact (scope, assetId, representation, identity) --
			// join it, the CR-01 structural proof: a background schedule() call and a later
			// interactive call for the same asset resolve through this identical entry, not a
			// second conversion. Video and AVIF occupy independent slots under the same
			// (scope, assetId) bucket (D-19), so this never conflates the two representations.
			if (priority === 'interactive') entry.priority = priority;
			return entry.result;
		}
		if (entry.status === 'ready' && entry.cacheKey) {
			const cached = getCachedHdr(entry.cacheKey);
			if (cached) return entry.result ?? Promise.resolve(cached);
			// Cached bytes were evicted since this entry was marked ready (TTL/capacity) --
			// fall through and start a fresh attempt rather than returning a stale promise.
		}
		// Fresh attempt: a brand-new 'pending' entry, a retry of a 'failed' one, or redoing a
		// 'ready' one whose cache entry no longer exists. A prior attempt's AbortController
		// cannot be un-aborted, so this attempt gets its own.
		entry.abortController = new AbortController();
		entry.asset = asset;
		entry.priority = priority;
		entry.source = { bytes: asset.sourceBytes, released: false };
		let resolveResult!: (value: CachedMedia) => void;
		let rejectResult!: (error: unknown) => void;
		const result = new Promise<CachedMedia>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
		// Background schedule() calls intentionally do not await individual entries.
		result.catch(() => {});
		entry.result = result;
		entry.resolveResult = resolveResult;
		entry.rejectResult = rejectResult;
		this.registry.transition(entry, { status: 'converting', error: undefined });
		void this.runRegistryEntry(entry);
		return result;
	}

	private async runRegistryEntry(entry: DecoratedEntry): Promise<void> {
		const scope = entry.scope!;
		const asset = entry.asset!;
		const representation = entry.representation!;
		if (entry.generation !== this.registry.generationFor(scope)) return this.finishRegistryEntry(entry, 'skipped');
		const key = buildHdrCacheKey({ assetId: asset.id, sourceIdentity: entry.sourceIdentity, width: entry.width, height: entry.height, outputContract: HDR_OUTPUT_CONTRACT[representation] });
		// No room in the queue for this priority: wait for some, without touching the cache or the
		// queue in between. Retrying every 25 ms through the cache produced hundreds of thousands
		// of cache-miss events in one session and handed free slots to whichever retry won.
		if (!hasCachedHdr(key) && !hdrQueueHasRoom(entry.priority)) {
			this.waitForQueueRoom(entry);
			return;
		}
		try {
			await getOrCreateHdr(key, () => withHdrConcurrency(
				(signal) => this.convertRegistryEntry(entry, key, signal),
				{ signal: entry.abortController.signal, priority: entry.priority, timeoutMs: this.options.timeoutMs, queueKey: key }
			), Date.now(), entry.priority, asset.id);
			if (entry.generation !== this.registry.generationFor(scope)) return this.finishRegistryEntry(entry, 'skipped');
			this.registry.transition(entry, { status: 'ready', cacheKey: key });
			this.finishRegistryEntry(entry, 'ready');
		} catch (error) {
			if (error instanceof Error && error.message === 'hdr-queue-full') {
				// `all` is an admission request, not a best-effort batch. Keep the authorized
				// source owned by this entry until queue capacity is available; the bounded
				// scheduler still limits memory and active work.
				this.waitForQueueRoom(entry);
				return;
			}
			this.registry.transition(entry, { attempts: entry.attempts + 1 });
			if (entry.generation !== this.registry.generationFor(scope)) return this.finishRegistryEntry(entry, 'skipped');
			if (entry.attempts < this.maxAttempts) {
				queueMicrotask(() => void this.runRegistryEntry(entry));
				return;
			}
			this.registry.transition(entry, { status: 'failed', error: safeReason(error) });
			this.finishRegistryEntry(entry, 'failed');
		}
	}

	private waitForQueueRoom(entry: DecoratedEntry): void {
		setTimeout(() => { if (entry.generation === this.registry.generationFor(entry.scope!) && entry.status === 'converting') void this.runRegistryEntry(entry); }, QUEUE_ROOM_POLL_MS);
	}

	private async convertRegistryEntry(entry: DecoratedEntry, key: string, signal?: AbortSignal): Promise<CachedMedia> {
		if (entry.generation !== this.registry.generationFor(entry.scope!)) throw new Error('stale-generation');
		// Native adapters receive a short-lived view, while the entry-owned source buffer is
		// cleared independently on every terminal path. This also prevents a native adapter or
		// test diagnostic from retaining the queue's authoritative buffer after disposal.
		return this.options.convert({ assetId: entry.asset!.id, representation: entry.representation!, sourceBytes: entry.source!.bytes.slice(), metadata: entry.asset!.metadata, width: entry.width, height: entry.height, cacheKey: key, signal: signal ?? entry.abortController.signal });
	}

	private finishRegistryEntry(entry: DecoratedEntry, outcome: 'ready' | 'failed' | 'skipped'): void {
		if (!entry.resolveResult || !entry.rejectResult) return;
		this.releaseRegistryEntry(entry);
		const resolveResult = entry.resolveResult;
		const rejectResult = entry.rejectResult;
		entry.resolveResult = undefined;
		entry.rejectResult = undefined;
		if (outcome === 'ready') {
			// The cache is the canonical result store; the conversion promise is only request-scoped.
			const cached = entry.cacheKey ? getCachedHdr(entry.cacheKey) : undefined;
			if (cached) resolveResult(cached);
			else rejectResult(new Error('hdr-result-missing'));
		} else {
			if (outcome === 'skipped' && entry.status !== 'skipped') this.registry.transition(entry, { status: 'skipped' });
			rejectResult(new Error(`hdr-${outcome}`));
		}
		this.options.onComplete?.(this.snapshot(entry.generation, entry.representation, entry.scope));
		this.pumpSources();
	}

	private releaseRegistryEntry(entry: DecoratedEntry): void {
		if (!entry.source || entry.source.released) return;
		entry.source.bytes.fill(0);
		entry.source.bytes = new Uint8Array(0);
		entry.source.released = true;
	}
}

export function createHdrPrewarmCoordinator(options: HdrPrewarmOptions): HdrPrewarmCoordinator {
	return new HdrPrewarmCoordinator(options);
}

let interactiveCoordinator = createHdrPrewarmCoordinator({
	convert: async ({ assetId, representation, sourceBytes, metadata, signal }) => {
		if (!metadata) throw new Error('hdr-metadata-invalid');
		if (representation === 'video') {
			const bridge = Boolean(process.env.HDR_COMPOSITOR_PATH || process.env.HDR_FFMPEG_PATH);
			const ppm = await composeHdr(sourceBytes, metadata, { executable: bridge ? process.env.HDR_COMPOSITOR_PATH : undefined, invocationId: bridge ? assetId : undefined, signal });
			const body = await encodeHdrMp4(ppm, { executable: bridge ? process.env.HDR_FFMPEG_PATH : undefined, invocationId: bridge ? assetId : undefined, signal });
			return { body, contentType: 'video/mp4' };
		}
		const bridge = Boolean(process.env.HDR_AVIF_DECODE_PATH || process.env.HDR_AVIF_ENCODE_PATH);
		const stream = await decodeHdrAvifStream(sourceBytes, metadata, { executable: bridge ? process.env.HDR_AVIF_DECODE_PATH : undefined, invocationId: bridge ? assetId : undefined, signal });
		const body = await encodeHdrAvif(stream, metadata, { executable: bridge ? process.env.HDR_AVIF_ENCODE_PATH : undefined, invocationId: bridge ? assetId : undefined, signal });
		return { body, contentType: 'image/avif' };
	}
});

export function getHdrInteractiveCoordinator(): HdrPrewarmCoordinator {
	return interactiveCoordinator;
}

/** Test-only server seam: the route remains real while conversion work is deterministic. */
export function setHdrInteractiveCoordinatorForTests(coordinator: HdrPrewarmCoordinator): () => void {
	const previous = interactiveCoordinator;
	interactiveCoordinator = coordinator;
	return () => { interactiveCoordinator = previous; };
}
