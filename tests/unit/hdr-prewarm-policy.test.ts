import { describe, expect, it } from 'vitest';
import { parseHdrLookahead, targetLookahead, type HdrProjectionAsset } from '../../src/lib/server/media/hdr-prewarm-policy';

const assets: HdrProjectionAsset[] = [
	{ id: 'a', eligible: false, position: 0, sourceIdentity: 'a' },
	{ id: 'b', eligible: true, position: 1, sourceIdentity: 'b' },
	{ id: 'c', eligible: false, position: 2, sourceIdentity: 'c' },
	{ id: 'd', eligible: true, position: 3, sourceIdentity: 'd' },
	{ id: 'e', eligible: true, position: 4, sourceIdentity: 'e' }
];

describe('HDR prewarm policy', () => {
	it.each([
		[0, 0], ['0', 0], ['all', 'all'], ['3', 3], [3, 3], ['bad', 10], ['101', 10], [1.5, 10]
	])('parses %p', (input, expected) => {
		const result = parseHdrLookahead(input);
		expect(result === 0 ? 0 : result.kind === 'all' ? 'all' : result.value).toBe(expected);
	});

	it('counts eligible assets ahead, not album rows', () => {
		expect(targetLookahead(assets, 0, { kind: 'count', value: 2 }).map((asset) => asset.id)).toEqual(['b', 'd']);
		expect(targetLookahead(assets, 1, { kind: 'count', value: 1 }).map((asset) => asset.id)).toEqual(['d']);
		expect(targetLookahead(assets, 0, { kind: 'all' }).map((asset) => asset.id)).toEqual(['b', 'd', 'e']);
	});

	it('does no automatic work for zero', () => expect(targetLookahead(assets, 0, 0)).toEqual([]));
});
