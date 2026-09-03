import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SharedLinkRef } from './ref';
import { parseSharedLinkRef } from './ref';

export const VISITED_SHARES_COOKIE = 'pages_visited_shares';
export const REGISTRY_MAX_ENTRIES = 8;
export const REGISTRY_MAX_COOKIE_BYTES = 4096;
export const REGISTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RegistryEntry = { kind: 'key' | 'slug'; value: string; firstSeenAt: number; lastSeenAt: number; expiresAt: number };
export type RegistryEnvelope = { version: 1; entries: RegistryEntry[] };

const key = () => {
	const secret = process.env.PAGES_VISITED_SHARES_SECRET;
	if (!secret || secret.length < 32) throw new Error('PAGES_VISITED_SHARES_SECRET must be at least 32 characters');
	return createHash('sha256').update(secret).digest();
};
const b64 = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');
const refKey = (ref: Pick<RegistryEntry, 'kind' | 'value'>) => `${ref.kind}:${ref.value}`;
const validEntry = (value: unknown): value is RegistryEntry => {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return parseSharedLinkRef(entry.kind as string, entry.value as string) !== null
		&& [entry.firstSeenAt, entry.lastSeenAt, entry.expiresAt].every((part) => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0);
};

export function encodeRegistry(envelope: RegistryEnvelope): string {
	const payload = Buffer.from(JSON.stringify(envelope));
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
	const value = `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`;
	if (Buffer.byteLength(value) > REGISTRY_MAX_COOKIE_BYTES) throw new Error('registry-too-large');
	return value;
}

export function decodeRegistry(value: string | undefined, now = Date.now()): RegistryEnvelope | null {
	if (!value || Buffer.byteLength(value) > REGISTRY_MAX_COOKIE_BYTES) return null;
	try {
		const [ivText, tagText, bodyText] = value.split('.');
		if (!ivText || !tagText || !bodyText) return null;
		const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
		decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
		const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString()) as { version?: unknown; entries?: unknown };
		if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > REGISTRY_MAX_ENTRIES || !parsed.entries.every(validEntry)) return null;
		const entries = parsed.entries.filter((entry): entry is RegistryEntry => entry.expiresAt > now);
		if (new Set(entries.map(refKey)).size !== entries.length) return null;
		return { version: 1, entries };
	} catch { return null; }
}

export function registerShare(cookie: string | undefined, ref: SharedLinkRef, now = Date.now()): string {
	const current = decodeRegistry(cookie, now)?.entries ?? [];
	const existing = current.find((entry) => refKey(entry) === refKey(ref));
	const withoutCurrent = current.filter((entry) => refKey(entry) !== refKey(ref));
	const next: RegistryEntry = existing
		? { ...existing, lastSeenAt: now, expiresAt: now + REGISTRY_TTL_MS }
		: { ...ref, firstSeenAt: now, lastSeenAt: now, expiresAt: now + REGISTRY_TTL_MS };
	const entries = [...withoutCurrent, next];
	entries.sort((a, b) => a.lastSeenAt - b.lastSeenAt || a.firstSeenAt - b.firstSeenAt || refKey(a).localeCompare(refKey(b)));
	return encodeRegistry({ version: 1, entries: entries.slice(-REGISTRY_MAX_ENTRIES) });
}

export function registryCookie(value: string, maxAge = REGISTRY_TTL_MS / 1000): string {
	return `${VISITED_SHARES_COOKIE}=${value}; Path=/; Max-Age=${Math.floor(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}
