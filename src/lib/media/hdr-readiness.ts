export type HdrReadinessState = 'idle' | 'unsupported' | 'empty' | 'preparing' | 'ready' | 'partial';

export type HdrReadinessProgress = {
	state: HdrReadinessState;
	targeted: number;
	queued: number;
	running: number;
	completed: number;
	failed: number;
	skipped: number;
};

/** Resolve a browser-visible state without ever inventing work for an unsupported client. */
export function resolveHdrReadiness(
	progress: HdrReadinessProgress,
	options: { supported: boolean; controlFailed?: boolean }
): HdrReadinessProgress {
	if (!options.supported) return { ...progress, state: 'ready', targeted: 0, queued: 0, running: 0 };
	if (options.controlFailed) return { ...progress, state: 'partial' };
	if (progress.targeted === 0) return { ...progress, state: 'ready' };
	if (progress.state === 'partial') return { ...progress, state: 'partial' };
	if (progress.state === 'ready') return { ...progress, state: 'ready' };
	const terminal = progress.completed + progress.failed + progress.skipped;
	if (terminal >= progress.targeted) return { ...progress, state: progress.failed + progress.skipped > 0 ? 'partial' : 'ready' };
	return { ...progress, state: 'preparing' };
}

export function resolveHdrReadinessState(progress: Pick<HdrReadinessProgress, 'targeted' | 'completed' | 'failed' | 'skipped'> | undefined, options: { supported: boolean }): HdrReadinessState {
	if (!options.supported) return 'unsupported';
	if (!progress || progress.targeted === 0) return 'empty';
	return progress.completed + progress.failed + progress.skipped >= progress.targeted
		? progress.failed + progress.skipped > 0 ? 'partial' : 'ready'
		: 'preparing';
}
