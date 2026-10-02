import type { RequestHandler } from './$types';
import { SPIKE_FORMATS, SPIKE_HDR_ENABLED } from '$server/media/spike-hdr-formats';
import { SPIKE_HDR_FIXTURES } from '$server/media/spike-hdr-fixtures';

export const GET: RequestHandler = () => {
	if (!SPIKE_HDR_ENABLED) return new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });

	const sections = Object.entries(SPIKE_HDR_FIXTURES)
		.map(([slug, fixture]) => {
			const items = SPIKE_FORMATS.map((format) => {
				const src = `/spike-hdr-formats/${slug}/${format.slug}`;
				const media = format.tag === 'video' ? `<video src="${src}" controls playsinline muted loop style="max-width:100%"></video>` : `<img src="${src}" alt="${format.slug}" style="max-width:100%" />`;
				return `<figure><figcaption><strong>${format.slug}</strong> &mdash; ${format.label}<br><a href="${src}">${src}</a></figcaption>${media}</figure>`;
			}).join('\n');
			return `<section><h2>${fixture.label}</h2>${items}</section>`;
		})
		.join('\n');

	const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HDR still-image format spike</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1rem; }
figure { margin: 0 0 2rem; }
figcaption { font-size: 0.85rem; margin-bottom: 0.5rem; }
section { border-top: 2px solid #ccc; padding-top: 1rem; margin-top: 1rem; }
</style>
</head>
<body>
<h1>HDR still-image format spike</h1>
<p>Open this page directly on a real device. On an HDR-capable display, candidates that truly carry HDR should look visibly brighter in highlights than the SDR baseline; candidates that only degrade gracefully should look identical to SDR everywhere else. A broken image/video icon means the browser could not decode it at all.</p>
<p><strong>Not yet attempted in this spike:</strong> Ultra HDR / ISO 21496-1 gain-map JPEG. No apt/apk package ships an encoder for it (checked: Alpine and Debian/Ubuntu repos); producing one would require building Google's <code>libultrahdr</code> from source, which is out of scope here. heic-original.heic and avif-hdr/jxl-hdr have no graceful SDR fallback for non-supporting browsers/decoders -- that is itself a finding, not a bug in this page.</p>
${sections}
</body>
</html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
};
