# Progressive HDR media

HDR is an optional, request-scoped enhancement to the authorized full-size SDR
image. The share and asset membership check completes first; only then does Pages
read the bounded original, inspect metadata, consult the process-local cache, or
start native work. A missing or unsupported contract returns the normal private
unavailable result so the caller keeps its full-size SDR poster and thumbnail/native
anchor.

## Apple gain-map eligibility

The native boundary accepts only an Apple auxiliary image with type
`urn:com:apple:photo:2020:aux:hdrgainmap`, a recognized `HDRGainMapVersion`,
numeric MakerNote keys `33` (`HDRHeadroom`) and `48` (`HDRGain`), orientation `1`,
and a validated Display-P3 or Rec.709 source profile. Unknown profiles, transfer
functions, dimensions, orientation, malformed values, and missing auxiliary
relationships use SDR fallback.

Verified against real ExifTool 13.50 output on real Apple HDR gain-map photos
(not inferred): ExifTool's Apple.pm table names MakerNote `0x21`/`0x30` as
`HDRHeadroom`/`HDRGain` directly, not raw numeric keys `33`/`48` (the raw-key
match is kept only as a defense-in-depth fallback for older ExifTool versions);
`HDRGainMapVersion` prints as the dotted string `0.1.0.0`, never a bare `1`/`1.0`,
and is normalized to the canonical `1.0` the native compositor's `--hdr-version`
contract expects; and the source color profile is only reliably present as
`ICC_Profile:ProfileDescription` (EXIF `ColorSpace`/`ProfileName` report
`Uncalibrated` or are absent for real files). Getting any of this wrong meant
every real photo -- HDR or not -- produced an identical 404.

Apple's documented stop curve is evaluated per image:

```text
if maker33 < 1:
  stops = maker48 <= .01 ? -20 * maker48 + 1.8 : -.101 * maker48 + 1.601
else:
  stops = maker48 <= .01 ? -70 * maker48 + 3.0 : -.303 * maker48 + 2.303
headroom = 2 ^ max(stops, 0)
```

The gain map is resized with normalized bilinear registration, inverse-Rec.709
linearized, and applied per channel as
`hdr = sdr * (1 + (headroom - 1) * gainmap)`. The primary is inverse-transferred
in its declared source space, then the validated source transform is applied and
the result is PQ encoded. The native program emits only an explicit 16-bit
big-endian P6 PPM (`RGB`, `65535` max value); decoded plane dimensions and strides,
not signalled handle dimensions, bound every pixel loop. Portrait and landscape
sources retain their aspect ratio, with a documented 8192-pixel maximum dimension.

## Encoded representation and limits

The fixed native process uses `shell: false`, fixed argv, bounded stdin/stdout and
stderr, and a timeout. FFmpeg consumes exactly one PPM frame and emits fragmented
HEVC Main10 MP4 with `yuv420p10le`, BT.2020 primaries/matrix, and SMPTE ST 2084 PQ.
The representation cache key includes the Apple pipeline version, source profile,
and transfer contract; it is an optimization only and never an authorization
grant. Conversion, decode, timeout, output-limit, and native-tool errors are
logged as allowlisted redacted categories, never raw stderr, credentials, or media.

The browser must retain the SDR candidate until the optional HDR response has
loaded and decoded. `(dynamic-range: high)` and `(color-gamut: p3/rec2020)` are
capability hints only; SDR/unknown clients do not request this route. Physical HDR
correctness is not claimed from container tags, emulation, or browser metadata.
Validate representative portrait and landscape files on a physical HDR-capable
device against Apple Photos or an equivalent trusted reference before making a
production HDR claim.

## Browser state machine and failure evidence

The browser path is monotonic: `thumbnail -> SDR poster -> HDR candidate` is the
only promotion direction. The poster and same-origin thumbnail anchor are rendered
before optional work starts. HDR is exposed to PhotoSwipe only for a client reporting
both high dynamic range and a wide color gamut; a response, usable media decode, and
playback start are required before the candidate is considered usable. A 4xx/5xx
response, timeout, network error, unsupported metadata result, decode failure, or
playback rejection removes the candidate and reloads the SDR poster/thumbnail image.
Ordinary controlled videos do not use this state machine, and JavaScript-disabled
visitors retain the thumbnail anchor.

When `PUBLIC_PAGES_DEBUG=true`, browser diagnostics contain only bounded event names,
allowlisted failure categories (`http`, `network`, `timeout`, `decode`, `playback`,
`unsupported-metadata`), status codes, and durations. They never contain media bytes,
credentials, URLs, upstream response bodies, or asset identifiers. The Chromium mock
matrix covers no-hint gating, HDR hints, HTTP/decode/playback fallback, portrait and
landscape dimensions, request context, and native-anchor behavior. WebKit/Safari
equivalent execution is recorded as unavailable when the runtime cannot launch it;
emulating the hint is not a physical HDR pass.

## Local/container evidence

The production Compose service keeps HDR configuration deployment-owned while
remaining stateless: `HDR_PREWARM_LOOKAHEAD` defaults to `10`,
`HDR_PREWARM_INDICATOR` defaults to `on`, and `HDR_CACHE_BACKEND` is `memory`.
`HDR_CACHE_DIRECTORY` is accepted as future-shaped metadata only; the current
implementation never writes it. The Compose service declares no application
volume, database, media store, or correctness-critical persistent state.

`tests/resources/hdr/` is ignored and must contain operator-supplied local fixtures
only. Acquire them with `scripts/acquire-hdr-fixtures.mjs`, supplying
`--source-dir "$HDR_FIXTURE_SOURCE_DIR"`, the preserved `2.HEIF` reference, and
`--manifest tests/resources/hdr/fixture-manifest.local.json --require-portrait
--require-landscape --min-real-inputs 3`. Each input needs a provenance sidecar
containing `device`, `export`, and a `portrait`/`landscape` role. Screenshots,
synthetic media, generated video, duplicate hashes, and missing provenance are
rejected. The preserved `2.HEIF` SHA-256 is
`07b7199417a540316538a3408af46940ca3deec6e65e38a1e1deebda07e32045`.

`scripts/verify-hdr-container.mjs --fixture-matrix --evidence
docs/phase-8-gate-c-hdr-evidence.md` builds the production image, mounts local
media read-only, runs the compiled compositor and FFmpeg, probes frame 0, and
writes only redacted textual source/output hashes, dimensions/aspect ratios,
durations, byte sizes, pixel assertions, tool versions, and fallback categories
to the evidence record. `scripts/hdr-fixture-matrix.mjs` requires the
reference plus the complete portrait/landscape matrix and records missing gain map,
missing version, malformed MakerNote, unsupported profile, oversized input, timeout,
and FFmpeg failure as SDR fallback. `scripts/verify-docker-fixture-content.mjs`
inspects the runtime image and probes the generated build context; local fixture
paths and reference artifacts must be absent. Docker or missing local fixtures are blocking operator
prerequisites, not passes.

The real Traefik-backed browser command is `npm run test:e2e`; it exercises the
Pages host, forwarded share context, private media responses, and same-origin
fallback assertions. If Docker is unavailable, its result is unavailable evidence,
not a proxy pass. The deterministic mock command is
`npm run test:e2e:mock -- fullsize-media.mock.spec.ts`.

No fixture bytes, provenance secrets, or generated evidence belong in git. The
manifest and outputs are local-only and ignored. Container metadata and decoded
pixel evidence do not establish physical HDR correctness: physical viewing on an
HDR-capable device against Apple Photos or an equivalent trusted reference remains
required before making an HDR claim. The release record is intentionally
`PENDING`/`SDR-only` when Docker, the local matrix, or physical device evidence
is unavailable; an automated PASS without physical HDR and forced-SDR rows is
rejected by `tests/contracts/phase-8-hdr-release.test.ts`.

The historical `2.HEIF -> 4.mp4` pair remains a diagnostic reference, not physical
HDR acceptance evidence. The final release gate still requires human review on an
HDR-capable device; this plan does not claim that validation.
