import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SharedLinkRef } from './ref';
import { parseSharedLinkRef } from './ref';

export const VISITED_SHARES_COOKIE = 'pages_visited_shares';
// The visitor's library IS this cookie: Pages is stateless and keeps no other record of which
// shares a browser has opened. A cookie is at most 4,096 bytes, so how many shares a library can
// hold is decided by how few bytes each one costs -- see the packed format below.
export const REGISTRY_MAX_ENTRIES = 50;
export const REGISTRY_MAX_COOKIE_BYTES = 4096;
// Counted from a share's last visit. Long enough that a library of fifty does not thin out
// between visits; 400 days is also the longest cookie lifetime browsers honour.
export const REGISTRY_TTL_MS = 400 * 24 * 60 * 60 * 1000;

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

// Packed plaintext, format 2. The first format was JSON with three 13-digit timestamps per
// entry -- about 240 cookie bytes per share, which is why the library used to stop at 8.
//
//   byte 0            : 2
//   then, per entry, oldest first (position is the order; no sort key is stored):
//     1 byte          : flags -- bit 0 set = slug, bit 1 set = value stored as raw bytes
//     1 byte          : value length in bytes
//     n bytes         : the ref. An Immich share key is base64url, so it is stored as the
//                       bytes it encodes (50 instead of 67) whenever that round-trips exactly
//     4 bytes         : last visit, seconds since the epoch
//
// About 75 cookie bytes per real share key once encrypted and base64url-encoded: fifty fit.
const FORMAT_PACKED = 2;
const FLAG_SLUG = 1;
const FLAG_RAW = 2;

function pack(entries: readonly RegistryEntry[]): Buffer {
	const parts: Buffer[] = [Buffer.from([FORMAT_PACKED])];
	for (const entry of entries) {
		const raw = Buffer.from(entry.value, 'base64url');
		const packable = raw.length > 0 && raw.toString('base64url') === entry.value;
		const value = packable ? raw : Buffer.from(entry.value, 'utf8');
		if (value.length > 255) throw new Error('registry-entry-too-large');
		const seen = Buffer.alloc(4);
		seen.writeUInt32BE(Math.max(0, Math.min(0xffffffff, Math.floor(entry.lastSeenAt / 1000))));
		parts.push(Buffer.from([(entry.kind === 'slug' ? FLAG_SLUG : 0) | (packable ? FLAG_RAW : 0), value.length]), value, seen);
	}
	return Buffer.concat(parts);
}

function unpack(payload: Buffer): RegistryEntry[] | null {
	const entries: RegistryEntry[] = [];
	let offset = 1;
	while (offset < payload.length) {
		if (offset + 2 > payload.length) return null;
		const flags = payload[offset];
		const length = payload[offset + 1];
		if (flags > (FLAG_SLUG | FLAG_RAW) || offset + 2 + length + 4 > payload.length) return null;
		const bytes = payload.subarray(offset + 2, offset + 2 + length);
		const lastSeenAt = payload.readUInt32BE(offset + 2 + length) * 1000;
		offset += 2 + length + 4;
		entries.push({ kind: flags & FLAG_SLUG ? 'slug' : 'key', value: flags & FLAG_RAW ? bytes.toString('base64url') : bytes.toString('utf8'), firstSeenAt: lastSeenAt, lastSeenAt, expiresAt: lastSeenAt + REGISTRY_TTL_MS });
	}
	return entries;
}

function seal(payload: Buffer): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
	return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`;
}

export function encodeRegistry(envelope: RegistryEnvelope): string {
	const value = seal(pack(envelope.entries));
	if (Buffer.byteLength(value) > REGISTRY_MAX_COOKIE_BYTES) throw new Error('registry-too-large');
	return value;
}

/** Entries come back oldest visit first, expired ones removed. */
export function decodeRegistry(value: string | undefined, now = Date.now()): RegistryEnvelope | null {
	if (!value || Buffer.byteLength(value) > REGISTRY_MAX_COOKIE_BYTES) return null;
	try {
		const [ivText, tagText, bodyText] = value.split('.');
		if (!ivText || !tagText || !bodyText) return null;
		const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
		decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
		const payload = Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]);
		let stored: RegistryEntry[];
		if (payload[0] === FORMAT_PACKED) {
			const unpacked = unpack(payload);
			if (!unpacked) return null;
			stored = unpacked;
		} else {
			// The first format, still held by browsers that visited before the change; read once
			// here and rewritten in the packed format by the next registerShare().
			const parsed = JSON.parse(payload.toString()) as { version?: unknown; entries?: unknown };
			if (parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(validEntry)) return null;
			stored = [...(parsed.entries as RegistryEntry[])].sort((a, b) => a.lastSeenAt - b.lastSeenAt || a.firstSeenAt - b.firstSeenAt || refKey(a).localeCompare(refKey(b)));
		}
		if (stored.length > REGISTRY_MAX_ENTRIES || !stored.every(validEntry)) return null;
		const entries = stored.filter((entry) => entry.expiresAt > now);
		if (new Set(entries.map(refKey)).size !== entries.length) return null;
		return { version: 1, entries };
	} catch { return null; }
}

export function registerShare(cookie: string | undefined, ref: SharedLinkRef, now = Date.now()): string {
	const current = decodeRegistry(cookie, now)?.entries ?? [];
	const existing = current.find((entry) => refKey(entry) === refKey(ref));
	const next: RegistryEntry = { kind: ref.kind, value: ref.value, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now, expiresAt: now + REGISTRY_TTL_MS };
	// Oldest first with the share just visited last, so trimming from the front always gives up
	// the least recently visited.
	let entries = [...current.filter((entry) => refKey(entry) !== refKey(ref)), next].slice(-REGISTRY_MAX_ENTRIES);
	let value = seal(pack(entries));
	// Refs may be up to 128 characters; fifty of the longest do not fit one cookie. Keep as many
	// of the most recent as do, rather than failing to record the visit at all.
	while (Buffer.byteLength(value) > REGISTRY_MAX_COOKIE_BYTES && entries.length > 1) {
		entries = entries.slice(1);
		value = seal(pack(entries));
	}
	return value;
}

export function registryCookie(value: string, maxAge = REGISTRY_TTL_MS / 1000): string {
	return `${VISITED_SHARES_COOKIE}=${value}; Path=/; Max-Age=${Math.floor(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}
