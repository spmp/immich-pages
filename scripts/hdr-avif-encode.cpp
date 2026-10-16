// Spike (.planning/spikes/005-avif-gainmap-and-p3-preservation/): encode stage of a two-process
// AVIF gain-map pipeline. Links ONLY libavif; hdr-avif-decode.cpp links ONLY libheif. See that
// file's header comment for why this split exists (architectural consistency with the project's
// existing one-binary-per-concern pattern) and for an important lesson about verifying AVIF
// gain-map output with a decoder matching the encoder's exact libavif version.
//
// Reads the raw stream hdr-avif-decode.cpp writes to stdout:
//   uint32 width, height, gain_width, gain_height (LE; gain_width/height 0 means --mode sdr)
//   sdr_rgba: width*height*4 bytes (uint8 RGBA)
//   if gain_width>0: hdr_rgba: width*height*4 uint16 LE half-floats (RGBA), PQ-encoded at
//     libavif's 203-nits SDR-white convention (see hdr-avif-decode.cpp's pq_encode comment)
//
// Takes --source-profile/--source-transfer directly (same flags as the decode stage) rather than
// threading the derived primaries/transfer through the byte stream, so the two stages stay fully
// independent and neither has to agree on an extra wire format for that.
#include <avif/avif.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

int main(int argc, char** argv) {
  const char* profile = nullptr;
  const char* transfer = nullptr;
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::strcmp(argv[i], "--source-profile") == 0) profile = argv[i + 1];
    if (std::strcmp(argv[i], "--source-transfer") == 0) transfer = argv[i + 1];
  }
  if (!profile || !transfer || (std::strcmp(profile, "display-p3") != 0 && std::strcmp(profile, "rec709") != 0) || (std::strcmp(transfer, "srgb") != 0 && std::strcmp(transfer, "rec709") != 0)) {
    fprintf(stderr, "usage: hdr-avif-encode --source-profile display-p3|rec709 --source-transfer srgb|rec709 (reads hdr-avif-decode's stream on stdin)\n");
    return 2;
  }
  const avifColorPrimaries primaries = std::strcmp(profile, "display-p3") == 0 ? AVIF_COLOR_PRIMARIES_SMPTE432 : AVIF_COLOR_PRIMARIES_BT709;
  const avifTransferCharacteristics base_transfer = std::strcmp(transfer, "rec709") == 0 ? AVIF_TRANSFER_CHARACTERISTICS_BT709 : AVIF_TRANSFER_CHARACTERISTICS_SRGB;

  unsigned char header[16];
  if (fread(header, 1, 16, stdin) != 16) { fprintf(stderr, "truncated stream header\n"); return 1; }
  uint32_t width, height, gain_width, gain_height;
  memcpy(&width, header, 4);
  memcpy(&height, header + 4, 4);
  memcpy(&gain_width, header + 8, 4);
  memcpy(&gain_height, header + 12, 4);
  if (width == 0 || height == 0 || width > 16384 || height > 16384) { fprintf(stderr, "invalid stream dimensions\n"); return 1; }

  std::vector<unsigned char> sdr_rgba(static_cast<size_t>(width) * height * 4);
  if (fread(sdr_rgba.data(), 1, sdr_rgba.size(), stdin) != sdr_rgba.size()) { fprintf(stderr, "truncated sdr stream\n"); return 1; }

  avifImage* image = avifImageCreate(width, height, 8, AVIF_PIXEL_FORMAT_YUV420);
  image->colorPrimaries = primaries;
  image->transferCharacteristics = base_transfer;
  image->matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_BT601;
  image->yuvRange = AVIF_RANGE_FULL;

  avifRGBImage baseRgb;
  avifRGBImageSetDefaults(&baseRgb, image);
  baseRgb.format = AVIF_RGB_FORMAT_RGBA;
  baseRgb.depth = 8;
  baseRgb.pixels = sdr_rgba.data();
  baseRgb.rowBytes = width * 4;
  if (avifImageRGBToYUV(image, &baseRgb) != AVIF_RESULT_OK) { fprintf(stderr, "convert base RGB to YUV failed\n"); return 1; }

  if (gain_width == 0) {
    avifEncoder* encoder = avifEncoderCreate();
    encoder->quality = 90;
    // speed 6 (libavif's rough midpoint) took 15s to encode a single 9-megapixel full-resolution
    // photo -- measured directly, not assumed -- which silently 502'd past the original 8s
    // request timeout for most real photos. speed 9 cuts that to ~2.8s (confirmed on the same
    // input, re-verified correct via avifdec: same P3 primaries, same real gain-map headroom)
    // for a <6% output-size difference -- there's no meaningful quality reason to encode a
    // one-shot photo view this slowly.
    encoder->speed = 9;
    avifRWData output = AVIF_DATA_EMPTY;
    if (avifEncoderAddImage(encoder, image, 1, AVIF_ADD_IMAGE_FLAG_SINGLE) != AVIF_RESULT_OK || avifEncoderFinish(encoder, &output) != AVIF_RESULT_OK) { fprintf(stderr, "encode SDR AVIF failed\n"); return 1; }
    fwrite(output.data, 1, output.size, stdout);
    avifRWDataFree(&output);
    avifEncoderDestroy(encoder);
    avifImageDestroy(image);
    return 0;
  }

  std::vector<unsigned char> hdr_rgba(static_cast<size_t>(width) * height * 4 * sizeof(uint16_t));
  if (fread(hdr_rgba.data(), 1, hdr_rgba.size(), stdin) != hdr_rgba.size()) { fprintf(stderr, "truncated hdr stream\n"); return 1; }

  avifRGBImage altRgb;
  avifRGBImageSetDefaults(&altRgb, image);
  altRgb.depth = 16;
  altRgb.isFloat = AVIF_TRUE;
  altRgb.format = AVIF_RGB_FORMAT_RGBA;
  altRgb.pixels = hdr_rgba.data();
  altRgb.rowBytes = width * 4 * sizeof(uint16_t);

  avifGainMap* gainMap = avifGainMapCreate();
  // gainMap->image must be pre-allocated by the caller (avif.h: "gainMap->image should be
  // initialized with avifImageCreate() ... before calling the computation function") -- reuse the
  // source Apple gain map's own resolution rather than guessing a size.
  gainMap->image = avifImageCreate(gain_width, gain_height, 8, AVIF_PIXEL_FORMAT_YUV400);

  avifDiagnostics diag;
  avifDiagnosticsClearError(&diag);
  // Preserve P3 throughout: the alternate (HDR) representation stays in the same primaries as the
  // base/source image, never converted into a different gamut.
  avifResult gainResult = avifRGBImageComputeGainMap(&baseRgb, primaries, base_transfer, &altRgb, primaries, AVIF_TRANSFER_CHARACTERISTICS_SMPTE2084, gainMap, &diag);
  if (gainResult != AVIF_RESULT_OK) { fprintf(stderr, "compute gain map failed: %s\n", avifResultToString(gainResult)); return 1; }
  image->gainMap = gainMap;

  avifEncoder* encoder = avifEncoderCreate();
  encoder->quality = 90;
  encoder->qualityGainMap = 90;
  // See the SDR-path comment above: speed 6 measured 15s for a single 9-megapixel photo (over
  // the original 8s request timeout for most real photos); speed 9 cuts that to ~2.8s with a
  // confirmed-correct (same P3 primaries, same real gain-map headroom) <6% output-size cost.
  encoder->speed = 9;
  avifRWData output = AVIF_DATA_EMPTY;
  if (avifEncoderAddImage(encoder, image, 1, AVIF_ADD_IMAGE_FLAG_SINGLE) != AVIF_RESULT_OK || avifEncoderFinish(encoder, &output) != AVIF_RESULT_OK) { fprintf(stderr, "encode gain-map AVIF failed\n"); return 1; }
  fwrite(output.data, 1, output.size, stdout);
  avifRWDataFree(&output);
  avifEncoderDestroy(encoder);
  avifImageDestroy(image); // also destroys image->gainMap
  return 0;
}
