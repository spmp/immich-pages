export type PromotedHdrMedia = HTMLImageElement | HTMLVideoElement;
export type HdrMediaRepresentation = 'video' | 'avif';

/**
 * Keeps promoted HDR elements available when PhotoSwipe evicts and recreates a slide.
 * The cache is intentionally instance-scoped by the lightbox rather than global.
 */
export class HdrMediaCache {
	private readonly entries = new Map<string, PromotedHdrMedia>();

	private key(representation: HdrMediaRepresentation, source: string): string {
		return `${representation}:${source}`;
	}

	get(representation: HdrMediaRepresentation, source: string): PromotedHdrMedia | undefined {
		return this.entries.get(this.key(representation, source));
	}

	set(representation: HdrMediaRepresentation, source: string, media: PromotedHdrMedia): void {
		this.entries.set(this.key(representation, source), media);
	}

	clear(): void {
		this.entries.clear();
	}
}
