import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SharedLinkResponseSchema } from '../../src/lib/server/immich/types';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

// Pages is built against Immich v3.3.1 but must keep working with whatever Immich it is pointed
// at: a field Pages never reads that a later release renames, drops (a shared link's `password`,
// say) or retypes must not make every share fail to load. Pages requires only what it uses, and
// the security-relevant flags fall back to the safe answer when absent.
const without = (value: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const unused = ['id', 'description', 'password', 'userId', 'key', 'createdAt', 'expiresAt', 'allowUpload', 'slug'];

describe('Immich version tolerance', () => {
	it('loads a shared link without the fields Pages never reads', () => {
		const parsed = SharedLinkResponseSchema.safeParse(without(v3, ...unused));
		expect(parsed.success).toBe(true);
		expect(parsed.data?.assets).toHaveLength(1);
		expect(parsed.data?.album?.albumName).toBe('Journey');
	});

	it('ignores unused fields whose type changed in another release', () => {
		const parsed = SharedLinkResponseSchema.safeParse({ ...v3, password: true, expiresAt: 1_800_000_000, slug: 42, userId: 'not-a-uuid', createdAt: null, album: { ...v3.album, description: undefined } });
		expect(parsed.success).toBe(true);
	});

	it('never allows downloads, or shows metadata, when Immich does not say so', () => {
		const parsed = SharedLinkResponseSchema.safeParse(without(v3, 'allowDownload', 'showMetadata'));
		expect(parsed.success).toBe(true);
		expect(parsed.data?.allowDownload).toBe(false);
		expect(parsed.data?.showMetadata).toBe(false);
	});

	it('accepts IDs of any UUID version (Immich may move to time-ordered UUIDv7)', () => {
		const v7 = (n: number) => `0192f5c4-7a1b-7${String(n).padStart(3, '0')}-8abc-0123456789ab`;
		const parsed = SharedLinkResponseSchema.safeParse({ ...v3, id: v7(1), album: { ...v3.album, id: v7(2), albumThumbnailAssetId: v7(3) }, assets: [{ ...v3.assets[0], id: v7(3), livePhotoVideoId: v7(4) }] });
		expect(parsed.success).toBe(true);
		// The media routes take the same IDs from the URL: none may insist on version 4.
		const routes = 'src/routes/share/[kind]/[ref]/media/[assetId]';
		const sources = ['image/hdr', 'image/hdr-avif', 'image/fullsize', 'thumbnail', 'video/playback'].map((route) => readFileSync(`${routes}/${route}/+server.ts`, 'utf8'));
		for (const source of sources) expect(source).not.toContain('uuidv4');
	});

	it('still refuses what Pages cannot work with', () => {
		expect(SharedLinkResponseSchema.safeParse(without(v3, 'assets')).success).toBe(false);
		expect(SharedLinkResponseSchema.safeParse({ ...v3, assets: [{ ...v3.assets[0], id: '../../etc/passwd' }] }).success).toBe(false);
		expect(SharedLinkResponseSchema.safeParse({ ...v3, type: undefined }).success).toBe(false);
	});

	it('requires nothing of a shared link that Immich v3.3.1 does not guarantee', async () => {
		const openApi = JSON.parse(readFileSync('tests/fixtures/immich/v3.3.1/openapi-excerpt.json', 'utf8'));
		const guaranteed: string[] = openApi.schemas.SharedLinkResponseDto.required;
		const shape = SharedLinkResponseSchema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
		const requiredByPages = Object.keys(shape).filter((key) => !shape[key].safeParse(undefined).success);
		expect(requiredByPages.every((key) => guaranteed.includes(key))).toBe(true);
	});
});

// The suite must run in a clean checkout (CI, an isolated box): no test may read files from
// outside the repository, such as a sibling Immich checkout.
describe('test suite is self-contained', () => {
	it('reads nothing from absolute paths outside the repository', () => {
		const files: string[] = [];
		const walk = (directory: string) => {
			for (const name of readdirSync(directory)) {
				const path = join(directory, name);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.(ts|mjs|js)$/.test(name)) files.push(path);
			}
		};
		walk('tests');
		const offenders = files.filter((file) => /readFileSync\(\s*['"`]\/(?!tmp\/)/.test(readFileSync(file, 'utf8')));
		expect(offenders).toEqual([]);
	});
});
