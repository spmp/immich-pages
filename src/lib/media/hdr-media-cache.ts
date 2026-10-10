export type PromotedHdrMedia = HTMLImageElement | HTMLVideoElement;

/**
 * Keeps promoted HDR elements available when PhotoSwipe evicts and recreates a slide.
 * The cache is intentionally instance-scoped by the lightbox rather than global.
 */
export class HdrMediaCache {
	private readonly entries = new Map<string, PromotedHdrMedia>();

	get(source: string): PromotedHdrMedia | undefined {
		return this.entries.get(source);
	}

	set(source: string, media: PromotedHdrMedia): void {
		this.entries.set(source, media);
	}

	clear(): void {
		this.entries.clear();
	}
}
