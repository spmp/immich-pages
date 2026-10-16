import { invalidateAll } from '$app/navigation';

/**
 * Ask the server to drop a journey from this browser's library, then reload page data so every
 * list on the page (sidebar, drawer, library grid) agrees. Resolves false if it was not removed.
 */
export async function forgetLibraryEntry(href: string): Promise<boolean> {
	try {
		const response = await fetch('/library/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ href }), credentials: 'same-origin' });
		if (!response.ok) return false;
	} catch { return false; }
	void invalidateAll();
	return true;
}
