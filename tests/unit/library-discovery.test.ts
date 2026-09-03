import { describe, expect, it } from 'vitest';
import { discoverLibrary } from '../../src/lib/server/library/discover';
import { visibilityAllows } from '../../src/lib/server/library/permissions';
import type { ImmichProvider } from '../../src/lib/server/immich/provider';

process.env.PAGES_LOCATOR_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const id = (n: string) => `${n.repeat(8).slice(0, 8)}-1111-4111-8111-111111111111`;
const description = (date: string) => `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n---\nHello`;
function provider(albums: Array<{ id: string; albumName: string; description?: string | null }>, failures = new Set<string>()) {
	return { getCurrentUser: async () => ({ status: 200, data: { id: id('a') } }), listAlbums: async () => ({ status: 200, data: albums }), getAlbum: async (_c: unknown, albumId: string) => failures.has(albumId) ? { status: 502 } : { status: 200, data: { ...albums.find((a) => a.id === albumId)!, description: albums.find((a) => a.id === albumId)?.description ?? null } }, getAlbumAssets: async (_c: unknown, albumId: string) => failures.has(albumId) ? { status: 502 } : { status: 200, data: [] }, getSharedLink: async () => ({ status: 404 }), loginSharedLink: async () => ({ status: 401 }), getThumbnail: async () => ({ status: 404 }), getVideoPlayback: async () => ({ status: 404 }), getMapMarkers: async () => ({ status: 200, data: [] }), getVersion: async () => ({ status: 200, version: '3.1.0' }) } as unknown as ImmichProvider;
}

describe('library discovery policy', () => {
	it('omits absent, unrelated, and malformed descriptions', async () => {
		const result = await discoverLibrary(provider([{ id: id('a'), albumName: 'Absent' }, { id: id('b'), albumName: 'Unrelated', description: '---\nother: true\n---' }, { id: id('c'), albumName: 'Malformed', description: description('not-a-date') }]), { kind: 'user-session', cookie: null, authorization: null });
		expect(result.entries).toHaveLength(0);
	});
	it('orders explicit dates newest first, then case-insensitive title', async () => {
		const result = await discoverLibrary(provider([{ id: id('a'), albumName: 'zulu', description: description('2024-01-01') }, { id: id('b'), albumName: 'Alpha', description: description('2024-01-01') }, { id: id('c'), albumName: 'Newest', description: description('2025-01-01') }]), { kind: 'user-session', cookie: null, authorization: null });
		expect(result.entries.map((entry) => entry.title)).toEqual(['Newest', 'Alpha', 'zulu']);
	});
	it('preserves usable entries when one album fails and redacts failure details', async () => {
		const result = await discoverLibrary(provider([{ id: id('a'), albumName: 'Good', description: description('2024-01-01') }, { id: id('b'), albumName: 'Private', description: description('2024-02-01') }], new Set([id('b')])), { kind: 'user-session', cookie: null, authorization: null });
		expect(result.kind).toBe('ready'); expect(result.entries).toHaveLength(1); expect(JSON.stringify(result)).not.toContain(id('b'));
	});
	it('treats visibility as deny-only and rejects ambiguous claims', () => {
		expect(visibilityAllows(undefined, { id: id('a') })).toBe(true);
		expect(visibilityAllows({ allow: [id('a')] }, { id: id('a') })).toBe(true);
		expect(visibilityAllows({ allow: [id('b')] }, { id: id('a') })).toBe(false);
		expect(visibilityAllows({ allow: ['group:travel'] }, { id: id('a') })).toBe(false);
	});
});
