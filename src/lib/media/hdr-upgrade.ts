// The "show the SDR photo now, swap in the HDR media only once it has proven it can actually
// decode" state machine, shared by BOTH HDR delivery paths (HDR video, HDR AVIF).
//
// It is one shared module rather than two parallel copies for a specific reason: the copies
// drifted. The video path and the AVIF path each grew their own version of this logic, and a
// change made to one ("drive PhotoSwipe's spinner") was applied to the other only halfway --
// producing a spinner that could arm but never clear, over an HDR video that had in fact loaded
// correctly. The commit that introduced it claimed "both paths now manage content.state
// consistently"; they didn't, and nothing could catch that because there was no single place
// where the behavior lived. See .planning/debug/resolved/hdr-lightbox-state-regression.md.
//
// It is also expressed against PhotoSwipe's two *documented* extension points for content types
// that load outside its own image pipeline, rather than by reaching into its internals:
//
//   * the `isContentLoading` filter (slide/content.js:206-212) -- so the app reports its loading
//     state when asked, instead of writing PhotoSwipe's `content.state` field behind its back and
//     keeping a second copy that can desync from the spinner. This module never writes
//     content.state; `isHdrUpgradeLoading` is the single source of truth.
//
//   * `pswp.ui.updatePreloaderVisibility()` (ui/loading-indicator.js:63-66, which publishes it
//     with an explicit `// expose the method`) -- so the app can tell the preloader to re-read
//     that state. This is what `refreshSpinner` must call. The preloader otherwise re-reads it
//     only on 'change' and 'loadComplete', which is why a spinner armed by a custom content type
//     could previously never be switched off except by navigating to another slide.

export type HdrUpgradeOutcome = 'promoted' | 'gave-up';

/** Structural view of PhotoSwipe's Content -- only the fields this upgrade actually touches. */
export interface HdrUpgradeContent {
	/** True once PhotoSwipe's own Content.append() has inserted the element into the slide. */
	isAttached?: boolean;
	element?: unknown;
	slide?: { container?: { appendChild(node: never): void } };
	/** This module's own loading flag. Read it through `isHdrUpgradeLoading`, never directly. */
	__hdrLoading?: boolean;
	/** Diagnostic flag consumed by the lightbox's HDR state indicator. */
	__hdrPromoted?: boolean;
}

export interface HdrUpgradeOptions {
	content: HdrUpgradeContent;
	/** The SDR element already assigned to content.element; stays visible unless `real` wins. */
	placeholder: { remove(): void };
	/** The HDR element to swap in once it has proven it can decode/play. */
	real: unknown;
	/** Budget for the whole attempt, after which it settles for the SDR placeholder. */
	timeoutMs: number;
	/** Must call pswp.ui.updatePreloaderVisibility(). Called on both edges of the loading state. */
	refreshSpinner(): void;
	/** Runs just before the element handover, while content.element is still the placeholder. */
	beforeSwap?(): void;
	/** Called exactly once, whichever way the attempt ends. */
	onSettled?(outcome: HdrUpgradeOutcome, reason?: string): void;
	/** Release decoder/network resources held by `real`. Only called when the upgrade loses. */
	releaseReal?(): void;
}

export interface HdrUpgrade {
	/** `real` has proven itself -- hand it to PhotoSwipe. */
	promote(): void;
	/** Settle for the SDR placeholder. `reason` is forwarded to onSettled for diagnostics. */
	giveUp(reason?: string): void;
	readonly settled: boolean;
}

/**
 * Whether an HDR upgrade is still in flight for this content.
 *
 * Wire this into PhotoSwipe via `addFilter('isContentLoading', ...)`, OR-ed with the incoming
 * value so that content types this module knows nothing about keep PhotoSwipe's own answer.
 */
export function isHdrUpgradeLoading(content: HdrUpgradeContent): boolean {
	return content.__hdrLoading === true;
}

export function markHdrUpgradePromoted(content: HdrUpgradeContent): void {
	content.__hdrPromoted = true;
}

export function beginHdrUpgrade(options: HdrUpgradeOptions): HdrUpgrade {
	const { content, placeholder, real } = options;
	let settled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const stopLoading = () => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		content.__hdrLoading = false;
		// Both edges matter. Announcing only the start is what produced a spinner that ran
		// forever: PhotoSwipe does not poll this, it re-reads it when told to.
		options.refreshSpinner();
	};

	const promote = () => {
		if (settled) return;
		settled = true;
		options.beforeSwap?.();
		// Always safe, and deliberately unconditional: handing PhotoSwipe the real element is
		// just a reference assignment, and PhotoSwipe's own Content.append() reads
		// content.element at call time rather than capturing it earlier.
		content.element = real;
		if (content.isAttached) {
			// PhotoSwipe has already inserted the placeholder into this slide and will not call
			// append() a second time, so the DOM swap is ours to perform.
			placeholder.remove();
			content.slide?.container?.appendChild(real as never);
		}
		// Not attached yet: do nothing further. This is the normal state of a first slide that is
		// still inside the module-import + opening-animation window, where Slide.appendHeavy()
		// deliberately bails (slide/slide.js:150-155) -- so append() has not run yet and will
		// insert `real` itself when it does. It is ALSO the state of a slide that was recycled
		// out from under this attempt, where content.slide has been cleared and there is
		// correctly nothing to insert into.
		//
		// Those two cases needing no distinction is the entire point. The previous code tried to
		// tell them apart by treating !isAttached as "recycled, nobody is looking" and clearing
		// content.element, which blanked the first photo whenever a fast conversion landed inside
		// the opening animation. There is no case in which a not-yet-attached content should have
		// its element cleared, so there is nothing left to guess at.
		markHdrUpgradePromoted(content);
		// Spinner off only once the real media is actually in place, not before.
		stopLoading();
		options.onSettled?.('promoted', undefined);
	};

	const giveUp = (reason?: string) => {
		if (settled) return;
		settled = true;
		stopLoading();
		// Diagnostics before teardown, not after: the video path reports *why* it failed from
		// video.error?.code, and its own releaseReal() (removeAttribute('src') + load()) clears
		// MediaError -- so releasing first would make every failure read as a bare timeout.
		options.onSettled?.('gave-up', reason);
		options.releaseReal?.();
		// content.element is left pointing at the SDR placeholder, which is already the visible,
		// correct content. That also means a revisit of this same cached Content re-appends the
		// working SDR photo (Content.append() re-inserts whatever content.element holds) instead
		// of restarting a conversion that has already spent its entire timeout budget.
	};

	content.__hdrLoading = true;
	options.refreshSpinner();
	timer = setTimeout(() => giveUp('timed out'), options.timeoutMs);

	return { promote, giveUp, get settled() { return settled; } };
}

export type HdrAvailability = 'available' | 'none' | 'unknown';

/**
 * Ask an HDR media route whether this photo has an HDR version at all (`?probe=1`), without
 * converting anything. 'none' only when the server says so explicitly (`x-pages-hdr: none`): a photo
 * with no HDR data then simply stays the standard photo. Anything else -- an error, a timeout, an
 * older server -- is 'unknown', and the caller tries the HDR version as it always has.
 */
export async function probeHdrVersion(src: string, fetchImpl: typeof fetch = fetch): Promise<HdrAvailability> {
	try {
		const response = await fetchImpl(`${src}${src.includes('?') ? '&' : '?'}probe=1`, { credentials: 'same-origin', cache: 'no-store' });
		if (response.status === 204 && response.headers.get('x-pages-hdr') === 'available') return 'available';
		if (response.status === 404 && response.headers.get('x-pages-hdr') === 'none') return 'none';
		return 'unknown';
	} catch {
		return 'unknown';
	}
}
