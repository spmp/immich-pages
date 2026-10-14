// Real DOM render test for removing a journey from the desktop journeys list.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
const invalidateAll = vi.fn(async () => {});
vi.mock('$app/navigation', () => ({ invalidateAll }));
vi.mock('$app/paths', () => ({ resolve: (href: string) => href }));
const { default: PageNavigation } = await import('../../src/lib/components/navigation/PageNavigation.svelte');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); invalidateAll.mockClear(); });

const entries = [
	{ href: '/share/slug/current', title: 'Current trip' },
	{ href: '/share/key/older', title: 'Older trip' }
];

describe('PageNavigation journey removal', () => {
	it('offers a remove button for every journey except the one being viewed', () => {
		const { getByRole, queryByRole } = render(PageNavigation, { entries, activeHref: '/share/slug/current' });
		expect(getByRole('button', { name: 'Remove Older trip from journeys' })).toBeTruthy();
		// Visiting a journey adds it to the list, so removing the open one would only bring it back.
		expect(queryByRole('button', { name: 'Remove Current trip from journeys' })).toBeNull();
	});

	it('removes the journey at once, asks the server to forget it, then refreshes the lists', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchMock);
		const { getByRole, queryByText } = render(PageNavigation, { entries, activeHref: '/share/slug/current' });
		await fireEvent.click(getByRole('button', { name: 'Remove Older trip from journeys' }));
		expect(queryByText('Older trip')).toBeNull();
		expect(fetchMock).toHaveBeenCalledWith('/library/forget', expect.objectContaining({ method: 'POST', body: JSON.stringify({ href: '/share/key/older' }) }));
		await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
	});

	it('puts the journey back if the server could not forget it', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
		const { getByRole, findByText } = render(PageNavigation, { entries, activeHref: '/share/slug/current' });
		await fireEvent.click(getByRole('button', { name: 'Remove Older trip from journeys' }));
		expect(await findByText('Older trip')).toBeTruthy();
		expect(invalidateAll).not.toHaveBeenCalled();
	});
});
