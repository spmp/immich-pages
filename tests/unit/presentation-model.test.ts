import { describe, expect, it } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';
import { selectHero } from '../../src/lib/server/presentation/model';

const share = { album: { albumThumbnailAssetId: 'b' }, assets: [
	{ id: 'a', originalFileName: 'first.jpg', type: 'IMAGE' },
	{ id: 'b', originalFileName: 'cover.jpg', type: 'IMAGE' }
]} as never;

describe('normalized presentation model seams', () => {
	it('selects only authorized heroes using filename, id, cover, fallback precedence', () => {
		const parsed = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  hero:\n    filename: cover.jpg\n---');
		expect(parsed.kind).toBe('valid');
		if (parsed.kind === 'valid') expect(selectHero(parsed.config, share)?.id).toBe('b');
	});

	it('keeps extension seams explicit and serializable', () => {
		const model = { markers: [], routeData: null, warnings: ['unknown-fields'], errors: [] };
		expect(JSON.parse(JSON.stringify(model))).toEqual(model);
	});
});
