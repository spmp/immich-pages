// Spike (.planning/spikes/003-synthetic-hdr-test-chart/): a real photo's Apple gain-map headroom
// is only ~1.8 stops -- too subtle to eyeball, and a flat/no-difference result can't distinguish
// "the boost is genuinely too subtle to notice" from "the decoder silently ignored the gain map
// entirely". This generates a synthetic chart instead: one pure-white control patch (no boost)
// directly beside a ladder of exaggerated, known boost levels, all in the same image under the
// same viewing conditions. A flat chart means the decoder ignored the gain map outright; a
// graduated one tells you exactly how many steps the device/browser actually renders.
//
// Two output modes sharing the same per-pixel boost ladder:
//   --mode ppm      16-bit PQ-encoded PPM, identical output contract to composeHdr() in
//                   hdr-gainmap-compositor.cpp, so it slots into the existing
//                   ppmToPng16/encodeAvifHdr/encodeJxlHdr/encodeHdrMp4 pipeline unchanged.
//   --mode ultrahdr Ultra HDR JPEG directly via libultrahdr, same technique as
//                   hdr-ultrahdr-compositor.cpp (linear HDR intent + sRGB SDR intent, let the
//                   reference encoder compute the gain map).
#include <ultrahdr_api.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>

namespace {
constexpr int kPatchSize = 200;
constexpr std::array<float, 6> kBoosts = {1.0f, 1.5f, 2.0f, 3.0f, 4.0f, 6.0f};
constexpr int kWidth = kPatchSize * static_cast<int>(kBoosts.size());
constexpr int kHeight = kPatchSize;

float boost_for_x(int x) {
  const int patch = std::clamp(x / kPatchSize, 0, static_cast<int>(kBoosts.size()) - 1);
  return kBoosts[static_cast<size_t>(patch)];
}

float pq_encode(float nits) {
  constexpr float m1 = 2610.0f / 16384.0f, m2 = 2523.0f / 32.0f;
  constexpr float c1 = 3424.0f / 4096.0f, c2 = 2413.0f / 128.0f, c3 = 2392.0f / 128.0f;
  const float y = std::clamp(nits / 10000.0f, 0.0f, 1.0f);
  const float ym1 = std::pow(y, m1);
  return std::pow((c1 + c2 * ym1) / (1.0f + c3 * ym1), m2);
}

uint16_t float_to_half(float f) {
  uint32_t bits;
  std::memcpy(&bits, &f, sizeof(bits));
  const uint32_t sign = (bits >> 16) & 0x8000u;
  int32_t exponent = static_cast<int32_t>((bits >> 23) & 0xff) - 127 + 15;
  uint32_t mantissa = bits & 0x7fffffu;
  if (exponent <= 0) {
    if (exponent < -10) return static_cast<uint16_t>(sign);
    mantissa |= 0x800000u;
    const uint32_t shift = static_cast<uint32_t>(14 - exponent);
    uint32_t half_mantissa = mantissa >> shift;
    if ((mantissa >> (shift - 1)) & 1u) half_mantissa += 1u;
    return static_cast<uint16_t>(sign | half_mantissa);
  }
  if (exponent >= 0x1f) return static_cast<uint16_t>(sign | 0x7c00u);
  uint32_t half_mantissa = mantissa >> 13;
  if (mantissa & 0x1000u) {
    half_mantissa += 1u;
    if (half_mantissa == 0x400u) { half_mantissa = 0; exponent += 1; if (exponent >= 0x1f) return static_cast<uint16_t>(sign | 0x7c00u); }
  }
  return static_cast<uint16_t>(sign | (static_cast<uint32_t>(exponent) << 10) | half_mantissa);
}

void check_uhdr(uhdr_error_info_t error, const char* operation) {
  if (error.error_code != UHDR_CODEC_OK) {
    std::cerr << operation << ": " << (error.has_detail ? error.detail : "uhdr encode error") << "\n";
    std::exit(1);
  }
}

void write_ppm() {
  std::vector<uint16_t> output_rgb(static_cast<size_t>(kWidth) * kHeight * 3);
  for (int y = 0; y < kHeight; ++y) for (int x = 0; x < kWidth; ++x) {
    const float boost = boost_for_x(x);
    const uint16_t value = static_cast<uint16_t>(std::round(pq_encode(1.0f * boost * 100.0f) * 65535.0f));
    const size_t offset = (static_cast<size_t>(y) * kWidth + x) * 3;
    output_rgb[offset + 0] = value;
    output_rgb[offset + 1] = value;
    output_rgb[offset + 2] = value;
  }
  std::cout << "P6\n" << kWidth << " " << kHeight << "\n65535\n";
  for (uint16_t value : output_rgb) { std::cout.put(static_cast<char>(value >> 8)); std::cout.put(static_cast<char>(value & 0xff)); }
}

// The SDR baseline for the chart: by definition no gain map, so this is just flat white --
// correctly showing no visible patches is the expected, correct result to contrast against the
// graduated HDR versions, not a bug in this mode.
void write_sdr_ppm() {
  std::cout << "P6\n" << kWidth << " " << kHeight << "\n255\n";
  const std::vector<uint8_t> row(static_cast<size_t>(kWidth) * 3, 255);
  for (int y = 0; y < kHeight; ++y) std::cout.write(reinterpret_cast<const char*>(row.data()), static_cast<std::streamsize>(row.size()));
}

void write_ultrahdr() {
  std::vector<uint16_t> hdr_rgba(static_cast<size_t>(kWidth) * kHeight * 4);
  std::vector<uint8_t> sdr_rgba(static_cast<size_t>(kWidth) * kHeight * 4);
  for (int y = 0; y < kHeight; ++y) for (int x = 0; x < kWidth; ++x) {
    const float boost = boost_for_x(x);
    const uint16_t half = float_to_half(boost); // linear white (1.0) * boost
    const size_t offset = (static_cast<size_t>(y) * kWidth + x) * 4;
    hdr_rgba[offset + 0] = half; hdr_rgba[offset + 1] = half; hdr_rgba[offset + 2] = half; hdr_rgba[offset + 3] = float_to_half(1.0f);
    sdr_rgba[offset + 0] = 255; sdr_rgba[offset + 1] = 255; sdr_rgba[offset + 2] = 255; sdr_rgba[offset + 3] = 255;
  }

  uhdr_raw_image_t hdr_image{};
  hdr_image.fmt = UHDR_IMG_FMT_64bppRGBAHalfFloat;
  hdr_image.cg = UHDR_CG_BT_2100;
  hdr_image.ct = UHDR_CT_LINEAR;
  hdr_image.range = UHDR_CR_FULL_RANGE;
  hdr_image.w = static_cast<unsigned int>(kWidth);
  hdr_image.h = static_cast<unsigned int>(kHeight);
  hdr_image.planes[0] = hdr_rgba.data();
  hdr_image.stride[0] = static_cast<unsigned int>(kWidth);

  uhdr_raw_image_t sdr_image{};
  sdr_image.fmt = UHDR_IMG_FMT_32bppRGBA8888;
  sdr_image.cg = UHDR_CG_BT_709;
  sdr_image.ct = UHDR_CT_SRGB;
  sdr_image.range = UHDR_CR_FULL_RANGE;
  sdr_image.w = static_cast<unsigned int>(kWidth);
  sdr_image.h = static_cast<unsigned int>(kHeight);
  sdr_image.planes[0] = sdr_rgba.data();
  sdr_image.stride[0] = static_cast<unsigned int>(kWidth);

  uhdr_codec_private_t* encoder = uhdr_create_encoder();
  if (!encoder) { std::cerr << "uhdr_create_encoder failed\n"; std::exit(1); }
  check_uhdr(uhdr_enc_set_raw_image(encoder, &hdr_image, UHDR_HDR_IMG), "set HDR raw image");
  check_uhdr(uhdr_enc_set_raw_image(encoder, &sdr_image, UHDR_SDR_IMG), "set SDR raw image");
  check_uhdr(uhdr_enc_set_quality(encoder, 95, UHDR_BASE_IMG), "set base quality");
  check_uhdr(uhdr_enc_set_output_format(encoder, UHDR_CODEC_JPG), "set output format");
  check_uhdr(uhdr_encode(encoder), "encode");
  uhdr_compressed_image_t* output = uhdr_get_encoded_stream(encoder);
  if (!output || !output->data || output->data_sz == 0) { std::cerr << "uhdr_get_encoded_stream returned empty output\n"; std::exit(1); }
  std::cout.write(static_cast<const char*>(output->data), static_cast<std::streamsize>(output->data_sz));
  uhdr_release_encoder(encoder);
}
} // namespace

int main(int argc, char** argv) {
  const char* mode = nullptr;
  for (int i = 1; i + 1 < argc; ++i) if (std::strcmp(argv[i], "--mode") == 0) mode = argv[i + 1];
  if (!mode || (std::strcmp(mode, "ppm") != 0 && std::strcmp(mode, "ultrahdr") != 0 && std::strcmp(mode, "sdr-ppm") != 0)) {
    std::cerr << "usage: hdr-test-chart --mode ppm|ultrahdr|sdr-ppm\n";
    return 2;
  }
  if (std::strcmp(mode, "ppm") == 0) write_ppm();
  else if (std::strcmp(mode, "sdr-ppm") == 0) write_sdr_ppm();
  else write_ultrahdr();
  return std::cout.good() ? 0 : 1;
}
