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
	/** Informational only (debug relay); the prewarm's own counts decide the visible state. */
	activeAssetState?: HdrActiveAssetState;
};

/**
 * Resolve a browser-visible state without ever inventing work for an unsupported client.
 *
 * The indicator reports the PREWARM as a whole: it is only visible on the share page itself,
 * never over the lightbox, so there is no single photo for it to describe. 'ready' means every
 * conversion the prewarm targeted (the configured lookahead, or the whole album for 'all') has
 * finished and nothing is queued or running for it; 'partial' means it finished with failures.
 *
 * This supersedes hdr-caching-uat-20261010 root_cause (3), which made the server's per-photo
 * activeAssetState the primary signal. That turned the dot green as soon as one photo was done
 * -- at 4 of 10 conversions on a real phone -- while the server was visibly still working.
 * activeAssetState stays on the type because the server still sends it and the debug relay
 * still records it; it no longer decides anything here.
 */
export function resolveHdrReadiness(
	progress: HdrReadinessProgress,
	options: { supported: boolean; controlFailed?: boolean }
): HdrReadinessProgress {
	if (!options.supported) return { ...progress, state: 'ready', targeted: 0, queued: 0, running: 0 };
	if (options.controlFailed) return { ...progress, state: 'partial' };
	if (progress.targeted === 0) return { ...progress, state: 'ready' };
	// Counted here rather than taken from the server's own state label, so a response whose
	// label and counts disagree can only ever err towards "still working".
	const terminal = progress.completed + progress.failed + progress.skipped;
	if (terminal < progress.targeted || progress.queued > 0 || progress.running > 0) return { ...progress, state: 'preparing' };
	return { ...progress, state: progress.failed + progress.skipped > 0 ? 'partial' : 'ready' };
}

export function resolveHdrReadinessState(progress: Pick<HdrReadinessProgress, 'targeted' | 'completed' | 'failed' | 'skipped'> | undefined, options: { supported: boolean }): HdrReadinessState {
	if (!options.supported) return 'unsupported';
	if (!progress || progress.targeted === 0) return 'empty';
	return progress.completed + progress.failed + progress.skipped >= progress.targeted
		? progress.failed + progress.skipped > 0 ? 'partial' : 'ready'
		: 'preparing';
}
