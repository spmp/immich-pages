export type ResolutionDecision = 'thumbnail' | 'fullsize';

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
