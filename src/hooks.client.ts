import type { HandleClientError } from '@sveltejs/kit';
import { clientDiagnostics, installClientDiagnostics, journalDebugEnabled, reportJournalDebug } from '$lib/components/journal/journal-debug';

// lightbox-mobile-crash: one install for the whole client app, so the load that FOLLOWS a crash
// reports on it whichever route the browser lands on (the share page again, or the library).
// A no-op unless PUBLIC_PAGES_DEBUG=true.
installClientDiagnostics();

// The dev server reloads the page on its own -- when its websocket drops and reconnects (a phone
// locking, a reverse proxy idling the socket out) and when it re-optimizes a dependency it only
// just discovered. On a phone that is indistinguishable from a crash, so name it in the log.
if (journalDebugEnabled && import.meta.hot) {
	import.meta.hot.on('vite:beforeFullReload', () => {
		clientDiagnostics.setExitCause('dev-full-reload');
		reportJournalDebug('dev-reload', { devReason: 'vite:beforeFullReload' });
	});
	import.meta.hot.on('vite:ws:disconnect', () => reportJournalDebug('dev-reload', { devReason: 'vite:ws:disconnect' }));
	import.meta.hot.on('vite:ws:connect', () => reportJournalDebug('dev-reload', { devReason: 'vite:ws:connect' }));
}

export const handleError: HandleClientError = ({ error, message }) => {
	if (journalDebugEnabled) clientDiagnostics.reportError('sveltekit', error);
	return { message };
};
