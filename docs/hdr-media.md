# Progressive HDR media

HDR is an optional, request-scoped enhancement to the authorized full-size SDR
image. The share and asset membership check completes first; only then does Pages
read the bounded original, inspect metadata, consult the process-local cache, or
start native work. A missing or unsupported contract returns the normal private
unavailable result so the caller keeps its full-size SDR poster and thumbnail/native
anchor.

## Apple gain-map eligibility

The native boundary accepts only an Apple auxiliary image with type
`urn:com:apple:photo:2020:aux:hdrgainmap`, `HDRGainMapVersion` `1`/`1.0`, numeric
MakerNote keys `33` (`HDRHeadroom`) and `48` (`HDRGain`), orientation `1`, and a
validated Display-P3 or Rec.709 source profile. Friendly aliases alone are not
accepted. Unknown profiles, transfer functions, dimensions, orientation, malformed
values, and missing auxiliary relationships use SDR fallback.

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

## Local/container evidence

`tests/resources/hdr/` is ignored and must contain operator-supplied local fixtures
only. `scripts/verify-hdr-native.mjs --docker` builds the production image, mounts
the source fixture read-only, runs the compiled compositor and FFmpeg entrypoint,
probes the output, and writes redacted hashes/tool versions to a temporary evidence
directory. Missing fixtures fail closed. No fixture bytes are copied into the image
or tracked in git.

The historical `2.HEIF -> 4.mp4` pair remains a diagnostic reference, not physical
HDR acceptance evidence. The final release gate still requires human review on an
HDR-capable device; this plan does not claim that validation.
