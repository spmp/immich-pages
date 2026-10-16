// Crash diagnostics for the case devtools cannot reach: a phone browser where the lightbox
// intermittently reloads the page or lands back on the library.
//
// Three distinct things look identical from the outside and leave very different traces:
//
//   * the OS killing the tab's process (memory pressure). No JavaScript runs at all -- no error,
//     no pagehide. The ONLY evidence is absence: the breadcrumb below never gets its exit marker,
//     and the next load reports that.
//   * an uncaught exception. Caught by the global error/unhandledrejection listeners.
//   * a real navigation (history.back() landing somewhere unexpected, a dev-server full reload).
//     pagehide fires, and carries whichever cause was recorded just before it.
//
// Everything here is pure against injected window/storage/clock so it runs under plain node in
// tests/unit/client-diagnostics.test.ts; journal-debug.ts owns the PUBLIC_PAGES_DEBUG gate and
// the relay to the server log.

export type DiagnosticsRouteKind = 'share' | 'library' | 'library-page' | 'other';
export type DiagnosticsExitCause = 'lightbox-close-back' | 'lightbox-fallback-assign' | 'sveltekit-navigation' | 'popstate' | 'dev-full-reload';
export type DiagnosticsVisibility = 'visible' | 'hidden';

/** Last known state of a page session, persisted so the NEXT load can report how this one ended. */
export interface DiagnosticsBreadcrumb {
	session: string;
	/** Epoch ms the session started / was last known alive. */
	start: number;
	t: number;
	lastEvent: string;
	lightboxOpen?: boolean;
	slideIndex?: number;
	slidesViewed?: number;
	decodedMegapixels?: number;
	liveVideos?: number;
	retainedHdr?: number;
	visibility?: DiagnosticsVisibility;
	routeKind?: DiagnosticsRouteKind;
	/** Only ever set from pagehide. Its absence on the next load means the tab was killed. */
	exit?: 'pagehide' | 'pagehide-persisted';
	exitCause?: DiagnosticsExitCause;
}

export type DiagnosticsNote = Partial<Pick<DiagnosticsBreadcrumb, 'lightboxOpen' | 'slideIndex' | 'slidesViewed' | 'decodedMegapixels' | 'liveVideos' | 'retainedHdr'>>;

type Report = (event: any, details?: any) => void;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type MediaLike = { readyState?: number; paused?: boolean; error?: unknown; complete?: boolean; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; isConnected?: boolean; closest?(selector: string): unknown };
type DocumentLike = { images: ArrayLike<MediaLike>; querySelectorAll(selector: string): ArrayLike<MediaLike> };

const STORAGE_KEY = 'immich-pages-debug-breadcrumb';

/**
 * Error text is the one free-form thing this relay carries, and stack frames embed full page
 * addresses -- which for a share page contain the share ref itself. Strip everything that can
 * identify a share, an asset or the deployment before it leaves the browser.
 */
export function redactDiagnosticText(value: unknown, max: number): string {
	let text: string;
	try { text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value); } catch { return ''; }
	return text
		.replace(/[a-z][a-z0-9+.-]*:\/\/[^/\s)'"]+/gi, '')
		.replace(/\?[^\s)'":]*/g, '')
		.replace(/\/share\/(key|slug)\/[^/\s)'":]+/g, '/share/$1/<ref>')
		.replace(/\/page\/[^/\s)'":]+/g, '/page/<ref>')
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
		.replace(/[A-Za-z0-9_-]{32,}/g, '<token>')
		.slice(0, max);
}

export function routeKind(pathname: string): DiagnosticsRouteKind {
	if (pathname.startsWith('/share/')) return 'share';
	if (pathname.startsWith('/library/page/')) return 'library-page';
	if (pathname === '/library' || pathname === '/library/') return 'library';
	return 'other';
}

/** Turn a stored breadcrumb into the `previous-session` report for the load that found it. */
export function describePreviousSession(crumb: DiagnosticsBreadcrumb, now: number) {
	return {
		prevExit: crumb.exit ? 'clean' as const : 'unclean' as const,
		prevSession: crumb.session,
		...(crumb.exitCause ? { prevExitCause: crumb.exitCause } : {}),
		...(crumb.lightboxOpen === undefined ? {} : { prevLightboxOpen: crumb.lightboxOpen }),
		prevLastEvent: crumb.lastEvent,
		// How stale the breadcrumb was when the page came back. A heartbeat keeps it fresh while
		// the lightbox is open, so a small value means it died mid-use rather than in the background.
		prevIdleMs: Math.max(0, now - crumb.t),
		prevUptimeMs: Math.max(0, crumb.t - crumb.start),
		...(crumb.slideIndex === undefined ? {} : { prevSlideIndex: crumb.slideIndex }),
		...(crumb.slidesViewed === undefined ? {} : { prevSlidesViewed: crumb.slidesViewed }),
		...(crumb.decodedMegapixels === undefined ? {} : { prevDecodedMegapixels: crumb.decodedMegapixels }),
		...(crumb.liveVideos === undefined ? {} : { prevLiveVideos: crumb.liveVideos }),
		...(crumb.retainedHdr === undefined ? {} : { prevRetainedHdr: crumb.retainedHdr }),
		...(crumb.visibility ? { prevVisibility: crumb.visibility } : {}),
		...(crumb.routeKind ? { prevRouteKind: crumb.routeKind } : {})
	};
}

/**
 * Decoded-pixel footprint of everything the page is holding, as a stand-in for memory: mobile
 * Safari exposes no heap or process figure at all, but a decoded bitmap costs about 4 bytes per
 * pixel, so megapixels x 4 is roughly the megabytes pinned by media alone. `retained` is media
 * kept alive off-DOM (the lightbox's promoted-HDR cache), which no DOM query can see.
 */
export function measureMediaFootprint(doc: DocumentLike, retained: Iterable<MediaLike> = []) {
	let total = 0;
	let inLightbox = 0;
	const pixels = (media: MediaLike) => (media.videoWidth ? media.videoWidth * (media.videoHeight ?? 0) : media.complete === false ? 0 : (media.naturalWidth ?? 0) * (media.naturalHeight ?? 0));
	const images = Array.from(doc.images);
	const videos = Array.from(doc.querySelectorAll('video'));
	const seen = new Set<MediaLike>();
	for (const media of [...images, ...videos]) {
		seen.add(media);
		total += pixels(media);
		if (media.closest?.('.pswp')) inLightbox += pixels(media);
	}
	for (const media of retained) {
		if (seen.has(media)) continue;
		seen.add(media);
		total += pixels(media);
		inLightbox += pixels(media);
	}
	return { domImages: images.length, domVideos: videos.length, decodedMegapixels: Math.round(total / 1e6), lightboxMegapixels: Math.round(inLightbox / 1e6) };
}

/**
 * What state the videos the lightbox is holding are actually in. A video the platform has taken
 * the decoder away from keeps its element, its src and often its readyState, but reports a zero
 * frame size and paints black -- which is what "the slide went black" looks like from the inside,
 * and which the megapixel figure alone only hints at by dipping.
 */
export function measureVideoStates(media: Iterable<MediaLike>) {
	const videos = new Set<MediaLike>();
	for (const item of media) if (item && typeof item.readyState === 'number' && 'videoWidth' in item) videos.add(item);
	let withFrame = 0;
	let frameless = 0;
	let playing = 0;
	let errored = 0;
	for (const video of videos) {
		if (video.error) errored += 1;
		else if ((video.videoWidth ?? 0) > 0) { withFrame += 1; if (video.paused === false) playing += 1; }
		else frameless += 1;
	}
	return { videosHeld: videos.size, videosWithFrame: withFrame, videosFrameless: frameless, videosPlaying: playing, videosErrored: errored };
}

export interface ClientDiagnosticsOptions {
	report: Report;
	session: string;
	win?: Window;
	storage?: StorageLike;
	now?: () => number;
}

export function createClientDiagnostics(options: ClientDiagnosticsOptions) {
	const now = options.now ?? (() => Date.now());
	const getWindow = () => options.win ?? (typeof window === 'undefined' ? undefined : window);
	const getStorage = (): StorageLike | undefined => {
		if (options.storage) return options.storage;
		try { return getWindow()?.sessionStorage; } catch { return undefined; }
	};
	let installed = false;
	let crumb: DiagnosticsBreadcrumb | undefined;
	let exitCause: DiagnosticsExitCause | undefined;
	// Browser-injected scripts (reader mode, wallet and dark-mode shims) throw the same error on
	// every page event; a handful of each is evidence, hundreds only bury the one that matters.
	const errorRepeats = new Map<string, number>();
	const reportClientError = (fields: { errorKind: string; errorName?: string; errorMessage: string }, extra: Record<string, unknown> = {}) => {
		const key = `${fields.errorKind}|${fields.errorName ?? ''}|${fields.errorMessage}`;
		const seen = errorRepeats.get(key) ?? 0;
		if (seen >= 3) return;
		errorRepeats.set(key, seen + 1);
		options.report('client-error', { ...fields, ...extra });
	};

	const persist = () => {
		if (!crumb) return;
		try { getStorage()?.setItem(STORAGE_KEY, JSON.stringify(crumb)); } catch { /* private mode / quota: diagnostics must never break the page */ }
	};
	const visibility = (): DiagnosticsVisibility => (getWindow()?.document.visibilityState === 'hidden' ? 'hidden' : 'visible');
	const errorFields = (kind: string, error: unknown, fallbackMessage?: unknown) => {
		const named = error as { name?: unknown; message?: unknown; stack?: unknown } | undefined;
		const isObject = typeof error === 'object' && error !== null;
		return {
			errorKind: kind,
			...(isObject && typeof named?.name === 'string' ? { errorName: redactDiagnosticText(named.name, 80) } : {}),
			errorMessage: redactDiagnosticText(isObject && named?.message !== undefined ? named.message : (error ?? fallbackMessage), 300),
			...(isObject && typeof named?.stack === 'string' ? { errorStack: redactDiagnosticText(named.stack, 1500) } : {})
		};
	};

	return {
		/** Wire the global listeners and report how this load began and how the last one ended. */
		install(): void {
			const win = getWindow();
			if (installed || !win) return;
			installed = true;
			const startedAt = now();
			const kind = routeKind(win.location.pathname);
			let navType = 'unknown';
			try { navType = (win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? 'unknown'; } catch { /* unsupported */ }
			options.report('page-entry', { navType, routeKind: kind, historyLength: win.history.length, stateIsLightbox: Boolean((win.history.state as { immichPagesLightbox?: boolean } | null)?.immichPagesLightbox), visibility: visibility() });

			let previous: DiagnosticsBreadcrumb | undefined;
			try {
				const stored = getStorage()?.getItem(STORAGE_KEY);
				if (stored) previous = JSON.parse(stored) as DiagnosticsBreadcrumb;
			} catch { /* unreadable breadcrumb is the same as none */ }
			if (previous && typeof previous.t === 'number' && typeof previous.session === 'string') options.report('previous-session', describePreviousSession(previous, startedAt));

			crumb = { session: options.session, start: startedAt, t: startedAt, lastEvent: 'page-entry', visibility: visibility(), routeKind: kind };
			persist();

			win.addEventListener('error', (event: ErrorEvent) => {
				// Resource load failures (img/video) also arrive here in the capture phase, with no
				// error object and no message; the media elements report those themselves.
				if (!event.error && !event.message) return;
				const file = typeof event.filename === 'string' ? redactDiagnosticText(event.filename, 300).split('/').pop()?.slice(0, 80) : undefined;
				reportClientError(errorFields('error', event.error, event.message), { ...(file ? { errorFile: file } : {}), ...(typeof event.lineno === 'number' ? { errorLine: event.lineno } : {}), ...(typeof event.colno === 'number' ? { errorColumn: event.colno } : {}) });
			}, true);
			win.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
				reportClientError(errorFields('unhandledrejection', event.reason));
			});
			win.addEventListener('pagehide', (event: PageTransitionEvent) => {
				const persisted = Boolean(event.persisted);
				options.report('page-exit', { persisted, lightboxOpen: Boolean(crumb?.lightboxOpen), ...(exitCause ? { exitCause } : {}), visibility: visibility() });
				if (!crumb) return;
				crumb = { ...crumb, t: now(), exit: persisted ? 'pagehide-persisted' : 'pagehide', ...(exitCause ? { exitCause } : {}) };
				persist();
			});
			win.addEventListener('pageshow', (event: PageTransitionEvent) => {
				// Restored from the back/forward cache: this same session is alive again.
				if (!event.persisted || !crumb) return;
				crumb = { ...crumb, t: now(), exit: undefined, exitCause: undefined, lastEvent: 'pageshow-restored' };
				exitCause = undefined;
				persist();
				options.report('page-entry', { navType: 'bfcache-restore', routeKind: kind, historyLength: win.history.length, stateIsLightbox: Boolean((win.history.state as { immichPagesLightbox?: boolean } | null)?.immichPagesLightbox), visibility: visibility() });
			});
			win.document.addEventListener('visibilitychange', () => {
				// A backgrounded tab being discarded is expected OS behavior, not the bug; recording
				// visibility is what lets the next load tell the two apart.
				options.report('visibility', { visibility: visibility(), lightboxOpen: Boolean(crumb?.lightboxOpen) });
				if (!crumb) return;
				crumb = { ...crumb, t: now(), visibility: visibility() };
				persist();
			});
		},

		/** Record where the session currently is. Cheap; safe to call on every lightbox event. */
		note(lastEvent: string, state: DiagnosticsNote = {}): void {
			if (!crumb) return;
			crumb = { ...crumb, ...state, t: now(), lastEvent: lastEvent.slice(0, 40), visibility: visibility() };
			persist();
		},

		/** Keep the breadcrumb's timestamp fresh without changing what it says happened last. */
		heartbeat(state: DiagnosticsNote = {}): void {
			if (!crumb) return;
			crumb = { ...crumb, ...state, t: now() };
			persist();
		},

		/** Name the code path about to leave the page, so pagehide can report it. */
		setExitCause(cause: DiagnosticsExitCause | undefined): void {
			exitCause = cause;
		},

		reportError(kind: 'sveltekit' | 'lightbox-init', error: unknown): void {
			options.report('client-error', errorFields(kind, error));
		}
	};
}

export type ClientDiagnostics = ReturnType<typeof createClientDiagnostics>;
