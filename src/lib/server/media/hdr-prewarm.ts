import {
	buildHdrCacheKey,
	getCachedHdr,
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

	snapshot(generation = this.generation, representation: HdrRepresentation = 'video', scope = 'default'): HdrProgressSnapshot {
		const entries = this.registry.entriesFor(scope, representation).filter((entry) => entry.generation === generation);
		const completed = entries.filter((entry) => entry.status === 'ready').length;
		const failed = entries.filter((entry) => entry.status === 'failed').length;
		const skipped = entries.filter((entry) => entry.status === 'skipped').length;
		const queued = entries.filter((entry) => entry.status === 'pending').length;
		const running = entries.filter((entry) => entry.status === 'converting').length;
		const terminal = completed + failed + skipped;
		return {
			generation,
			representation,
			state: terminal < entries.length ? 'preparing' : failed + skipped > 0 ? 'partial' : 'ready',
			targeted: entries.length,
			queued,
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
				setTimeout(() => { if (entry.generation === this.registry.generationFor(scope) && entry.status === 'converting') void this.runRegistryEntry(entry); }, 25);
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
