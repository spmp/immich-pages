export type JustifiedAsset = { id: string; width?: number | null; height?: number | null; fullWidth?: boolean };
export type JustifiedItem<T extends JustifiedAsset = JustifiedAsset> = T & { layoutWidth: number; layoutHeight: number };
export type JustifiedRow<T extends JustifiedAsset = JustifiedAsset> = { fullWidth: boolean; height: number; items: JustifiedItem<T>[] };
const FALLBACK_RATIO = 16 / 9;
function ratio(asset: JustifiedAsset) { const width = Number(asset.width); const height = Number(asset.height); return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width / height : FALLBACK_RATIO; }
function makeRow<T extends JustifiedAsset>(assets: T[], availableWidth: number, gap: number, targetHeight: number, fill: boolean): JustifiedRow<T> {
	const totalRatio = assets.reduce((sum, asset) => sum + ratio(asset), 0);
	const computedHeight = (availableWidth - gap * Math.max(0, assets.length - 1)) / totalRatio;
	const height = fill ? computedHeight : Math.min(targetHeight, computedHeight);
	return { fullWidth: false, height, items: assets.map((asset) => ({ ...asset, layoutHeight: height, layoutWidth: ratio(asset) * height })) };
}
/** Calculate deterministic justified rows without reading browser-only layout state. */
export function calculateJustifiedRows<T extends JustifiedAsset>(assets: T[], availableWidth: number, options: { gap?: number; targetRowHeight?: number; maxItemsPerRow?: number } = {}): JustifiedRow<T>[] {
	const width = Math.max(1, Math.round(availableWidth));
	const gap = options.gap ?? 16; const targetHeight = options.targetRowHeight ?? 240; const maxItems = options.maxItemsPerRow ?? 5;
	const rows: JustifiedRow<T>[] = []; let pending: T[] = [];
	const flush = (fill: boolean) => { if (pending.length) rows.push(makeRow(pending, width, gap, targetHeight, fill)); pending = []; };
	for (const asset of assets) {
		if (asset.fullWidth) { flush(true); const height = width / ratio(asset); rows.push({ fullWidth: true, height, items: [{ ...asset, layoutWidth: width, layoutHeight: height }] }); continue; }
		pending.push(asset); const candidate = makeRow(pending, width, gap, targetHeight, true);
		if (pending.length > 1 && (candidate.height <= targetHeight || pending.length >= maxItems)) flush(true);
	}
	flush(false); return rows;
}
