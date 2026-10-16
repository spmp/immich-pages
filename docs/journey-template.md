# Journey template

The `journey` template is selected with versioned YAML in an Immich album
description. The parser applies the defaults below and ignores unknown fields
with a warning.

## Minimal document

The front matter goes at the very start of the album description, between `---`
lines. The `immich-presentation` key alone is enough:

```yaml
---
immich-presentation:
---
The story of the trip, in Markdown.
```

## All settings

Every key is optional: a bare `immich-presentation:` key is a complete page with
all of these defaults. The sections below explain the larger groups in detail.

| Setting | Default | Notes |
| --- | --- | --- |
| `type` | `journey` | The only template type. |
| `version` | `1` | The only supported document version. |
| `template` | `journal` | The only rendered template; any other value falls back to it with a warning. |
| `hero.filename` | unset | Use the photo with this filename (case-insensitive) as the hero. |
| `hero.assetId` | unset | Use the photo with this Immich asset ID as the hero. |
| `hero.source` | `album-thumbnail` | Accepted but has no effect yet: the hero is always `hero.filename`, else `hero.assetId`, else the album cover, else the first photo. |
| `date` | unset | Show this single date instead of the photos' date range. |
| `dateRange.start` / `dateRange.end` | unset | Show this range instead; either end may be omitted. |
| `gallery.captions` | `{}` | Map of asset ID to caption text (up to 512 characters). |
| `gallery.showCaptions` | `true` | Show the captions above. |
| `gallery.fullWidth` | `[]` | Asset IDs shown across the full width of the gallery. |
| `gallery.sort` | `album` | The only order: Immich's own album order. |
| `gallery.showDates` | `false` | Accepted but has no effect yet. |
| `gradient.auto` | unset (no gradient) | `true` samples the background gradient from the hero photo. |
| `gradient.top` / `gradient.bottom` | unset | Six-digit hex colours for a manual gradient; both required. |
| `gradient.direction` | `to bottom` | `to bottom` or `135deg`. |
| `map.enabled` | `true` | The map is left out automatically when no photo has a location. |
| `map.source` | `auto` | `auto`, `waypoints`, `geojson` or `brouter-web`: see Map settings. |
| `map.url` | unset | BRouter-Web permalink; required for, and only valid with, `source: brouter-web`. |
| `map.waypoints` | unset | `[[longitude, latitude], ...]` (up to 500) for `source: waypoints`. |
| `map.geojson` | unset | A GeoJSON `LineString`/`MultiLineString` as a string (up to 64 KB) for `source: geojson`. |
| `map.styleName` | `quiet-atlas` | The only style name; its URL is set by the deployment, never by the album. |
| `map.markerActivation` | `gallery` | Clicking a marker scrolls to the photo (`gallery`) or opens it (`lightbox`). |
| `map.showMarkerList` | `false` | Also list photo locations as accessible buttons. |
| `map.clustering` | `true` | Group nearby markers. |
| `map.clusterRadius` | `24` | Grouping radius in pixels, `8` to `128`. |
| `map.markerColor` | `#c96b4b` | Photo marker colour. |
| `map.routeColor` | `#c96b4b` | Route line colour. |
| `map.routeWidth` | `3` | Route line width, `1` to `8`. |
| `map.routeStartColor` | `#356859` | Route start dot colour. |
| `map.routeEndColor` | `#c96b4b` | Route end dot colour. |
| `auth.allow.users` | unset | Accepted but has no effect: it belonged to a signed-in library mode that was not released. |

Unknown keys are ignored with a warning; a value that is present but invalid
makes the page show a configuration error rather than guessing.

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

The map is on by default and is simply left out when no photo in the album has
a location. The full set of defaults:

```yaml
map:
  enabled: true
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

### Route sources

* `auto` (default) draws an approximate line through the photos' locations in
  the order they were taken (`localDateTime`, then `createdAt`), skipping points
  within 25 metres of the previous one. It does not call a routing service.
* `brouter-web` draws a real road or trail route from a
  [BRouter-Web](https://brouter.de/brouter-web/) permalink pasted into
  `map.url`. Only `https://brouter.de/brouter-web/` links are accepted, with up
  to 250 waypoints and any length of road; the map view in the link is ignored.
  A long route may appear on the second page load: Pages waits a bounded time,
  finishes the route in the background and caches it.
* `waypoints` draws straight lines through `map.waypoints`, given as
  `[longitude, latitude]` pairs.
* `geojson` draws an exact track from `map.geojson`, a GeoJSON `LineString` or
  `MultiLineString` given as a string.

```yaml
map:
  source: brouter-web
  url: "https://brouter.de/brouter-web/#map=9/33.5/-112.0/standard&lonlats=-111.998,33.435;-117.255,32.736&profile=car-eco"
```

The start and end dots use native circle layers rather than the style's glyphs,
so they work with any deployment map style.

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
`MAP_STYLE_URL_QUIET_ATLAS`, which defaults to OpenFreeMap's `liberty` style.
Album descriptions cannot provide a style URL.
The resolved style must be reachable by visitors and must provide its own
basemap resources, including any tiles, glyphs, and sprites it references.
