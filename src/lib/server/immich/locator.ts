import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PURPOSE = 'pages-library-locator-v1';
const MAX_TOKEN = 2048;
const TTL = 24 * 60 * 60 * 1000;
type Payload = { v: 1; kind: 'album'; albumId: string; issuedAt: number; expiresAt: number };
const key = () => { const secret = process.env.PAGES_LOCATOR_SECRET; if (!secret || secret.length < 32) throw new Error('PAGES_LOCATOR_SECRET must be at least 32 characters'); return createHash('sha256').update(secret).digest(); };
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function issueLibraryLocator(albumId: string, now = Date.now()): string {
	if (!uuid.test(albumId)) throw new Error('invalid-album-id');
	const payload: Payload = { v: 1, kind: 'album', albumId, issuedAt: now, expiresAt: now + TTL };
	const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(PURPOSE));
	const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
	const token = `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(body)}`;
	if (token.length > MAX_TOKEN) throw new Error('locator-too-large');
	return token;
}

export function decodeLibraryLocator(token: string | undefined, now = Date.now()): Payload | null {
	if (!token || token.length > MAX_TOKEN) return null;
	try {
		const [iv, tag, body] = token.split('.'); if (!iv || !tag || !body) return null;
		if (![iv, tag, body].every((part) => /^[A-Za-z0-9_-]+$/.test(part) && b64(Buffer.from(part, 'base64url')) === part)) return null;
		const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); decipher.setAAD(Buffer.from(PURPOSE)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
		const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString()) as Partial<Payload>;
		if (parsed.v !== 1 || parsed.kind !== 'album' || typeof parsed.albumId !== 'string' || !uuid.test(parsed.albumId) || typeof parsed.issuedAt !== 'number' || typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.issuedAt) || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now || parsed.expiresAt - parsed.issuedAt > TTL || parsed.issuedAt > now + 60_000) return null;
		return parsed as Payload;
	} catch { return null; }
}
