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

export type HdrRepresentation = 'video' | 'avif';
export const HDR_OUTPUT_CONTRACT: Record<HdrRepresentation, string> = { video: 'mp4-hevc-main10-pq-bt2020', avif: 'avif-gainmap-p3' };
export type HdrJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AuthorizedHdrAsset = HdrProjectionAsset & {
	sourceBytes: Uint8Array;
	metadata?: AppleHdrMetadata;
};

export type AuthorizedHdrProjection = {
	assets: readonly AuthorizedHdrAsset[];
	activePosition: number;
	lookahead: HdrLookahead;
	generation: number;
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
type Job = {
	key: string;
	asset: AuthorizedHdrAsset;
	representation: HdrRepresentation;
	generation: number;
	priority: HdrConversionPriority;
	attempts: number;
	state: HdrJobState;
	source: SourceBuffer;
	error?: string;
	abortController: AbortController;
	result: Promise<CachedMedia>;
};

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
};

const DEFAULT_ATTEMPTS = 2;

function safeReason(error: unknown): string {
	return error instanceof Error ? error.message.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80) || 'conversion-failed' : 'conversion-failed';
}

export class HdrPrewarmCoordinator {
	private readonly jobs = new Map<string, Job>();
	private generation = 0;
	private readonly maxAttempts: number;

	constructor(private readonly options: HdrPrewarmOptions) {
		this.maxAttempts = Math.max(1, Math.min(Math.trunc(options.maxAttempts ?? DEFAULT_ATTEMPTS), DEFAULT_ATTEMPTS));
	}

	newGeneration(): number {
		this.generation += 1;
		for (const job of this.jobs.values()) {
			if (job.state === 'queued' || job.state === 'running') {
				job.abortController.abort();
				this.finish(job, 'skipped');
			}
		}
		return this.generation;
	}

	revoke(): number {
		return this.newGeneration();
	}

	getGeneration(): number {
		return this.generation;
	}

	/** Accepts only the server-produced normalized projection; callers never provide asset IDs separately. */
	schedule(projection: AuthorizedHdrProjection, representation: HdrRepresentation, priority: HdrConversionPriority = 'background'): HdrProgressSnapshot {
		const generation = projection.generation === this.generation ? projection.generation : this.newGeneration();
		const targets = projection.lookahead !== 0 && projection.lookahead.kind === 'all'
			? targetAllEligible(projection.assets)
			: targetLookahead(projection.assets, projection.activePosition, projection.lookahead);
		for (const asset of targets) this.enqueue(asset, representation, generation, priority);
		return this.snapshot(generation, representation);
	}

	/** Interactive media routes can promote existing work without creating a second conversion. */
	ensureInteractive(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation = this.generation): HdrProgressSnapshot {
		this.enqueue(asset, representation, generation, 'interactive');
		return this.snapshot(generation, representation);
	}

	/** Submit one freshly-authorized representation and await the shared result. */
	submitInteractive(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation = this.generation): Promise<CachedMedia> {
		return this.enqueue(asset, representation, generation, 'interactive');
	}

	snapshot(generation = this.generation, representation: HdrRepresentation = 'video'): HdrProgressSnapshot {
		const jobs = [...this.jobs.values()].filter((job) => job.generation === generation && job.representation === representation);
		const completed = jobs.filter((job) => job.state === 'succeeded').length;
		const failed = jobs.filter((job) => job.state === 'failed').length;
		const skipped = jobs.filter((job) => job.state === 'skipped').length;
		const queued = jobs.filter((job) => job.state === 'queued').length;
		const running = jobs.filter((job) => job.state === 'running').length;
		const terminal = completed + failed + skipped;
		return {
			generation,
			representation,
			state: terminal < jobs.length ? 'preparing' : failed + skipped > 0 ? 'partial' : 'ready',
			targeted: jobs.length,
			queued,
			running,
			completed,
			failed,
			skipped
		};
	}

	inspectSourceBytes(): number {
		let bytes = 0;
		for (const job of this.jobs.values()) if (!job.source.released) bytes += job.source.bytes.byteLength;
		return bytes;
	}

	private enqueue(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation: number, priority: HdrConversionPriority): Promise<CachedMedia> {
		const key = buildHdrCacheKey({ assetId: asset.id, sourceIdentity: asset.sourceIdentity, width: asset.width, height: asset.height, outputContract: HDR_OUTPUT_CONTRACT[representation] });
		const existing = this.jobs.get(key);
		if (existing && existing.generation === generation && existing.state !== 'failed' && existing.state !== 'skipped' && (existing.state !== 'succeeded' || getCachedHdr(existing.key))) {
			if (priority === 'interactive') existing.priority = priority;
			return existing.result;
		}
		let resolveResult!: (value: CachedMedia) => void;
		let rejectResult!: (error: unknown) => void;
		const result = new Promise<CachedMedia>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
		// Background schedule() calls intentionally do not await individual jobs.
		result.catch(() => {});
		const job: Job = { key, asset, representation, generation, priority, attempts: 0, state: 'queued', source: { bytes: asset.sourceBytes, released: false }, abortController: new AbortController(), result };
		(job as Job & { resolveResult: typeof resolveResult; rejectResult: typeof rejectResult }).resolveResult = resolveResult;
		(job as Job & { resolveResult: typeof resolveResult; rejectResult: typeof rejectResult }).rejectResult = rejectResult;
		this.jobs.set(key, job);
		void this.run(job);
		return result;
	}

	private async run(job: Job): Promise<void> {
		if (job.generation !== this.generation) return this.finish(job, 'skipped');
		job.state = 'running';
		try {
			await getOrCreateHdr(job.key, () => withHdrConcurrency(
			(signal) => this.convert(job, signal),
				{ signal: job.abortController.signal, priority: job.priority, timeoutMs: this.options.timeoutMs, queueKey: job.key }
			), Date.now(), job.priority);
			if (job.generation !== this.generation) return this.finish(job, 'skipped');
			this.finish(job, 'succeeded');
		} catch (error) {
			if (error instanceof Error && error.message === 'hdr-queue-full') {
				// `all` is an admission request, not a best-effort batch. Keep the
				// authorized source owned by this job until queue capacity is available;
				// the bounded scheduler still limits memory and active work.
				job.state = 'queued';
				setTimeout(() => { if (job.generation === this.generation && job.state === 'queued') void this.run(job); }, 25);
				return;
			}
			job.attempts += 1;
			if (job.generation !== this.generation) return this.finish(job, 'skipped');
			if (job.attempts < this.maxAttempts) {
				job.state = 'queued';
				queueMicrotask(() => void this.run(job));
				return;
			}
			job.error = safeReason(error);
			this.finish(job, 'failed');
		}
	}

	private async convert(job: Job, signal?: AbortSignal): Promise<CachedMedia> {
		if (job.generation !== this.generation) throw new Error('stale-generation');
		// Native adapters receive a short-lived view, while the coordinator-owned source buffer is
		// cleared independently on every terminal path. This also prevents a native adapter or test
		// diagnostic from retaining the queue's authoritative buffer after disposal.
		return this.options.convert({ assetId: job.asset.id, representation: job.representation, sourceBytes: job.source.bytes.slice(), metadata: job.asset.metadata, width: job.asset.width, height: job.asset.height, cacheKey: job.key, signal: signal ?? job.abortController.signal });
	}

	private finish(job: Job, state: Extract<HdrJobState, 'succeeded' | 'failed' | 'skipped'>): void {
		if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'skipped') return;
		job.state = state;
		this.release(job);
		const deferred = job as Job & { resolveResult: (value: CachedMedia) => void; rejectResult: (error: unknown) => void };
		if (state === 'succeeded') {
			// The cache is the canonical result store; the conversion promise is only request-scoped.
			const cached = getCachedHdr(job.key);
			if (cached) deferred.resolveResult(cached);
			else deferred.rejectResult(new Error('hdr-result-missing'));
		} else deferred.rejectResult(new Error(`hdr-${state}`));
		this.options.onComplete?.(this.snapshot(job.generation, job.representation));
	}

	private release(job: Job): void {
		if (job.source.released) return;
		job.source.bytes.fill(0);
		job.source.bytes = new Uint8Array(0);
		job.source.released = true;
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
