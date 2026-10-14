import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/server/presentation/markdown';

// LaTeX maths in album narratives, rendered on the server to MathML only: the browser draws it
// natively, so no KaTeX stylesheet or fonts are shipped, and the sanitizer only has to admit
// MathML elements -- never KaTeX's inline styles.
//
// Maths is always delimited by DOUBLE dollars: `$$...$$` inside a line is inline, `$$` on lines
// of their own is a display block. A single `$` stays a plain dollar sign -- travel narratives
// are full of prices, and "$20 each, or $35 for two" must not turn into a formula.
describe('markdown maths', () => {
	it('renders $$...$$ within a line as inline MathML', async () => {
		const { html } = await renderMarkdown('Speed is $$v = \\frac{d}{t}$$ on average.');
		expect(html).toMatch(/<math[^>]*>/);
		expect(html).not.toMatch(/<math[^>]*display="block"/);
		expect(html).toContain('<mfrac>');
		expect(html).toContain('on average.');
	});

	it('renders $$ on lines of their own as a display block', async () => {
		const { html } = await renderMarkdown('$$\nE = mc^2\n$$');
		expect(html).toMatch(/<math[^>]*display="block"/);
		expect(html).toContain('<msup>');
	});

	it('keeps underscores inside maths from turning into emphasis', async () => {
		const { html } = await renderMarkdown('Index $$a_1 + b_1$$ here');
		expect(html).not.toContain('<em>');
		expect(html).toContain('<msub>');
	});

	it('supports multi-line environments: align, aligned, cases and matrices', async () => {
		const { html } = await renderMarkdown([
			'$$\n\\begin{align}\nx &= 1 + 2 \\\\\n  &= 3\n\\end{align}\n$$',
			'$$\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n$$',
			'$$\nf(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}\n$$',
			'$$\n\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n$$'
		].join('\n\n'));
		expect(html.match(/<mtable/g)?.length).toBeGreaterThanOrEqual(4);
		expect(html).toContain('<mtr>');
		expect(html).not.toContain('katex-error');
		// KaTeX centres an align block with empty 'glue' columns either side; the narrative's own
		// CSS needs that one class to size them, since Chromium ignores MathML column attributes.
		expect(html).toContain('class="mtr-glue"');
	});

	it('ships no presentational HTML, styles or classes beyond MathML', async () => {
		const { html } = await renderMarkdown('$$\n\\color{red}{x} + \\htmlStyle{color: red}{y}\n$$\n\nand $$z$$');
		expect(html).not.toMatch(/style=/);
		expect(html).not.toContain('class="katex-html"');
		expect(html).not.toContain('<span class="mord');
	});

	it('cannot be used to smuggle links, scripts or remote resources', async () => {
		const { html } = await renderMarkdown('$$\\href{javascript:alert(1)}{x}$$ $$\\url{https://evil.example}$$ $$\\includegraphics{https://evil.example/x.png}$$ $$<script>alert(1)</script>$$');
		// The formula's own TeX source is kept in <annotation> as plain text (for copy and
		// assistive tech); nothing outside it may carry the payload.
		const rendered = html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
		expect(rendered).not.toContain('javascript:');
		expect(rendered).not.toContain('evil.example');
		expect(html).not.toMatch(/<a\s|href=/);
		expect(html).not.toContain('<script');
	});

	it('shows broken maths as its source text instead of failing the narrative', async () => {
		const result = await renderMarkdown('Before $$\\frac{1}{$$ after');
		expect(result.warnings).not.toContain('markdown-degraded');
		expect(result.html).toContain('Before');
		expect(result.html).toContain('after');
	});

	it('leaves ordinary dollar amounts alone', async () => {
		const { html } = await renderMarkdown('Tickets cost $20 each, or $35 for two.');
		expect(html).not.toContain('<math');
		expect(html).toContain('$20');
	});

	it('treats single dollars as text even when they pair up', async () => {
		const { html } = await renderMarkdown('From $x$ to $y$ costs $5.');
		expect(html).not.toContain('<math');
		expect(html).toContain('$x$');
	});
});
