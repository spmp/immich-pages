import type { RequestHandler } from './$types';
import { SPIKE_FORMATS, SPIKE_HDR_ENABLED, type SpikeFormatSlug } from '$server/media/spike-hdr-formats';
import { isSpikeFixtureSlug } from '$server/media/spike-hdr-fixtures';

const FORMATS = new Map(SPIKE_FORMATS.map((format) => [format.slug, format]));
function isFormatSlug(value: string): value is SpikeFormatSlug { return FORMATS.has(value as SpikeFormatSlug); }

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export const GET: RequestHandler = ({ params, url }) => {
	if (!SPIKE_HDR_ENABLED) return new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });
	if (!isSpikeFixtureSlug(params.fixture) || !isFormatSlug(params.format)) return new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });

	const format = FORMATS.get(params.format)!;
	const headroom = url.searchParams.get('headroom') ?? '';
	const gamma = url.searchParams.get('gamma') ?? '';
	const query = new URLSearchParams();
	if (headroom) query.set('headroom', headroom);
	if (gamma) query.set('gamma', gamma);
	const queryString = query.toString() ? `?${query.toString()}` : '';
	const sdrSrc = `/spike-hdr-formats/${params.fixture}/sdr.jpg`;
	const candidateSrc = `/spike-hdr-formats/${params.fixture}/${params.format}${queryString}`;
	const isVideo = format.tag === 'video';

	const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Compare: ${escapeHtml(params.fixture)} / ${escapeHtml(params.format)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1rem; }
.controls { margin-bottom: 1rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: end; }
.controls label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 0.25rem; }
.controls input { font-size: 1rem; width: 6rem; }
.controls button { font-size: 1rem; padding: 0.4rem 0.8rem; }
.compare { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }
.pane { flex: 1 1 0; min-width: 0; max-width: calc(50% - 0.25rem); }
.pane img, .pane video { display: block; width: 100%; height: auto; }
.pane figcaption { font-size: 0.85rem; margin-bottom: 0.25rem; font-weight: bold; }
p.note { font-size: 0.85rem; color: #555; }
</style>
</head>
<body>
<p><a href="/spike-hdr-formats">&larr; back to full comparison page</a></p>
<h1>Compare: sdr.jpg vs ${escapeHtml(params.format)} (${escapeHtml(params.fixture)})</h1>
<p class="note">Left: SDR baseline. Right: ${escapeHtml(format.label)}. On an HDR-capable display, the right side should look visibly brighter/richer in highlights than the left if the gain map is honored.</p>
<form class="controls" id="overrides">
<label>Headroom override <input type="number" name="headroom" step="0.1" min="1" max="16" value="${escapeHtml(headroom)}" placeholder="auto" /></label>
<label>Gain gamma <input type="number" name="gamma" step="0.1" min="0.1" max="10" value="${escapeHtml(gamma)}" placeholder="1.0" /></label>
<button type="submit">Apply &amp; re-encode</button>
</form>
<div class="compare">
	<figure class="pane"><figcaption>SDR</figcaption><img src="${sdrSrc}" alt="sdr" /></figure>
	<figure class="pane"><figcaption>${escapeHtml(params.format)}</figcaption>${isVideo ? `<video src="${candidateSrc}" controls autoplay playsinline muted loop></video>` : `<img src="${candidateSrc}" alt="${escapeHtml(params.format)}" />`}</figure>
</div>
<script>
document.getElementById('overrides').addEventListener('submit', function (e) {
	e.preventDefault();
	var form = new FormData(e.target);
	var params = new URLSearchParams();
	var headroom = form.get('headroom');
	var gamma = form.get('gamma');
	if (headroom) params.set('headroom', headroom);
	if (gamma) params.set('gamma', gamma);
	window.location.search = params.toString();
});
</script>
</body>
</html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
};
