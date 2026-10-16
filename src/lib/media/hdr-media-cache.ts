export type PromotedHdrMedia = HTMLImageElement | HTMLVideoElement;
export type HdrMediaRepresentation = 'video' | 'avif';

export interface HdrMediaCacheOptions {
	/** How many promoted elements may be kept once no slide is using them. Default 0. */
	maxIdle?: number;
	/** Free whatever the element holds (decoder, decoded frames). Called once, on the way out. */
	release?(media: PromotedHdrMedia): void;
}

interface Entry {
	media: PromotedHdrMedia;
	/** Slides currently holding this element. */
	uses: number;
	/** Order in which it last became idle; undefined while in use. */
	idleOrder?: number;
}

/**
 * Keeps promoted HDR elements available when PhotoSwipe evicts and recreates a slide.
 * The cache is intentionally instance-scoped by the lightbox rather than global.
 *
 * It is also the only thing keeping those elements alive once PhotoSwipe has let a slide go, so
 * it is what has to bound them. Unbounded, a phone ended up holding one loaded HEVC video per
 * photo viewed until the OS took decoders away (slides painting black) and then killed the tab
 * -- see .planning/debug/lightbox-mobile-crash.md. Elements a slide is using are never touched;
 * only ones nothing is showing count against `maxIdle`, oldest released first.
 */
export class HdrMediaCache {
	private readonly entries = new Map<string, Entry>();
	private readonly maxIdle: number;
	private readonly release: (media: PromotedHdrMedia) => void;
	private idleClock = 0;

	constructor(options: HdrMediaCacheOptions = {}) {
		this.maxIdle = Math.max(0, options.maxIdle ?? 0);
		this.release = options.release ?? (() => {});
	}

	private key(representation: HdrMediaRepresentation, source: string): string {
		return `${representation}:${source}`;
	}

	/** Take the element for a slide. The slide must hand it back with `idle` when it goes away. */
	get(representation: HdrMediaRepresentation, source: string): PromotedHdrMedia | undefined {
		const entry = this.entries.get(this.key(representation, source));
		if (!entry) return undefined;
		entry.uses += 1;
		entry.idleOrder = undefined;
		return entry.media;
	}

	/** Store a newly promoted element, in use by the slide that promoted it. */
	set(representation: HdrMediaRepresentation, source: string, media: PromotedHdrMedia): void {
		const key = this.key(representation, source);
		const previous = this.entries.get(key);
		if (previous && previous.media !== media) this.release(previous.media);
		this.entries.set(key, { media, uses: 1 });
	}

	/** A slide that was using this element is gone. Releases the oldest idle ones over the limit. */
	idle(media: PromotedHdrMedia): void {
		for (const entry of this.entries.values()) {
			if (entry.media !== media) continue;
			entry.uses = Math.max(0, entry.uses - 1);
			if (entry.uses === 0) entry.idleOrder = (this.idleClock += 1);
			break;
		}
		const idle = Array.from(this.entries).filter(([, entry]) => entry.idleOrder !== undefined).sort(([, a], [, b]) => a.idleOrder! - b.idleOrder!);
		for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - this.maxIdle))) {
			this.entries.delete(key);
			this.release(entry.media);
		}
	}

	/** Everything currently kept alive, for the lightbox's memory-footprint diagnostics. */
	values(): PromotedHdrMedia[] {
		return Array.from(this.entries.values(), (entry) => entry.media);
	}

	/** Release and forget everything, in use or not. */
	clear(): void {
		const held = this.values();
		this.entries.clear();
		for (const media of held) this.release(media);
	}
}
