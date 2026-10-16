import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginHdrUpgrade, isHdrUpgradeLoading, type HdrUpgradeContent, probeHdrVersion } from '../../src/lib/media/hdr-upgrade';

// These tests pin the two PhotoSwipe 5.4.4 lifecycle contracts that the lightbox's HDR paths
// have to honor, because getting either of them wrong is invisible from the outside -- the
// symptom is "a spinner that never stops" or "a blank slide", with no error anywhere. Both
// were real, shipped regressions (see .planning/debug/resolved/hdr-lightbox-state-regression.md).
//
// Contract A (ui/loading-indicator.js): the built-in preloader re-reads
// content.isLoading() ONLY when told to -- on 'change', on 'loadComplete', or via the
// updatePreloaderVisibility() method it deliberately exposes. A content type that loads
// outside PhotoSwipe's own image pipeline must therefore announce *both* edges of its
// loading state, or the spinner it switched on can never switch off.
//
// Contract B (slide/content.js:395-441 + slide/slide.js:145-166): Content.append() reads
// content.element at call time, and Slide.appendHeavy() deliberately refuses to run while the
// opening animation is still in progress. So content.isAttached === false is a NORMAL state
// for a first slide that is still opening -- it does not mean the slide was recycled, and
// treating it as such is what blanked the first photo.

/** A structural stand-in for PhotoSwipe's Content, with only the fields the upgrade touches. */
function fakeContent(overrides: Partial<HdrUpgradeContent> = {}) {
	const appended: unknown[] = [];
	const content = {
		// PhotoSwipe's own load state. The upgrade must never write this -- keeping a second,
		// hand-maintained copy of "am I loading" is precisely what desynced from the spinner.
		state: 'idle',
		isAttached: false,
		slide: { container: { appendChild: (node: unknown) => void appended.push(node) } },
		element: undefined as unknown,
		...overrides
	} satisfies Record<string, unknown> as HdrUpgradeContent & { state: string; isAttached: boolean };
	return { content, appended };
}

function fakeElement() {
	let removed = false;
	return { remove: () => { removed = true; }, get removed() { return removed; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HDR upgrade: spinner handoff to PhotoSwipe (contract A)', () => {
	it('reports loading and asks PhotoSwipe to re-read it as soon as the upgrade starts', () => {
		const { content } = fakeContent();
		const refreshSpinner = vi.fn();

		beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner });

		expect(isHdrUpgradeLoading(content)).toBe(true);
		expect(refreshSpinner).toHaveBeenCalledTimes(1);
	});

	// The actual shipped bug: the spinner armed and then nothing ever told PhotoSwipe to look
	// again, so it ran forever over an HDR video that had in fact loaded correctly.
	it('reports not-loading and re-asks PhotoSwipe on promote', () => {
		const { content } = fakeContent({ isAttached: true });
		const refreshSpinner = vi.fn();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner });

		upgrade.promote();

		expect(isHdrUpgradeLoading(content)).toBe(false);
		expect(refreshSpinner).toHaveBeenCalledTimes(2);
	});

	it('reports not-loading and re-asks PhotoSwipe on give-up', () => {
		const { content } = fakeContent({ isAttached: true });
		const refreshSpinner = vi.fn();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner });

		upgrade.giveUp('video-load');

		expect(isHdrUpgradeLoading(content)).toBe(false);
		expect(refreshSpinner).toHaveBeenCalledTimes(2);
	});

	it('reports not-loading and re-asks PhotoSwipe when the attempt times out', () => {
		const { content } = fakeContent({ isAttached: true });
		const refreshSpinner = vi.fn();
		const onSettled = vi.fn();
		beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner, onSettled });

		// Boundary: nothing may settle before the budget is actually spent.
		vi.advanceTimersByTime(999);
		expect(isHdrUpgradeLoading(content)).toBe(true);
		expect(onSettled).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(isHdrUpgradeLoading(content)).toBe(false);
		expect(onSettled).toHaveBeenCalledWith('gave-up', 'timed out');
		expect(refreshSpinner).toHaveBeenCalledTimes(2);
	});

	// Guards the root cause of defect 1 directly: a second copy of the loading state is what
	// drifted out of sync with the spinner. There must be exactly one source of truth.
	it('never writes PhotoSwipe\'s own content.state', () => {
		const { content } = fakeContent({ isAttached: true });
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner: () => {} });
		expect((content as { state: string }).state).toBe('idle');
		upgrade.promote();
		expect((content as { state: string }).state).toBe('idle');
	});
});

describe('HDR upgrade: element handoff to PhotoSwipe (contract B)', () => {
	// The first-photo defect. A promote that lands inside the opening-animation window used to
	// be misread as "this slide was recycled, nobody is looking", which set content.element =
	// undefined and left the slide permanently blank.
	it('hands the real element to PhotoSwipe without appending when the slide is not attached yet', () => {
		const { content, appended } = fakeContent({ isAttached: false });
		const placeholder = fakeElement();
		const real = fakeElement();
		const upgrade = beginHdrUpgrade({ content, placeholder, real, timeoutMs: 1000, refreshSpinner: () => {} });

		upgrade.promote();

		// Must be the real element -- never undefined, which is what blanked the slide.
		expect(content.element).toBe(real);
		// PhotoSwipe's own Content.append() has not run yet and will insert content.element
		// when it does, so appending here would double-insert.
		expect(appended).toEqual([]);
		// The placeholder was never in the DOM in this window; removing it is not our job.
		expect(placeholder.removed).toBe(false);
		expect(content.__hdrPromoted).toBe(true);
	});

	// Boundary neighbor of the case above: once PhotoSwipe HAS attached the placeholder, it will
	// not call append() again, so the swap is ours to perform.
	it('swaps the element into the slide container itself when the slide is already attached', () => {
		const { content, appended } = fakeContent({ isAttached: true });
		const placeholder = fakeElement();
		const real = fakeElement();
		const upgrade = beginHdrUpgrade({ content, placeholder, real, timeoutMs: 1000, refreshSpinner: () => {} });

		upgrade.promote();

		expect(content.element).toBe(real);
		expect(appended).toEqual([real]);
		expect(placeholder.removed).toBe(true);
	});

	it('keeps the SDR placeholder as the live element when it gives up', () => {
		const { content, appended } = fakeContent({ isAttached: true });
		const placeholder = fakeElement();
		content.element = placeholder;
		const upgrade = beginHdrUpgrade({ content, placeholder, real: fakeElement(), timeoutMs: 1000, refreshSpinner: () => {} });

		upgrade.giveUp('video-load');

		// Leaving content.element pointing at the SDR photo is what lets a revisit of this same
		// cached Content re-append the working photo instead of restarting a conversion that
		// already spent its whole timeout budget.
		expect(content.element).toBe(placeholder);
		expect(placeholder.removed).toBe(false);
		expect(appended).toEqual([]);
		expect(content.__hdrPromoted).toBeFalsy();
	});

	// A destroyed Content has had its slide cleared by PhotoSwipe (content.js:350-351). The
	// original stale-promotion bug was appending into such a slide's container.
	it('does not throw or append when the slide is already gone', () => {
		const { content } = fakeContent({ isAttached: true, slide: undefined });
		const real = fakeElement();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real, timeoutMs: 1000, refreshSpinner: () => {} });

		expect(() => upgrade.promote()).not.toThrow();
		expect(content.element).toBe(real);
	});
});

describe('HDR upgrade: settles exactly once', () => {
	it('ignores a give-up that arrives after a successful promote', () => {
		const { content, appended } = fakeContent({ isAttached: true });
		const onSettled = vi.fn();
		const releaseReal = vi.fn();
		const real = fakeElement();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real, timeoutMs: 1000, refreshSpinner: () => {}, onSettled, releaseReal });

		upgrade.promote();
		upgrade.giveUp('video-playback');

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith('promoted', undefined);
		// Tearing the media element down after it was promoted would kill the playing video.
		expect(releaseReal).not.toHaveBeenCalled();
		// The promoted element stays the live one; the late give-up must not revert it.
		expect(content.element).toBe(real);
		expect(appended).toEqual([real]);
	});

	it('cancels the timeout once promoted, so a slow success is not overwritten by a late give-up', () => {
		const { content } = fakeContent({ isAttached: true });
		const onSettled = vi.fn();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner: () => {}, onSettled });

		upgrade.promote();
		vi.advanceTimersByTime(5000);

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith('promoted', undefined);
	});

	it('ignores a repeated promote', () => {
		const { content, appended } = fakeContent({ isAttached: true });
		const onSettled = vi.fn();
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner: () => {}, onSettled });

		upgrade.promote();
		upgrade.promote();

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(appended).toHaveLength(1);
	});

	it('exposes whether it has settled', () => {
		const { content } = fakeContent({ isAttached: true });
		const upgrade = beginHdrUpgrade({ content, placeholder: fakeElement(), real: fakeElement(), timeoutMs: 1000, refreshSpinner: () => {} });
		expect(upgrade.settled).toBe(false);
		upgrade.promote();
		expect(upgrade.settled).toBe(true);
	});
});

describe('HDR upgrade: give-up ordering', () => {
	// The video path reads video.error?.code to report *why* it failed, and its own teardown
	// (removeAttribute('src') + load()) clears MediaError. So the diagnostic callback has to run
	// before the teardown, or every failure reports as a bare timeout.
	it('reports the outcome before releasing the media element', () => {
		const { content } = fakeContent({ isAttached: true });
		const order: string[] = [];
		const upgrade = beginHdrUpgrade({
			content,
			placeholder: fakeElement(),
			real: fakeElement(),
			timeoutMs: 1000,
			refreshSpinner: () => {},
			onSettled: (outcome, reason) => void order.push(`settled:${outcome}:${reason}`),
			releaseReal: () => void order.push('released')
		});

		upgrade.giveUp('video-load');

		expect(order).toEqual(['settled:gave-up:video-load', 'released']);
	});

	it('runs the pre-swap hook before handing the element over, so inherited sizing survives', () => {
		const { content } = fakeContent({ isAttached: true });
		const order: string[] = [];
		const real = fakeElement();
		const upgrade = beginHdrUpgrade({
			content,
			placeholder: fakeElement(),
			real,
			timeoutMs: 1000,
			refreshSpinner: () => {},
			beforeSwap: () => void order.push(`beforeSwap:element-is-${content.element === real ? 'real' : 'placeholder'}`),
			onSettled: () => void order.push('settled')
		});

		upgrade.promote();

		expect(order).toEqual(['beforeSwap:element-is-placeholder', 'settled']);
	});
});

// The lightbox asks the server whether a photo has an HDR version before trying one, so a photo
// with no HDR data stays the standard photo instead of showing a failed upgrade.
describe('probeHdrVersion', () => {
	it('asks the HDR route itself with probe=1, keeping its existing query', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 204, headers: { 'x-pages-hdr': 'available' } }));
		expect(await probeHdrVersion('/share/key/k/media/a/image/hdr-avif?key=k&width=10', fetchImpl)).toBe('available');
		expect(fetchImpl).toHaveBeenCalledWith('/share/key/k/media/a/image/hdr-avif?key=k&width=10&probe=1', expect.objectContaining({ credentials: 'same-origin' }));
		await probeHdrVersion('/share/key/k/media/a/image/hdr', fetchImpl);
		expect(fetchImpl).toHaveBeenLastCalledWith('/share/key/k/media/a/image/hdr?probe=1', expect.anything());
	});

	it('reports none only when the server says so explicitly', async () => {
		expect(await probeHdrVersion('/x', async () => new Response(null, { status: 404, headers: { 'x-pages-hdr': 'none' } }))).toBe('none');
		// Anything else is unknown, and the lightbox tries the HDR version as it always has.
		expect(await probeHdrVersion('/x', async () => new Response(null, { status: 404 }))).toBe('unknown');
		expect(await probeHdrVersion('/x', async () => new Response(null, { status: 502 }))).toBe('unknown');
		expect(await probeHdrVersion('/x', async () => { throw new TypeError('offline'); })).toBe('unknown');
	});
});
