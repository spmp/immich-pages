import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/lib/components/navigation/${name}.svelte`, 'utf8');

describe('authenticated navigation components', () => {
	it('renders projected entries with safe same-origin links and desktop collapse', () => {
		const page = source('PageNavigation');
		expect(page).toContain('class="collapse"');
		expect(page).toContain("'Collapse journeys'");
		expect(page).toContain("'Expand journeys'");
		expect(page).toContain('NavigationEntry');
		expect(page).toContain('aria-expanded={expanded}');
		expect(page).toContain('aria-current');
		expect(page).toContain('loading="lazy"');
		expect(page).toContain('safeHref');
		expect(page).toContain('safeThumbnail');
		expect(page).toContain('resolve(');
		expect(page).toContain('date.start');
	});

	it('keeps the desktop navigation out of the mobile breakpoint', () => {
		const page = source('PageNavigation');
		expect(page).toContain('@media (max-width: 959px)');
		expect(page).toContain('@media (prefers-reduced-motion: reduce)');
	});
});
