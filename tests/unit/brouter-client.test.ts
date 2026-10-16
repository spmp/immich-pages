import { describe, expect, it } from 'vitest';
import { validateBrouterEndpoint } from '../../src/lib/server/map/brouter-client';

const allowed = ['https://router.example.test/brouter'];
const safeLookup = async () => [{ address: '93.184.216.34', family: 4 as const }];

describe('configured BRouter client policy', () => {
	it('requires an exact configured origin and rejects unsafe endpoint forms', async () => {
		expect((await validateBrouterEndpoint('https://router.example.test/brouter', allowed, safeLookup)).kind).toBe('resolved');
		for (const endpoint of [
			'https://evil.example.test/brouter', 'https://router.example.test/other',
			'https://user:pass@router.example.test/brouter', 'https://router.example.test/brouter?x=1',
			'http://router.example.test/brouter', 'https://127.0.0.1/brouter'
		]) expect((await validateBrouterEndpoint(endpoint, allowed, safeLookup)).kind).toBe('unavailable');
	});

	it('rejects private, unresolved, and mixed DNS answers', async () => {
		const lookup = async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '10.0.0.1', family: 4 as const }];
		const result = await validateBrouterEndpoint('https://router.example.test/brouter', allowed, lookup);
		expect(result).toMatchObject({ kind: 'unavailable', warnings: ['brouter-endpoint-unsafe'] });
	});
});
