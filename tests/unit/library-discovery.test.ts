import { describe, expect, it } from 'vitest';
import { discoverLibrary } from '../../src/lib/server/library/discover';
import { encodeRegistry } from '../../src/lib/server/share/registry';
import type { ImmichProvider } from '../../src/lib/server/immich/provider';
import type { SharedLinkRef } from '../../src/lib/server/share/ref';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.PAGES_SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters-long';

const refs: SharedLinkRef[] = [
	{ kind: 'key', value: 'newest' },
	{ kind: 'slug', value: 'older-journey' },
	{ kind: 'key', value: 'revoked' }
];
const registry = encodeRegistry({ version: 1, entries: refs.map((ref, index) => ({ ...ref, firstSeenAt: index, lastSeenAt: index, expiresAt: Date.now() + 100_000 })) });
const page = (ref: SharedLinkRef, date: string, title = ref.value) => ({
	status: 200,
	data: {
		id: `11111111-1111-4111-8111-11111111111${ref.kind === 'key' ? '1' : '2'}`,
		description: `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n---\nHello`,
		password: null,
		userId: '22222222-2222-4222-8222-222222222222',
		key: ref.value,
		type: 'ALBUM' as const,
		createdAt: date,
		expiresAt: null,
		slug: ref.kind === 'slug' ? ref.value : null,
		album: { id: '11111111-1111-4111-8111-111111111111', albumName: title, description: `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n---\nHello`, assets: [] },
		assets: [], allowUpload: false, allowDownload: false, showMetadata: true
	}
});

function provider(responses: Map<string, ReturnType<typeof page> | { status: number }>) {
	return {
		getSharedLink: async (context: { shareRef: SharedLinkRef }) => responses.get(`${context.shareRef.kind}:${context.shareRef.value}`) ?? { status: 404 },
		getMapMarkers: async () => ({ status: 200, data: [] }),
		getThumbnail: async () => ({ status: 404 }),
		getVideoPlayback: async () => ({ status: 404 })
	} as unknown as ImmichProvider;
}

describe('share-registry library discovery', () => {
	it('uses only registry refs, never a user session, and returns original share links newest first', async () => {
		const result = await discoverLibrary(provider(new Map([
			['key:newest', page(refs[0], '2025-01-01', 'Newest')],
			['slug:older-journey', page(refs[1], '2024-01-01', 'Older')],
			['key:revoked', { status: 403 }]
		])), { registryCookie: registry, sessionCookie: undefined, requestId: 'test' });

		expect(result.kind).toBe('ready');
		expect(result.entries.map((entry) => entry.title)).toEqual(['Newest', 'Older']);
		expect(result.entries.map((entry) => entry.href)).toEqual(['/share/key/newest', '/share/slug/older-journey']);
		expect(JSON.stringify(result)).not.toContain('11111111-1111');
	});

	it('returns a safe empty state for a missing or fully unauthorized registry', async () => {
		expect((await discoverLibrary(provider(new Map()), { registryCookie: undefined, sessionCookie: undefined, requestId: 'test' })).kind).toBe('empty');
		expect((await discoverLibrary(provider(new Map([['key:newest', { status: 403 }]])), { registryCookie: registry, sessionCookie: undefined, requestId: 'test' })).kind).toBe('empty');
	});
});
