import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SharedLinkRef } from './ref';

export const PAGES_SESSION_COOKIE = 'pages_share_session';
const MAX_ENTRIES = 8;
const MAX_COOKIE_BYTES = 4096;
const MAX_TOKEN_BYTES = 2048;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type SessionEntry = { ref: string; token: string; issuedAt: number; lastUsedAt: number; expiresAt: number };
type SessionEnvelope = { version: 1; entries: SessionEntry[] };

function key(): Buffer {
	const secret = process.env.PAGES_SESSION_SECRET;
	if (!secret || secret.length < 32) throw new Error('PAGES_SESSION_SECRET must be at least 32 characters');
	return createHash('sha256').update(secret).digest();
}

const refKey = (ref: SharedLinkRef) => `${ref.kind}:${ref.value}`;
const b64 = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');

export function extractImmichShareToken(cookie: string | null): string | null {
	const match = cookie?.match(/(?:^|;\s*)immich_shared_link_token=([^;\s]+)/);
	return match?.[1] && Buffer.byteLength(match[1]) <= MAX_TOKEN_BYTES ? match[1] : null;
}

export function encodeSession(entries: SessionEntry[]): string {
	const payload = Buffer.from(JSON.stringify({ version: 1, entries: entries.slice(0, MAX_ENTRIES) } satisfies SessionEnvelope));
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
	const value = `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`;
	if (Buffer.byteLength(value) > MAX_COOKIE_BYTES) throw new Error('session-too-large');
	return value;
}

export function decodeSession(value: string | undefined): SessionEnvelope | null {
	if (!value || Buffer.byteLength(value) > MAX_COOKIE_BYTES) return null;
	try {
		const [ivText, tagText, bodyText] = value.split('.');
		if (!ivText || !tagText || !bodyText) return null;
		const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
		decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
		const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString()) as { version?: unknown; entries?: unknown };
		if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) return null;
		const entries = parsed.entries.filter((entry: unknown): entry is SessionEntry => {
			if (!entry || typeof entry !== 'object') return false;
			const candidate = entry as Record<string, unknown>;
			return typeof candidate.ref === 'string' && /^(key|slug):[^:]{1,512}$/.test(candidate.ref) && typeof candidate.token === 'string' && Buffer.byteLength(candidate.token) <= MAX_TOKEN_BYTES && [candidate.issuedAt, candidate.lastUsedAt, candidate.expiresAt].every((part) => typeof part === 'number' && Number.isFinite(part));
		});
		return entries.length === parsed.entries.length ? { version: 1, entries } : null;
	} catch { return null; }
}

export function sessionCookie(value: string, maxAge = SESSION_TTL_MS / 1000): string {
	return `${PAGES_SESSION_COOKIE}=${value}; Path=/; Max-Age=${Math.floor(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
	return `${PAGES_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionForShare(cookie: string | undefined, ref: SharedLinkRef, now = Date.now()): { token: string | null; cookie?: string } {
	const decoded = decodeSession(cookie);
	if (!decoded) return { token: null };
	const valid = decoded.entries.filter((entry) => entry.expiresAt > now);
	const current = valid.find((entry) => entry.ref === refKey(ref));
	if (!current) return { token: null, cookie: valid.length ? sessionCookie(encodeSession(valid)) : clearSessionCookie() };
	const touched = valid.map((entry) => entry.ref === current.ref ? { ...entry, lastUsedAt: now } : entry);
	return { token: current.token, cookie: sessionCookie(encodeSession(touched)) };
}

export function addSession(cookie: string | undefined, ref: SharedLinkRef, token: string, now = Date.now()): string {
	if (!token || Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw new Error('invalid-session-token');
	const existing = decodeSession(cookie)?.entries.filter((entry) => entry.expiresAt > now) ?? [];
	const withoutCurrent = existing.filter((entry) => entry.ref !== refKey(ref));
	if (withoutCurrent.length >= MAX_ENTRIES) withoutCurrent.sort((a, b) => b.lastUsedAt - a.lastUsedAt).pop();
	return encodeSession([...withoutCurrent, { ref: refKey(ref), token, issuedAt: now, lastUsedAt: now, expiresAt: now + SESSION_TTL_MS }]);
}

/** Drop the saved access for one share. Null when nothing is left, so the caller can clear the cookie. */
export function removeSession(cookie: string | undefined, ref: SharedLinkRef, now = Date.now()): string | null {
	const remaining = decodeSession(cookie)?.entries.filter((entry) => entry.expiresAt > now && entry.ref !== refKey(ref)) ?? [];
	return remaining.length ? encodeSession(remaining) : null;
}

export const sessionRef = refKey;
