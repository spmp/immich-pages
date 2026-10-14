import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CachedMedia } from './hdr-cache';

// The optional second tier of the HDR media cache (HDR_CACHE_BACKEND=disk): generated HDR
// video/AVIF kept on disk so a restarted Pages serves it without converting again, and so far
// more of it can be kept than fits in memory. It is an optimization only. Pages stays stateless:
// emptying or deleting the directory costs a reconversion, never correctness, and nothing in it
// is authoritative -- every request is still authorized against Immich before any of it is served.
//
// Each entry is two files named by the SHA-256 of its cache key (so a key can never choose a
// path): `<hash>.media` holds the bytes, `<hash>.json` the content type, dimensions, size and
// the full key. Both are written to a temporary name and renamed into place, so a crash leaves
// at worst a stray temporary file, which the next start removes. Anything that does not check
// out -- a size mismatch, a different key, an unexpected type -- is deleted rather than served.

const ALLOWED_TYPES = /^(video\/mp4|image\/avif)$/i;
type Meta = { key: string; contentType: string; bytes: number; width?: number; height?: number; storedAt: number };
type IndexEntry = { name: string; bytes: number };
type Logger = (event: Record<string, unknown>) => void;

export interface HdrDiskCacheOptions {
	directory: string;
	maxBytes: number;
	log?: Logger;
}

export class HdrDiskCache {
	private readonly directory: string;
	private readonly maxBytes: number;
	private readonly log: Logger;
	// key -> entry, in least-recently-used-first order.
	private readonly index = new Map<string, IndexEntry>();
	private totalBytes = 0;
	private available = false;

	constructor(options: HdrDiskCacheOptions) {
		this.directory = options.directory;
		this.maxBytes = options.maxBytes;
		this.log = options.log ?? (() => {});
	}

	private nameFor(key: string): string {
		return createHash('sha256').update(key).digest('hex');
	}

	/** Prepare the directory and index what is already there. False means: run without disk. */
	async init(): Promise<boolean> {
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const probe = join(this.directory, `.probe-${randomBytes(6).toString('hex')}.tmp`);
			await writeFile(probe, '');
			await rm(probe, { force: true });
		} catch (error) {
			this.log({ event: 'direct-share.hdr-disk-cache-unavailable', reason: (error as NodeJS.ErrnoException).code ?? 'unknown' });
			return (this.available = false);
		}
		const names = await readdir(this.directory).catch(() => [] as string[]);
		const found: Array<[string, IndexEntry, number]> = [];
		for (const name of names) {
			if (name.endsWith('.tmp')) { await rm(join(this.directory, name), { force: true }); continue; }
			if (!name.endsWith('.json')) continue;
			const base = name.slice(0, -5);
			const meta = await this.readMeta(base);
			const media = meta ? await stat(join(this.directory, `${base}.media`)).catch(() => undefined) : undefined;
			if (!meta || !media || media.size !== meta.bytes || this.nameFor(meta.key) !== base) { await this.removeFiles(base); continue; }
			found.push([meta.key, { name: base, bytes: meta.bytes }, media.mtimeMs]);
		}
		// Oldest first, so the least recently stored go first if the budget has shrunk.
		// Media files with no metadata beside them are leftovers from an interrupted write.
		for (const name of names) if (name.endsWith('.media') && !names.includes(`${name.slice(0, -6)}.json`)) await rm(join(this.directory, name), { force: true });
		found.sort((a, b) => a[2] - b[2]);
		for (const [key, entry] of found) { this.index.set(key, entry); this.totalBytes += entry.bytes; }
		this.available = true;
		await this.enforceBudget();
		this.log({ event: 'direct-share.hdr-disk-cache-ready', cacheEntries: this.index.size, cacheBytes: this.totalBytes, maxBytes: this.maxBytes });
		return true;
	}

	has(key: string): boolean {
		return this.available && this.index.has(key);
	}

	async read(key: string): Promise<CachedMedia | undefined> {
		const entry = this.available ? this.index.get(key) : undefined;
		if (!entry) return undefined;
		try {
			const meta = await this.readMeta(entry.name);
			const body = await readFile(join(this.directory, `${entry.name}.media`));
			if (!meta || meta.key !== key || body.byteLength !== meta.bytes || !ALLOWED_TYPES.test(meta.contentType)) throw new Error('hdr-disk-entry-invalid');
			this.index.delete(key);
			this.index.set(key, entry);
			return { body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType: meta.contentType, ...(meta.width ? { width: meta.width } : {}), ...(meta.height ? { height: meta.height } : {}) };
		} catch {
			await this.forget(key);
			return undefined;
		}
	}

	async write(key: string, value: CachedMedia): Promise<void> {
		if (!this.available || !(value.body instanceof Uint8Array) || value.body.byteLength === 0 || value.body.byteLength > this.maxBytes || !ALLOWED_TYPES.test(value.contentType)) return;
		const name = this.nameFor(key);
		const meta: Meta = { key, contentType: value.contentType, bytes: value.body.byteLength, ...(value.width ? { width: value.width } : {}), ...(value.height ? { height: value.height } : {}), storedAt: Date.now() };
		const suffix = randomBytes(6).toString('hex');
		try {
			// Media first, metadata last: an entry only exists once its metadata does.
			await writeFile(join(this.directory, `${name}.media.${suffix}.tmp`), value.body, { mode: 0o600 });
			await rename(join(this.directory, `${name}.media.${suffix}.tmp`), join(this.directory, `${name}.media`));
			await writeFile(join(this.directory, `${name}.json.${suffix}.tmp`), JSON.stringify(meta), { mode: 0o600 });
			await rename(join(this.directory, `${name}.json.${suffix}.tmp`), join(this.directory, `${name}.json`));
		} catch (error) {
			await rm(join(this.directory, `${name}.media.${suffix}.tmp`), { force: true });
			await rm(join(this.directory, `${name}.json.${suffix}.tmp`), { force: true });
			this.log({ event: 'direct-share.hdr-disk-cache-write-failed', reason: (error as NodeJS.ErrnoException).code ?? 'unknown' });
			return;
		}
		const previous = this.index.get(key);
		if (previous) { this.totalBytes -= previous.bytes; this.index.delete(key); }
		this.index.set(key, { name, bytes: meta.bytes });
		this.totalBytes += meta.bytes;
		await this.enforceBudget();
	}

	async clear(): Promise<void> {
		for (const key of [...this.index.keys()]) await this.forget(key);
	}

	stats(): { entries: number; bytes: number } {
		return { entries: this.index.size, bytes: this.totalBytes };
	}

	private async enforceBudget(): Promise<void> {
		while (this.totalBytes > this.maxBytes) {
			const oldest = this.index.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			await this.forget(oldest);
			this.log({ event: 'direct-share.hdr-disk-cache-evict', reason: 'capacity', cacheEntries: this.index.size, cacheBytes: this.totalBytes });
		}
	}

	private async forget(key: string): Promise<void> {
		const entry = this.index.get(key);
		if (!entry) return;
		this.index.delete(key);
		this.totalBytes -= entry.bytes;
		await this.removeFiles(entry.name);
	}

	private async removeFiles(name: string): Promise<void> {
		await rm(join(this.directory, `${name}.json`), { force: true });
		await rm(join(this.directory, `${name}.media`), { force: true });
	}

	private async readMeta(name: string): Promise<Meta | undefined> {
		try {
			const meta = JSON.parse(await readFile(join(this.directory, `${name}.json`), 'utf8')) as Partial<Meta>;
			return typeof meta.key === 'string' && typeof meta.contentType === 'string' && typeof meta.bytes === 'number' && Number.isSafeInteger(meta.bytes) && meta.bytes > 0 ? meta as Meta : undefined;
		} catch { return undefined; }
	}
}
