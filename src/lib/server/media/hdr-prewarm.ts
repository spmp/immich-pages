import {
	buildHdrCacheKey,
	getCachedHdr,
	getOrCreateHdr,
	withHdrConcurrency,
	type CachedMedia,
	type HdrConversionPriority
} from './hdr-cache';
import { targetLookahead, targetAllEligible, type HdrLookahead, type HdrProjectionAsset } from './hdr-prewarm-policy';

export type HdrRepresentation = 'video' | 'avif';
export type HdrJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AuthorizedHdrAsset = HdrProjectionAsset & {
	sourceBytes: Uint8Array;
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
				job.state = 'skipped';
				this.release(job);
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

	private enqueue(asset: AuthorizedHdrAsset, representation: HdrRepresentation, generation: number, priority: HdrConversionPriority): void {
		const key = buildHdrCacheKey({ assetId: asset.id, sourceIdentity: asset.sourceIdentity, width: asset.width, height: asset.height, outputContract: representation });
		const existing = this.jobs.get(key);
		if (existing && existing.generation === generation && existing.state !== 'failed' && existing.state !== 'skipped') {
			if (priority === 'interactive') existing.priority = priority;
			return;
		}
		const job: Job = { key, asset, representation, generation, priority, attempts: 0, state: 'queued', source: { bytes: asset.sourceBytes, released: false }, abortController: new AbortController() };
		this.jobs.set(key, job);
		void this.run(job);
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
		return this.options.convert({ assetId: job.asset.id, representation: job.representation, sourceBytes: job.source.bytes, width: job.asset.width, height: job.asset.height, cacheKey: job.key, signal: signal ?? job.abortController.signal });
	}

	private finish(job: Job, state: Extract<HdrJobState, 'succeeded' | 'failed' | 'skipped'>): void {
		job.state = state;
		this.release(job);
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
