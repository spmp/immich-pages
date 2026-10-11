export type HdrReadinessState = 'idle' | 'unsupported' | 'empty' | 'preparing' | 'ready' | 'partial';

/** Status of the ONE asset the viewer currently has open, computed server-side (prewarm/+server.ts). */
export type HdrActiveAssetState = 'ineligible' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unavailable';

export type HdrReadinessProgress = {
	state: HdrReadinessState;
	targeted: number;
	queued: number;
	running: number;
	completed: number;
	failed: number;
	skipped: number;
	/** Absent on older/degraded responses -- falls back to the aggregate window math below. */
	activeAssetState?: HdrActiveAssetState;
};

/**
 * Resolve a browser-visible state without ever inventing work for an unsupported client.
 *
 * root_cause (3), hdr-caching-uat-20261010: an aggregate-window-only readiness check means "ready"
 * only ever meant "the current lookahead window finished", not "the photo the viewer has open is
 * ready" -- a window could finish and turn green while the open photo (outside that window, or
 * simply still converting) was not actually cached yet. Once the server tells us the status of
 * the SPECIFIC active asset, that status must dominate: it is checked before, and independently
 * of, the aggregate window's own terminal/partial/preparing math.
 */
export function resolveHdrReadiness(
	progress: HdrReadinessProgress,
	options: { supported: boolean; controlFailed?: boolean }
): HdrReadinessProgress {
	if (!options.supported) return { ...progress, state: 'ready', targeted: 0, queued: 0, running: 0 };
	if (options.controlFailed) return { ...progress, state: 'partial' };
	switch (progress.activeAssetState) {
		case 'ineligible':
		case 'succeeded':
			return { ...progress, state: 'ready' };
		case 'queued':
		case 'running':
			return { ...progress, state: 'preparing' };
		case 'failed':
		case 'skipped':
		case 'unavailable':
			return { ...progress, state: 'partial' };
		default:
			break;
	}
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
