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
.compare { position: relative; max-width: 100%; width: 100%; touch-action: none; user-select: none; overflow: hidden; line-height: 0; }
.compare img, .compare video { display: block; width: 100%; height: auto; }
.compare .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; clip-path: inset(0 50% 0 0); }
.compare .overlay img, .compare .overlay video { width: 100%; height: 100%; object-fit: contain; }
.divider { position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; background: #fff; box-shadow: 0 0 4px rgba(0,0,0,0.8); cursor: ew-resize; transform: translateX(-50%); }
.divider::after { content: ''; position: absolute; top: 50%; left: 50%; width: 32px; height: 32px; border-radius: 50%; background: #fff; box-shadow: 0 0 4px rgba(0,0,0,0.8); transform: translate(-50%, -50%); }
p.note { font-size: 0.85rem; color: #555; }
</style>
</head>
<body>
<p><a href="/spike-hdr-formats">&larr; back to full comparison page</a></p>
<h1>Compare: sdr.jpg vs ${escapeHtml(params.format)} (${escapeHtml(params.fixture)})</h1>
<p class="note">Left side of the divider: SDR baseline. Right side: ${escapeHtml(format.label)}. Drag the divider on an HDR-capable display -- if the gain map is honored, the right side should look visibly brighter/richer than the left in highlights.</p>
<form class="controls" id="overrides">
<label>Headroom override <input type="number" name="headroom" step="0.1" min="1" max="16" value="${escapeHtml(headroom)}" placeholder="auto" /></label>
<label>Gain gamma <input type="number" name="gamma" step="0.1" min="0.1" max="10" value="${escapeHtml(gamma)}" placeholder="1.0" /></label>
<button type="submit">Apply &amp; re-encode</button>
</form>
<div class="compare" id="compare">
	<img src="${sdrSrc}" alt="sdr" />
	<div class="overlay" id="overlay">
		${isVideo ? `<video src="${candidateSrc}" controls autoplay playsinline muted loop></video>` : `<img src="${candidateSrc}" alt="${escapeHtml(params.format)}" />`}
	</div>
	<div class="divider" id="divider"></div>
</div>
<script>
(function () {
	var compare = document.getElementById('compare');
	var overlay = document.getElementById('overlay');
	var divider = document.getElementById('divider');
	var dragging = false;
	function setPosition(clientX) {
		var rect = compare.getBoundingClientRect();
		var pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
		overlay.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
		divider.style.left = pct + '%';
	}
	compare.addEventListener('pointerdown', function (e) { dragging = true; setPosition(e.clientX); compare.setPointerCapture(e.pointerId); });
	compare.addEventListener('pointermove', function (e) { if (dragging) setPosition(e.clientX); });
	compare.addEventListener('pointerup', function () { dragging = false; });
	compare.addEventListener('pointercancel', function () { dragging = false; });

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
})();
</script>
</body>
</html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
};
