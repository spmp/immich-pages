import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { BrouterClient } from '../../src/lib/server/map/brouter-client';
import { parseBrouterWebPermalink } from '../../src/lib/server/map/brouter-web';

describe('BRouter route adapter boundary', () => {
	it('sends only safe route parameters and no visitor credentials', async () => {
		const requests: { url: string; headers: Record<string, unknown> }[] = [];
		const server = createServer((request, response) => {
			requests.push({ url: request.url ?? '', headers: request.headers });
			response.setHeader('content-type', 'application/geo+json');
			response.end(JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }));
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('server did not start');
		const parsed = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=trekking');
		if (parsed.kind !== 'resolved') throw new Error('fixture did not parse');
		const result = await new BrouterClient({ endpoint: `http://127.0.0.1:${address.port}/brouter`, allowedOrigins: [`http://127.0.0.1:${address.port}`], allowLoopbackForTests: true }).resolve(parsed);
		server.close();
		expect(result.kind).toBe('resolved');
		expect(requests[0].url).toContain('profile=trekking');
		expect(requests[0].url).toContain('format=geojson');
		expect(requests[0].headers).not.toHaveProperty('cookie');
		expect(requests[0].headers).not.toHaveProperty('authorization');
	});
});
