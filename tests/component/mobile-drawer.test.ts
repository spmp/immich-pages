import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/navigation/MobileDrawer.svelte', 'utf8');

describe('mobile navigation drawer contract', () => {
	it('provides a labelled modal and ordinary same-origin entry links', () => {
		 expect(source).toContain('class="open-drawer"');
		expect(source).toContain('aria-label="Open journeys"');
		expect(source).toContain('<i></i><i></i><i></i>');
		expect(source).toContain('aria-label="Close journey navigation"');
		expect(source).toContain('aria-haspopup="dialog"');
		expect(source).toContain('<dialog open');
		expect(source).toContain('aria-modal="true"');
		expect(source).toContain('aria-labelledby="mobile-navigation-title"');
		expect(source).toContain('resolve(');
		expect(source).toContain('aria-current');
		expect(source).toContain('var(--theme-backdrop)');
		expect(source).toContain('var(--theme-nav-bg)');
	});

	it('keeps the trigger in the hero flow rather than fixing it to the viewport', () => {
		expect(source).toContain('position: absolute');
		expect(source).not.toMatch(/\.open-drawer\s*\{[^}]*position:\s*fixed/);
	});

	it('implements Escape, Tab containment, and return focus', () => {
		expect(source).toContain("event.key === 'Escape'");
		expect(source).toContain("event.key !== 'Tab'");
		expect(source).toContain('event.shiftKey');
		expect(source).toContain('first.focus()');
		expect(source).toContain('last.focus()');
		expect(source).toContain('opener?.focus()');
		expect(source).toContain('prefers-reduced-motion');
		expect(source).toContain('onkeydown={trap}');
	});
});
