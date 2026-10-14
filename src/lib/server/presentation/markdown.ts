import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

// LaTeX maths is rendered here, on the server, by KaTeX -- to MathML ONLY. Browsers draw MathML
// natively, so no KaTeX stylesheet or fonts reach the page, and the sanitizer below admits only
// these presentation-MathML elements and layout attributes: no style, no colour, no links
// (MathML href is not on the list), nothing KaTeX's HTML output would have needed.
const mathTags = ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mlabeledtr'];
const mathLayoutAttributes = ['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'minsize', 'maxsize', 'symmetric', 'largeop', 'movablelimits', 'accent', 'accentunder', 'linethickness', 'scriptlevel', 'displaystyle', 'width', 'height', 'depth', 'voffset', 'notation', 'columnalign', 'columnspacing', 'columnlines', 'rowalign', 'rowspacing', 'rowlines', 'frame', 'framespacing', 'side', 'encoding', 'form'];

const safeSchema: SanitizeSchema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), 'input', ...mathTags],
	attributes: {
		...defaultSchema.attributes,
		input: ['type', 'checked', 'disabled'],
		// KaTeX's wrappers; the only classes allowed, and only these exact values.
		span: [...(defaultSchema.attributes?.span ?? []), ['className', 'katex', 'katex-display', 'katex-error']],
		...Object.fromEntries(mathTags.map((tag) => [tag, mathLayoutAttributes])),
		// The empty columns KaTeX puts either side of an align block, and its equation-number
		// column; JournalNarrative's CSS sizes them, because Chromium ignores columnalign.
		mtd: [...mathLayoutAttributes, ['className', 'mtr-glue', 'mml-eqn-num']]
	},
	protocols: { href: ['https'], src: ['https'] }
};

const katexOptions = {
	output: 'mathml' as const,
	// A typo in one formula shows that formula's source, not a broken narrative.
	throwOnError: false,
	// No \href, \url, \includegraphics, \htmlStyle and friends.
	trust: false,
	strict: 'ignore' as const,
	// Bounds macro expansion, so a hostile description cannot make rendering run away.
	maxExpand: 1000,
	maxSize: 20
};

function safeResourcePolicy() {
	return (tree: any) => {
		const visit = (nodes: typeof tree.children): void => {
			for (const node of nodes ?? []) {
				for (const property of ['href', 'src']) {
					const value = node.properties?.[property];
					if (typeof value === 'string' && !/^https:\/\/[^\s<>]+$/i.test(value)) delete node.properties?.[property];
				}
				visit(node.children as typeof tree.children);
			}
		};
		visit(tree.children);
	};
}

export async function renderMarkdown(markdown: string): Promise<{ html: string; warnings: string[] }> {
	if (new TextEncoder().encode(markdown).byteLength > 128 * 1024 || markdown.length > 100_000) return { html: '<p>Some of this story could not be displayed.</p>', warnings: ['markdown-resource-limit'] };
	try {
		const file = await unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false }).use(remarkRehype, { allowDangerousHtml: false }).use(rehypeKatex, katexOptions).use(safeResourcePolicy).use(rehypeSanitize, safeSchema).use(rehypeStringify).process(markdown);
		return { html: String(file), warnings: [] };
	} catch {
		return { html: '<p>Some of this story could not be displayed.</p>', warnings: ['markdown-degraded'] };
	}
}
