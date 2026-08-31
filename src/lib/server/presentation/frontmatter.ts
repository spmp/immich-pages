import { parseDocument } from 'yaml';
import { PresentationSchema, type PresentationConfig } from './schema';

export const MAX_DESCRIPTION_BYTES = 64 * 1024;
export const MAX_FRONTMATTER_BYTES = 16 * 1024;
const MAX_LINES = 4096;
const MAX_DEPTH = 8;
const MAX_COLLECTION = 256;

export type FrontmatterReason =
	| 'oversized' | 'missing-closing-delimiter' | 'malformed-frontmatter'
	| 'duplicate-key' | 'alias-not-allowed' | 'non-object-root' | 'resource-limit'
	| 'invalid-schema' | 'unknown-fields' | 'malformed-quoting';

export type FrontmatterOutcome =
	| { kind: 'absent'; markdown: string }
	| { kind: 'unrelated'; markdown: string; unknownKeys: number }
	| { kind: 'valid'; config: PresentationConfig; markdown: string; warnings: string[] }
	| { kind: 'invalid'; markdown: string; reason: FrontmatterReason };

function unknownCount(value: Record<string, unknown>): number {
	const known = new Set(['type', 'version', 'template', 'hero', 'date', 'dateRange', 'map', 'gallery']);
	if (Object.keys(value).some((key) => !known.has(key))) return 1;
	const map = value.map;
	if (map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).some((key) => !new Set(['enabled', 'source', 'styleName', 'markerActivation']).has(key))) return 1;
	return 0;
}

function withinBounds(value: unknown, depth = 0): boolean {
	if (depth > MAX_DEPTH) return false;
	if (Array.isArray(value)) return value.length <= MAX_COLLECTION && value.every((item) => withinBounds(item, depth + 1));
	if (value && typeof value === 'object') {
		const entries = Object.entries(value);
		return entries.length <= MAX_COLLECTION && entries.every(([key, item]) => key.length <= 256 && withinBounds(item, depth + 1));
	}
	return typeof value !== 'string' || value.length <= 8192;
}

export function parsePresentationDocument(description: string | null | undefined): FrontmatterOutcome {
	const source = description ?? '';
	const bytes = new TextEncoder().encode(source).byteLength;
	if (!source || !source.startsWith('---')) return { kind: 'absent', markdown: source };
	if (bytes > MAX_DESCRIPTION_BYTES) return { kind: 'invalid', markdown: '', reason: 'oversized' };
	const lines = source.split(/\r?\n/);
	if (lines.length > MAX_LINES) return { kind: 'invalid', markdown: '', reason: 'resource-limit' };
	if (lines[0] !== '---') return { kind: 'absent', markdown: source };
	const closing = lines.slice(1).findIndex((line) => line === '---');
	if (closing < 0) return { kind: 'invalid', markdown: '', reason: 'missing-closing-delimiter' };
	const yamlText = lines.slice(1, closing + 1).join('\n');
	const markdown = lines.slice(closing + 2).join('\n');
	if (new TextEncoder().encode(yamlText).byteLength > MAX_FRONTMATTER_BYTES) return { kind: 'invalid', markdown, reason: 'oversized' };
	let document;
	try {
		document = parseDocument(yamlText, { schema: 'core', uniqueKeys: true, prettyErrors: false });
	} catch {
		return { kind: 'invalid', markdown, reason: 'malformed-frontmatter' };
	}
	if (document.errors.length || document.warnings.length) {
		const messages = [...document.errors, ...document.warnings].map((item) => item.message.toLowerCase());
		return { kind: 'invalid', markdown, reason: messages.some((message) => message.includes('duplicate') || message.includes('unique')) ? 'duplicate-key' : messages.some((message) => message.includes('quote')) ? 'malformed-quoting' : 'malformed-frontmatter' };
	}
	let value: unknown;
	try { value = document.toJS({ maxAliasCount: 0 }); } catch {
		return { kind: 'invalid', markdown, reason: 'alias-not-allowed' };
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', markdown, reason: 'non-object-root' };
	if (!withinBounds(value)) return { kind: 'invalid', markdown, reason: 'resource-limit' };
	const root = value as Record<string, unknown>;
	const namespace = root['immich-presentation'];
	if (namespace === undefined) return { kind: 'unrelated', markdown, unknownKeys: Object.keys(root).length };
	if (!namespace || typeof namespace !== 'object' || Array.isArray(namespace)) return { kind: 'invalid', markdown, reason: 'invalid-schema' };
	const extra = unknownCount(namespace as Record<string, unknown>);
	const parsed = PresentationSchema.safeParse(namespace);
	if (!parsed.success) return { kind: 'invalid', markdown, reason: 'invalid-schema' };
	return { kind: 'valid', config: parsed.data, markdown, warnings: extra ? ['unknown-fields'] : [] };
}
