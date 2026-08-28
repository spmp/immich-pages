import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const safeSchema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
	attributes: { ...defaultSchema.attributes, input: ['type', 'checked', 'disabled'] },
	protocols: { href: ['https'], src: ['https'] }
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
		const file = await unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: false }).use(safeResourcePolicy).use(rehypeSanitize, safeSchema).use(rehypeStringify).process(markdown);
		return { html: String(file), warnings: [] };
	} catch {
		return { html: '<p>Some of this story could not be displayed.</p>', warnings: ['markdown-degraded'] };
	}
}
