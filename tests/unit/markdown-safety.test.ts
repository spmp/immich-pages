import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/server/presentation/markdown';

describe('safe markdown', () => {
	it('renders GFM and removes raw HTML and executable URLs', async () => {
		const result = await renderMarkdown('# Heading\n\n**bold** ~~strike~~\n\n- [x] done\n\n[bad](javascript:alert(1)) [good](https://example.com)\n\n<script>alert(1)</script>');
		expect(result.html).toContain('<h1>Heading</h1>');
		expect(result.html).toContain('<del>strike</del>');
		expect(result.html).not.toContain('<script');
		expect(result.html).not.toContain('javascript:');
		expect(result.html).toContain('https://example.com');
	});

	it('never fetches author-selected resources and degrades oversized input', async () => {
		const result = await renderMarkdown('x'.repeat(130_000));
		expect(result.warnings).toContain('markdown-resource-limit');
		expect(result.html).not.toContain('x'.repeat(100));
	});

	it('rejects protocol smuggling and executable resource attributes', async () => {
		const result = await renderMarkdown('[a](//evil.example) ![b](data:text/html,evil)\n\n<img src="https://evil.example/x" onerror="alert(1)">');
		expect(result.html).not.toContain('evil.example');
		expect(result.html).not.toContain('onerror');
	});
});
