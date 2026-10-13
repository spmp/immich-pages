import { describe, expect, it } from 'vitest';
import { createClientDiagnostics, describePreviousSession, measureMediaFootprint, measureVideoStates, redactDiagnosticText, routeKind, type DiagnosticsBreadcrumb } from '../../src/lib/components/journal/client-diagnostics';

type Reported = { event: string; details: Record<string, unknown> };

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); }
	};
}

function fakeWindow(pathname = '/share/slug/e2e-forward', navType = 'navigate') {
	const listeners = new Map<string, Array<(event: any) => void>>();
	const target = {
		addEventListener: (type: string, listener: (event: any) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
		dispatch: (type: string, event: Record<string, unknown> = {}) => { for (const listener of listeners.get(type) ?? []) listener({ type, ...event }); }
	};
	const document = { visibilityState: 'visible', ...target, images: [], querySelectorAll: () => [] };
	const win = {
		...target,
		document,
		location: { pathname },
		history: { length: 3, state: null as unknown },
		performance: { getEntriesByType: () => [{ type: navType }] }
	};
	return win;
}

function harness(options: { storage?: ReturnType<typeof memoryStorage>; now?: () => number; pathname?: string; navType?: string } = {}) {
	const reported: Reported[] = [];
	const storage = options.storage ?? memoryStorage();
	let clock = 1_000;
	const now = options.now ?? (() => clock);
	const win = fakeWindow(options.pathname, options.navType);
	const diagnostics = createClientDiagnostics({ report: (event, details) => reported.push({ event, details: details as Record<string, unknown> }), win: win as never, storage, now, session: 'session-a' });
	return { diagnostics, reported, storage, win, advance: (ms: number) => { clock += ms; } };
}

describe('redactDiagnosticText', () => {
	it('removes share refs, asset identifiers, hosts and query strings from error text', () => {
		const text = redactDiagnosticText('TypeError: boom at https://pages.example.xyz/share/key/SECRETREF123/media/6818a3ce-04c3-4485-a0d9-9fd93e842a86/image/hdr?width=4032&height=3024 (chunk.js:1:2)', 500);
		expect(text).not.toContain('SECRETREF123');
		expect(text).not.toContain('6818a3ce');
		expect(text).not.toContain('pages.example.xyz');
		expect(text).not.toContain('width=4032');
		expect(text).toContain('TypeError: boom');
		expect(text).toContain('/share/key/<ref>/media/<id>/image/hdr');
		expect(text).toContain('chunk.js:1:2');
	});

	it('bounds the length and tolerates non-string input', () => {
		expect(redactDiagnosticText('word '.repeat(200), 50)).toHaveLength(50);
		expect(redactDiagnosticText(undefined, 50)).toBe('');
		expect(redactDiagnosticText({ toString() { throw new Error('nope'); } }, 50)).toBe('');
	});
});

describe('routeKind', () => {
	it('classifies the path without exposing it', () => {
		expect(routeKind('/share/key/abc')).toBe('share');
		expect(routeKind('/library')).toBe('library');
		expect(routeKind('/library/page/abc')).toBe('library-page');
		expect(routeKind('/elsewhere')).toBe('other');
	});
});

describe('describePreviousSession', () => {
	const crumb: DiagnosticsBreadcrumb = { session: 'session-a', start: 1_000, t: 61_000, lastEvent: 'lightbox:changed', lightboxOpen: true, slideIndex: 7, slidesViewed: 12, decodedMegapixels: 240, liveVideos: 3, retainedHdr: 9, visibility: 'visible', routeKind: 'share' };

	it('reads a breadcrumb with no exit marker as an unclean end (tab killed)', () => {
		expect(describePreviousSession(crumb, 63_000)).toEqual({ prevExit: 'unclean', prevSession: 'session-a', prevLightboxOpen: true, prevLastEvent: 'lightbox:changed', prevIdleMs: 2_000, prevUptimeMs: 60_000, prevSlideIndex: 7, prevSlidesViewed: 12, prevDecodedMegapixels: 240, prevLiveVideos: 3, prevRetainedHdr: 9, prevVisibility: 'visible', prevRouteKind: 'share' });
	});

	it('reads a breadcrumb with an exit marker as a clean end and keeps its cause', () => {
		const described = describePreviousSession({ ...crumb, exit: 'pagehide', exitCause: 'lightbox-close-back' }, 63_000);
		expect(described.prevExit).toBe('clean');
		expect(described.prevExitCause).toBe('lightbox-close-back');
	});
});

describe('measureMediaFootprint', () => {
	it('sums decoded pixels across page images, videos and retained off-DOM media', () => {
		const pswpImage = { complete: true, naturalWidth: 4000, naturalHeight: 3000, closest: () => ({}) };
		const galleryImage = { complete: true, naturalWidth: 1000, naturalHeight: 1000, closest: () => null };
		const pending = { complete: false, naturalWidth: 0, naturalHeight: 0, closest: () => null };
		const video = { videoWidth: 2000, videoHeight: 1000, closest: () => ({}), isConnected: true };
		const retained = { complete: true, naturalWidth: 2000, naturalHeight: 2000, isConnected: false };
		const doc = { images: [pswpImage, galleryImage, pending], querySelectorAll: () => [video] };
		expect(measureMediaFootprint(doc as never, [retained, pswpImage] as never)).toEqual({ domImages: 3, domVideos: 1, decodedMegapixels: 19, lightboxMegapixels: 18 });
	});
});

describe('measureVideoStates', () => {
	it('separates videos that can still show a frame from ones the platform has taken the decoder away from', () => {
		const showing = { readyState: 4, videoWidth: 3000, videoHeight: 2000, paused: false, error: null };
		const paused = { readyState: 4, videoWidth: 3000, videoHeight: 2000, paused: true, error: null };
		const purged = { readyState: 4, videoWidth: 0, videoHeight: 0, paused: true, error: null };
		const unloaded = { readyState: 0, videoWidth: 0, videoHeight: 0, paused: true, error: null };
		const errored = { readyState: 0, videoWidth: 0, videoHeight: 0, paused: true, error: { code: 3 } };
		const image = { complete: true, naturalWidth: 10, naturalHeight: 10 };
		expect(measureVideoStates([showing, paused, purged, unloaded, errored, image, showing] as never)).toEqual({ videosHeld: 5, videosWithFrame: 2, videosFrameless: 2, videosPlaying: 1, videosErrored: 1 });
	});
});

describe('createClientDiagnostics', () => {
	it('stops repeating an identical error after a few reports, so injected-script noise cannot bury a real one', () => {
		const { diagnostics, reported, win } = harness();
		diagnostics.install();
		for (let index = 0; index < 10; index += 1) win.dispatch('error', { message: 'Script error.', lineno: 0, colno: 0 });
		win.dispatch('error', { error: new TypeError('a different failure'), message: 'a different failure' });
		const errors = reported.filter((entry) => entry.event === 'client-error');
		expect(errors.filter((entry) => entry.details.errorMessage === 'Script error.')).toHaveLength(3);
		expect(errors.at(-1)?.details.errorMessage).toBe('a different failure');
	});

	it('reports how the page was entered', () => {
		const { diagnostics, reported } = harness({ navType: 'reload' });
		diagnostics.install();
		expect(reported[0]).toEqual({ event: 'page-entry', details: { navType: 'reload', routeKind: 'share', historyLength: 3, stateIsLightbox: false, visibility: 'visible' } });
		expect(reported.some((entry) => entry.event === 'previous-session')).toBe(false);
	});

	it('reports a killed previous session on the next load, with where it died', () => {
		const storage = memoryStorage();
		const first = harness({ storage });
		first.diagnostics.install();
		first.diagnostics.note('lightbox:changed', { lightboxOpen: true, slideIndex: 4, slidesViewed: 5, decodedMegapixels: 120, liveVideos: 2, retainedHdr: 4 });
		// No pagehide: the tab's process was killed.
		const second = harness({ storage, navType: 'reload', now: () => 4_000 });
		second.diagnostics.install();
		const previous = second.reported.find((entry) => entry.event === 'previous-session');
		expect(previous?.details).toMatchObject({ prevExit: 'unclean', prevLightboxOpen: true, prevLastEvent: 'lightbox:changed', prevSlideIndex: 4, prevDecodedMegapixels: 120, prevIdleMs: 3_000, prevSession: 'session-a' });
	});

	it('marks an ordinary navigation away as a clean exit carrying its cause', () => {
		const storage = memoryStorage();
		const first = harness({ storage });
		first.diagnostics.install();
		first.diagnostics.note('lightbox:opened', { lightboxOpen: true, slideIndex: 0 });
		first.diagnostics.setExitCause('lightbox-close-back');
		first.win.dispatch('pagehide', { persisted: false });
		expect(first.reported.at(-1)).toEqual({ event: 'page-exit', details: { persisted: false, lightboxOpen: true, exitCause: 'lightbox-close-back', visibility: 'visible' } });
		const second = harness({ storage, pathname: '/library', navType: 'back_forward' });
		second.diagnostics.install();
		expect(second.reported.find((entry) => entry.event === 'previous-session')?.details).toMatchObject({ prevExit: 'clean', prevExitCause: 'lightbox-close-back' });
	});

	it('reports uncaught errors and rejections with redacted text', () => {
		const { diagnostics, reported, win } = harness();
		diagnostics.install();
		const error = Object.assign(new TypeError('cannot read /share/key/SECRETREF123'), { stack: 'TypeError: cannot read\n    at f (https://pages.example.xyz/_app/chunk.js:10:5)' });
		win.dispatch('error', { error, message: error.message, filename: 'https://pages.example.xyz/_app/chunk.js?v=1', lineno: 10, colno: 5 });
		win.dispatch('unhandledrejection', { reason: new RangeError('too big') });
		const [first, second] = reported.filter((entry) => entry.event === 'client-error');
		expect(first.details).toMatchObject({ errorKind: 'error', errorName: 'TypeError', errorFile: 'chunk.js', errorLine: 10, errorColumn: 5 });
		expect(String(first.details.errorMessage)).not.toContain('SECRETREF123');
		expect(String(first.details.errorStack)).not.toContain('pages.example.xyz');
		expect(second.details).toMatchObject({ errorKind: 'unhandledrejection', errorName: 'RangeError', errorMessage: 'too big' });
	});

	it('ignores resource load errors, which have no error object or message', () => {
		const { diagnostics, reported, win } = harness();
		diagnostics.install();
		win.dispatch('error', { target: {} });
		expect(reported.filter((entry) => entry.event === 'client-error')).toHaveLength(0);
	});

	it('reports visibility changes and keeps the breadcrumb current', () => {
		const storage = memoryStorage();
		const first = harness({ storage });
		first.diagnostics.install();
		(first.win.document as { visibilityState: string }).visibilityState = 'hidden';
		first.win.document.dispatch('visibilitychange');
		expect(first.reported.at(-1)).toEqual({ event: 'visibility', details: { visibility: 'hidden', lightboxOpen: false } });
		const second = harness({ storage });
		second.diagnostics.install();
		expect(second.reported.find((entry) => entry.event === 'previous-session')?.details).toMatchObject({ prevExit: 'unclean', prevVisibility: 'hidden' });
	});

	it('survives storage that throws', () => {
		const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
		const { diagnostics, reported } = harness({ storage: throwing });
		expect(() => { diagnostics.install(); diagnostics.note('lightbox:opened', { lightboxOpen: true }); }).not.toThrow();
		expect(reported[0].event).toBe('page-entry');
	});
});
