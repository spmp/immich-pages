export type ResolutionDecision = 'thumbnail' | 'fullsize';
export type TargetResolution = { width: number; height: number; requestedWidth: number; requestedHeight: number; bounded: boolean; aspectRatio: number };

export function requiredWidth(cssWidth: number, dpr: number, dprCap = 2): number {
	const safeCss = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
	const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
	const safeCap = Number.isFinite(dprCap) && dprCap > 0 ? dprCap : 2;
	return Math.ceil(safeCss * Math.min(safeDpr, safeCap));
}

export function chooseResolution(cssWidth: number, intrinsicWidth: number | null | undefined, dpr = 1, dprCap = 2): ResolutionDecision {
	if (!Number.isFinite(intrinsicWidth) || (intrinsicWidth as number) <= 0) return 'thumbnail';
	return (intrinsicWidth as number) >= requiredWidth(cssWidth, dpr, dprCap) ? 'thumbnail' : 'fullsize';
}

/** Select a finite, aspect-preserving HDR representation without upscaling a source. */
export function selectTargetResolution(
	sourceWidth: number | null | undefined,
	sourceHeight: number | null | undefined,
	maxWidth = 8192,
	maxHeight = 8192,
	maxPixels = 33_554_432
): TargetResolution | null {
	if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || (sourceWidth as number) <= 0 || (sourceHeight as number) <= 0) return null;
	const width = Math.floor(sourceWidth as number);
	const height = Math.floor(sourceHeight as number);
	const safeMaxWidth = Math.max(1, Math.min(Math.floor(maxWidth), 8192));
	const safeMaxHeight = Math.max(1, Math.min(Math.floor(maxHeight), 8192));
	const safeMaxPixels = Math.max(1, Math.min(Math.floor(maxPixels), 33_554_432));
	const requestedWidth = width;
	const requestedHeight = height;
	const scale = Math.min(1, safeMaxWidth / width, safeMaxHeight / height, Math.sqrt(safeMaxPixels / (width * height)));
	const targetWidth = Math.max(1, Math.floor(width * scale));
	const targetHeight = Math.max(1, Math.floor(height * scale));
	return { width: targetWidth, height: targetHeight, requestedWidth, requestedHeight, bounded: scale < 1, aspectRatio: width / height };
}
