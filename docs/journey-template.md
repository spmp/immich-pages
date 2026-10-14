# Journey template

The `journey` template is selected with versioned YAML in an Immich album
description. The parser applies the defaults below and ignores unknown fields
with a warning.

## Minimal document

```yaml
immich-presentation:
  type: journey
  version: 1
```

## Template settings

| Setting | Default | Notes |
| --- | --- | --- |
| `type` | `journey` | Required template type. |
| `version` | `1` | Required supported document version. |
| `template` | `journal` | Current rendered template. |
| `hero.source` | `album-thumbnail` | One of `album-thumbnail`, `primary`, `filename`, or `asset-id`. |
| `hero.filename` | unset | Case-insensitive filename selection when `source: filename`. |
| `hero.assetId` | unset | UUID selection when `source: asset-id`. |
| `date` | unset | Overrides the displayed date with one value. |
| `dateRange.start` | unset | Explicit displayed range start. |
| `dateRange.end` | unset | Explicit displayed range end. |
| `gallery.sort` | `album` | Current gallery order. |
| `gallery.showCaptions` | `true` | Show configured captions. |
| `gallery.showDates` | `false` | Show asset dates. |
| `gallery.captions` | `{}` | UUID-to-caption mapping. |

### Background gradient

Gradients are optional. If `gradient` is omitted, the selected Light/Dark theme
uses its solid background. Automatic image sampling must be enabled explicitly:

```yaml
gradient:
  auto: true
```

Automatic sampling uses the authorized hero thumbnail, samples separate image
regions for the two stops, defaults to `to bottom`, and adjusts the colors for
readable theme text. It falls back to the theme background if the image cannot
be sampled.

For full control, provide two six-digit hex colors. The direction defaults to
`to bottom`:

```yaml
gradient:
  direction: "135deg"
  top: "#102030"
  bottom: "#405060"
```

Supported directions are `to bottom` and `135deg`. Automatic gradients cannot
include `top` or `bottom`; manual gradients require both colors. The gradient
is applied below the opaque hero image across the map, narrative, and gallery.

## Map settings

The map is opt-in. The complete Phase 3 default is:

```yaml
map:
  enabled: false
  source: auto
  styleName: quiet-atlas
  markerActivation: gallery
  showMarkerList: false
  clustering: true
  clusterRadius: 24
  markerColor: "#c96b4b"
  routeColor: "#c96b4b"
  routeWidth: 3
  routeStartColor: "#356859"
  routeEndColor: "#c96b4b"
```

| Setting | Default | Notes |
| --- | --- | --- |
| `map.enabled` | `false` | Must be `true` to render the map chapter. |
| `map.source` | `auto` | Phase 3 supports the chronological approximate route only. |
| `map.styleName` | `quiet-atlas` | Named deployment-owned style; arbitrary style URLs are not accepted. |
| `map.markerActivation` | `gallery` | Marker activation targets the gallery; `lightbox` is also supported. |
| `map.showMarkerList` | `false` | Shows the accessible photo-location button list when enabled. |
| `map.clustering` | `true` | Set `false` to show every permitted marker individually. |
| `map.clusterRadius` | `24` | MapLibre pixel radius; allowed range is `8` to `128`. Lower values produce more individual dots. |
| `map.markerColor` | `#c96b4b` | Six-digit hex color for individual photo markers. |
| `map.routeColor` | `#c96b4b` | Six-digit hex color for the route line. |
| `map.routeWidth` | `3` | Route line width; allowed range is `1` to `8`. |
| `map.routeStartColor` | `#356859` | Six-digit hex color for the route start endpoint. |
| `map.routeEndColor` | `#c96b4b` | Six-digit hex color for the route end endpoint. |

The current start and end endpoints use native circle layers rather than a
style-specific glyph set. This keeps them independent of the deployment map
sprite. Future non-`auto` route sources may use separate endpoint glyphs.

`source: auto` sorts permitted GPS markers by `localDateTime`, then
`createdAt`, removes consecutive points within 25 metres, and draws a bounded
approximate line. It does not call a routing service.

Manual waypoints, exact GeoJSON tracks, and BRouter-Web routes are Phase 4
features and are not currently accepted as route sources.

## Narrative Markdown

Everything after the front matter is the page's narrative: CommonMark plus GitHub-flavoured
Markdown (tables, strikethrough, task lists, autolinks, footnotes). Raw HTML is not rendered,
and links and images must be `https://`.

### LaTeX maths

Maths is always delimited by **double** dollars, so prices like `$20` stay plain text:

- `$$...$$` inside a line is inline: `Average speed was $$\bar{v} = \frac{d}{t}$$ over the day.`
- `$$` on lines of their own is a centred display block, which is where multi-line
  environments go:

```markdown
$$
\begin{align}
d &= 312\,\text{km} \\
t &= 4.5\,\text{h} \\
\bar{v} &\approx 69\,\text{km/h}
\end{align}
$$
```

The syntax is [KaTeX's](https://katex.org/docs/supported): nearly all of LaTeX math mode,
including `align`, `aligned`, `gather`, `alignat`, `cases`, `matrix`/`pmatrix`/`bmatrix` and
`\tag`. It is rendered on the server to MathML and drawn by the browser with the device's own
maths font, so nothing extra is downloaded. Not available: packages, document-level LaTeX,
links and images (`\href`, `\url`, `\includegraphics`), styling commands such as `\htmlStyle`,
and colour. A formula with a mistake in it shows its source instead of breaking the page.

## Deployment-owned style

The `quiet-atlas` name resolves to the deployment variable
`MAP_STYLE_URL_QUIET_ATLAS`. Album descriptions cannot provide a style URL.
The resolved style must be reachable by visitors and must provide its own
basemap resources, including any tiles, glyphs, and sprites it references.
