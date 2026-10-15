import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const required = ['IMMICH_BASE_URL', 'PAGES_SESSION_SECRET', 'PAGES_VISITED_SHARES_SECRET'];

/**
 * V1 deploys with exactly three settings: where Immich is, and the two cookie secrets.
 * Everything else has a working default -- in the code, or baked into the image.
 */
describe('V1 minimal configuration', () => {
	it('bakes the listen address and reverse-proxy headers into the image', () => {
		const dockerfile = read('Dockerfile');
		for (const setting of ['HOST=0.0.0.0', 'PORT=3000', 'PROTOCOL_HEADER=X-Forwarded-Proto', 'HOST_HEADER=X-Forwarded-Host']) expect(dockerfile).toContain(setting);
	});

	it.each(['compose.yaml', 'docker-compose.yml'])('%s requires only the three V1 settings for Pages', (file) => {
		const service = read(file).split(/\n {2}pages:\n/)[1]?.split(/\n {2}\S/)[0] ?? '';
		// The application's own settings only: Traefik labels may need stack-level values such as
		// the public hostname, which are not Pages configuration.
		const pages = service.split(/\n {4}environment:\n/)[1]?.split(/\n {4}\S/)[0] ?? '';
		const mandatory = [...pages.matchAll(/\$\{(\w+):\?/g)].map((match) => match[1]);
		// docker-compose.yml is the combined Immich + Pages example, which derives the Immich URL
		// from the stack's own IMMICH_HOST; compose.yaml (Pages alone) asks for it directly.
		expect(mandatory.every((name) => required.includes(name))).toBe(true);
		expect(mandatory).toEqual(expect.arrayContaining(['PAGES_SESSION_SECRET', 'PAGES_VISITED_SHARES_SECRET']));
		expect(pages).toMatch(/IMMICH_BASE_URL:/);
		for (const baked of ['HOST:', 'PORT:', 'PROTOCOL_HEADER:', 'HOST_HEADER:']) expect(pages).not.toMatch(new RegExp(`^\\s+${baked}`, 'm'));
	});

	it('has no leftover locator secret: the signed-in library mode it belonged to never shipped', () => {
		expect(existsSync('src/lib/server/immich/locator.ts')).toBe(false);
		expect(existsSync('src/routes/library/page')).toBe(false);
		expect(read('docs/deployment.md')).not.toContain('PAGES_LOCATOR_SECRET');
		for (const name of required) expect(read('docs/deployment.md')).toContain(name);
	});
});
