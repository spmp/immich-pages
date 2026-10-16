import type { RequestHandler } from './$types';
import { SPIKE_FORMATS, SPIKE_HDR_ENABLED } from '$server/media/spike-hdr-formats';
import { SPIKE_HDR_FIXTURES } from '$server/media/spike-hdr-fixtures';

export const GET: RequestHandler = () => {
	if (!SPIKE_HDR_ENABLED) return new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });

	const sections = Object.entries(SPIKE_HDR_FIXTURES)
		.map(([slug, fixture]) => {
			const synthUnsupported = new Set(['heic-original.heic', 'avif-sdr-p3.avif', 'avif-gainmap-p3.avif']);
			const formats = fixture.synthetic ? SPIKE_FORMATS.filter((format) => !synthUnsupported.has(format.slug)) : SPIKE_FORMATS;
			const items = formats.map((format) => {
				const src = `/spike-hdr-formats/${slug}/${format.slug}`;
				const compareHref = `/spike-hdr-formats/compare/${slug}/${format.slug}`;
				const media = format.tag === 'video' ? `<video src="${src}" controls playsinline muted loop style="max-width:100%"></video>` : `<img src="${src}" alt="${format.slug}" style="max-width:100%" />`;
				const compareLink = format.slug === 'sdr.jpg' ? '' : ` &middot; <a href="${compareHref}">slider compare vs SDR</a>`;
				return `<figure><figcaption><strong>${format.slug}</strong> &mdash; ${format.label}<br><a href="${src}">${src}</a>${compareLink}</figcaption>${media}</figure>`;
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
<p><strong>Synthetic charts:</strong> the <code>chart</code> fixture (spike 003) is left-to-right a no-boost control patch then a 1.5x-6x boost ladder, all pure white -- a flat strip means the gain map was ignored, a graduated one tells you how many steps render. The <code>text</code> fixture (spike 004) is bold "HDR" letters at a fixed 4x boost on flat mid-gray -- no ladder to read, just an abrupt spatial reveal of whether the gain map applied at all. heic-original.heic and avif-hdr/jxl-hdr have no graceful SDR fallback for non-supporting browsers/decoders -- that is itself a finding, not a bug in this page.</p>
<p><strong>Slider compare + tunable gain map (spike 004):</strong> every non-SDR format has a "slider compare vs SDR" link -- drag the divider to A/B against the SDR baseline directly, same image, same viewing conditions. On the real fixtures (ref/alt) the compare page also has <code>headroom</code> and <code>gamma</code> fields: override the Apple-derived boost strength and reshape the gain curve (<code>pow(gainmap, gamma)</code>) live, to hunt for a setting that looks reasonable across every screen you test on. Add <code>?headroom=2.5&amp;gamma=1.5</code> directly to any ref/alt still-image URL to use the same override outside the compare page.</p>
${sections}
</body>
</html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
};
