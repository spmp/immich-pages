// Spike (.planning/spikes/005-avif-gainmap-and-p3-preservation/): decode stage of a two-process
// AVIF gain-map pipeline. Links ONLY libheif; hdr-avif-encode.cpp links ONLY libavif.
//
// This split exists for the same reason composeHdr/encodeHdrMp4 are already two separate spawned
// binaries in hdr-compositor.ts (one native contract per concern), NOT because of a confirmed bug
// in linking libheif and libavif together. An apparent "degenerate zero headroom" was chased at
// length and looked exactly like a link-time symbol collision between the two libraries -- it
// wasn't: the real cause was verifying output with the host dev machine's avifdec (Ubuntu
// libavif 1.3.0), which cannot correctly read gain-map headroom metadata written by the actual
// runtime's Alpine libavif 1.4.1. Every file that looked "broken" decoded correctly once checked
// with a matching 1.4.1 avifdec. Lesson: always verify AVIF gain-map output with a decoder from
// the SAME libavif version as the encoder, never whatever happens to be on the dev host.
//
// Outputs a small raw stream to stdout for hdr-avif-encode.cpp to consume:
//   uint32 output_width, output_height (LE)
//   uint32 gain_width, gain_height (0,0 for --mode sdr)
//   sdr_rgba: output_width*output_height*4 bytes (uint8 RGBA)
//   if gainmap: hdr_rgba: output_width*output_height*4 uint16 LE half-floats (RGBA), PQ-encoded
//     at libavif's own 203-nits SDR-white convention (see pq_encode's comment below)
//
// Apple gain-map decode + reconstruction math is otherwise copied verbatim from
// hdr-gainmap-compositor.cpp -- see that file for the validated production semantics, and
// .planning/spikes/005-avif-gainmap-and-p3-preservation/README.md for why this deliberately skips
// the Display-P3-to-output matrix those other compositors apply (preserving P3 was requested
// directly, and removing the matrix also removes the color-cross-talk anomaly found in spike 002).
#include <libheif/heif.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

namespace {
constexpr const char* kGainMapType = "urn:com:apple:photo:2020:aux:hdrgainmap";
constexpr size_t kMaxInputBytes = 100ULL * 1024ULL * 1024ULL;
constexpr uint64_t kMaxPixels = 64ULL * 1024ULL * 1024ULL;
constexpr int kMaxDimension = 16'384;
constexpr int kMaxOutputDimension = 8192;

void check(heif_error error, const char* operation) {
  if (error.code != heif_error_Ok) {
    std::cerr << operation << ": " << error.message << "\n";
    std::exit(1);
  }
}

float rec709_to_linear(float value) {
  return value < 0.081f ? value / 4.5f : std::pow((value + 0.099f) / 1.099f, 1.0f / 0.45f);
}

float source_to_linear(float value, const std::string& transfer) {
  if (transfer == "rec709") return rec709_to_linear(value);
  return value <= 0.04045f ? value / 12.92f : std::pow((value + 0.055f) / 1.055f, 2.4f);
}

float apple_headroom(float maker33, float maker48) {
  const float stops = maker33 < 1.0f
    ? (maker48 <= 0.01f ? -20.0f * maker48 + 1.8f : -0.101f * maker48 + 1.601f)
    : (maker48 <= 0.01f ? -70.0f * maker48 + 3.0f : -0.303f * maker48 + 2.303f);
  return std::pow(2.0f, std::max(stops, 0.0f));
}

float sample_gain(const uint8_t* pixels, size_t stride, int width, int height, float x, float y) {
  const float gx = std::clamp(x * width - 0.5f, 0.0f, static_cast<float>(width - 1));
  const float gy = std::clamp(y * height - 0.5f, 0.0f, static_cast<float>(height - 1));
  const int x0 = static_cast<int>(gx), y0 = static_cast<int>(gy);
  const int x1 = std::min(x0 + 1, width - 1), y1 = std::min(y0 + 1, height - 1);
  const float tx = gx - x0, ty = gy - y0;
  const auto at = [&](int px, int py) { return pixels[static_cast<size_t>(py) * stride + px] / 255.0f; };
  const float top = at(x0, y0) * (1.0f - tx) + at(x1, y0) * tx;
  const float bottom = at(x0, y1) * (1.0f - tx) + at(x1, y1) * tx;
  return rec709_to_linear(top * (1.0f - ty) + bottom * ty);
}

// Standard SMPTE ST 2084 (PQ) OETF. libavif's AVIF_TRANSFER_CHARACTERISTICS_LINEAR is NOT
// extended-range -- its avifToGammaLinear() clamps to [0,1] (confirmed by reading libavif's
// src/colr.c directly), silently crushing every value above SDR white. PQ is the one transfer
// characteristic libavif treats as extended-range ("SDR white is 1.0 (extended SDR)", see
// avifToLinearPQ/avifToGammaPQ in src/colr.c), using a fixed 203-nits SDR reference white --
// matching that exact convention (not this project's other 100-nits convention) is required for
// correct round-tripping through libavif's own PQ codec, hence the literal 203.0f at the call site.
float pq_encode(float nits) {
  constexpr float m1 = 2610.0f / 16384.0f, m2 = 2523.0f / 32.0f;
  constexpr float c1 = 3424.0f / 4096.0f, c2 = 2413.0f / 128.0f, c3 = 2392.0f / 128.0f;
  const float y = std::clamp(nits / 10000.0f, 0.0f, 1.0f);
  const float ym1 = std::pow(y, m1);
  return std::pow((c1 + c2 * ym1) / (1.0f + c3 * ym1), m2);
}

bool parse_float(const char* value, float& result) {
  char* end = nullptr;
  result = std::strtof(value, &end);
  return end && *end == '\0' && std::isfinite(result) && result >= 0.0f && result <= 1000.0f;
}

const char* argument(int argc, char** argv, const char* name) {
  for (int i = 1; i + 1 < argc; ++i) if (std::strcmp(argv[i], name) == 0) return argv[i + 1];
  return nullptr;
}

// IEEE 754 binary32 -> binary16, round-to-nearest-even (same as hdr-ultrahdr-compositor.cpp).
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

void write_u32(uint32_t value) {
  unsigned char bytes[4] = { static_cast<unsigned char>(value), static_cast<unsigned char>(value >> 8), static_cast<unsigned char>(value >> 16), static_cast<unsigned char>(value >> 24) };
  std::cout.write(reinterpret_cast<const char*>(bytes), 4);
}
} // namespace

int main(int argc, char** argv) {
  const char* mode = argument(argc, argv, "--mode");
  if (!mode || (std::strcmp(mode, "sdr") != 0 && std::strcmp(mode, "gainmap") != 0)) {
    std::cerr << "usage: hdr-avif-decode --mode sdr|gainmap [apple metadata flags]\n";
    return 2;
  }
  const char* version = argument(argc, argv, "--hdr-version");
  const char* maker33_arg = argument(argc, argv, "--maker-note-33");
  const char* maker48_arg = argument(argc, argv, "--maker-note-48");
  const char* profile = argument(argc, argv, "--source-profile");
  const char* transfer = argument(argc, argv, "--source-transfer");
  const char* orientation = argument(argc, argv, "--orientation");
  float maker33 = 0.0f, maker48 = 0.0f;
  if (!version || (std::strcmp(version, "1") != 0 && std::strcmp(version, "1.0") != 0) || !maker33_arg || !maker48_arg || !parse_float(maker33_arg, maker33) || !parse_float(maker48_arg, maker48) || !profile || !transfer || !orientation || std::strcmp(orientation, "1") != 0 || (std::strcmp(profile, "display-p3") != 0 && std::strcmp(profile, "rec709") != 0) || (std::strcmp(transfer, "srgb") != 0 && std::strcmp(transfer, "rec709") != 0)) {
    std::cerr << "invalid Apple HDR metadata contract\n";
    return 2;
  }

  heif_context* context = heif_context_alloc();
  if (!context) return 1;
  std::vector<uint8_t> input;
  std::array<char, 64 * 1024> buffer{};
  while (std::cin.good()) {
    std::cin.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const auto count = std::cin.gcount();
    if (count <= 0) break;
    if (input.size() > kMaxInputBytes - static_cast<size_t>(count)) { std::cerr << "input exceeds limits\n"; return 1; }
    input.insert(input.end(), buffer.data(), buffer.data() + count);
  }
  if (input.empty()) { std::cerr << "empty input\n"; return 1; }
  check(heif_context_read_from_memory(context, input.data(), input.size(), nullptr), "read HEIF");

  heif_image_handle* primary_handle = nullptr;
  check(heif_context_get_primary_image_handle(context, &primary_handle), "get primary image");
  heif_image* primary = nullptr;
  heif_decoding_options* options = heif_decoding_options_alloc();
  check(heif_decode_image(primary_handle, &primary, heif_colorspace_RGB, heif_chroma_interleaved_RGB, options), "decode primary image");
  heif_decoding_options_free(options);

  size_t primary_stride = 0;
  const uint8_t* primary_pixels = heif_image_get_plane_readonly2(primary, heif_channel_interleaved, &primary_stride);
  const int width = heif_image_get_width(primary, heif_channel_interleaved), height = heif_image_get_height(primary, heif_channel_interleaved);
  if (!primary_pixels || width <= 0 || height <= 0 || width > kMaxDimension || height > kMaxDimension || static_cast<uint64_t>(width) * height > kMaxPixels) { std::cerr << "decoded dimensions exceed limits\n"; return 1; }

  const float scale = std::min({1.0f, static_cast<float>(kMaxOutputDimension) / width, static_cast<float>(kMaxOutputDimension) / height});
  const int output_width = std::max(1, static_cast<int>(std::round(width * scale))), output_height = std::max(1, static_cast<int>(std::round(height * scale)));

  std::vector<uint8_t> sdr_rgba(static_cast<size_t>(output_width) * output_height * 4);
  for (int oy = 0; oy < output_height; ++oy) for (int ox = 0; ox < output_width; ++ox) {
    const float x = (ox + 0.5f) / output_width, y = (oy + 0.5f) / output_height;
    const int sx = std::min(static_cast<int>(x * width), width - 1), sy = std::min(static_cast<int>(y * height), height - 1);
    const uint8_t* pixel = primary_pixels + static_cast<size_t>(sy) * primary_stride + sx * 3;
    const size_t offset = (static_cast<size_t>(oy) * output_width + ox) * 4;
    sdr_rgba[offset + 0] = pixel[0]; sdr_rgba[offset + 1] = pixel[1]; sdr_rgba[offset + 2] = pixel[2]; sdr_rgba[offset + 3] = 255;
  }

  if (std::strcmp(mode, "sdr") == 0) {
    write_u32(static_cast<uint32_t>(output_width)); write_u32(static_cast<uint32_t>(output_height));
    write_u32(0); write_u32(0);
    std::cout.write(reinterpret_cast<const char*>(sdr_rgba.data()), static_cast<std::streamsize>(sdr_rgba.size()));
    heif_image_release(primary); heif_image_handle_release(primary_handle); heif_context_free(context);
    return std::cout.good() ? 0 : 1;
  }

  const int auxiliary_count = heif_image_handle_get_number_of_auxiliary_images(primary_handle, 0);
  std::vector<heif_item_id> auxiliary_ids(auxiliary_count);
  heif_image_handle_get_list_of_auxiliary_image_IDs(primary_handle, 0, auxiliary_ids.data(), auxiliary_count);
  heif_image_handle* gain_handle = nullptr;
  for (heif_item_id id : auxiliary_ids) {
    heif_image_handle* candidate = nullptr;
    if (heif_image_handle_get_auxiliary_image_handle(primary_handle, id, &candidate).code != heif_error_Ok) continue;
    const char* type = nullptr;
    const bool is_gain_map = heif_image_handle_get_auxiliary_type(candidate, &type).code == heif_error_Ok && type && std::strcmp(type, kGainMapType) == 0;
    if (type) heif_image_handle_release_auxiliary_type(candidate, &type);
    if (is_gain_map) { gain_handle = candidate; break; }
    heif_image_handle_release(candidate);
  }
  if (!gain_handle) { std::cerr << "Apple HDR gain map auxiliary image not found\n"; return 1; }

  heif_image* gain = nullptr;
  options = heif_decoding_options_alloc();
  check(heif_decode_image(gain_handle, &gain, heif_colorspace_monochrome, heif_chroma_monochrome, options), "decode gain map");
  heif_decoding_options_free(options);
  size_t gain_stride = 0;
  const uint8_t* gain_pixels = heif_image_get_plane_readonly2(gain, heif_channel_Y, &gain_stride);
  const int gain_width = heif_image_get_width(gain, heif_channel_Y), gain_height = heif_image_get_height(gain, heif_channel_Y);
  if (!gain_pixels || gain_width <= 0 || gain_height <= 0 || gain_width > kMaxDimension || gain_height > kMaxDimension) { std::cerr << "gain map dimensions exceed limits\n"; return 1; }

  const float headroom = apple_headroom(maker33, maker48);
  std::vector<uint16_t> hdr_rgba(static_cast<size_t>(output_width) * output_height * 4);
  for (int oy = 0; oy < output_height; ++oy) for (int ox = 0; ox < output_width; ++ox) {
    const float x = (ox + 0.5f) / output_width, y = (oy + 0.5f) / output_height;
    const int sx = std::min(static_cast<int>(x * width), width - 1), sy = std::min(static_cast<int>(y * height), height - 1);
    const uint8_t* pixel = primary_pixels + static_cast<size_t>(sy) * primary_stride + sx * 3;
    const float gain_factor = 1.0f + (headroom - 1.0f) * sample_gain(gain_pixels, gain_stride, gain_width, gain_height, x, y);
    const float r = source_to_linear(pixel[0] / 255.0f, transfer) * gain_factor;
    const float g = source_to_linear(pixel[1] / 255.0f, transfer) * gain_factor;
    const float b = source_to_linear(pixel[2] / 255.0f, transfer) * gain_factor;
    const size_t offset = (static_cast<size_t>(oy) * output_width + ox) * 4;
    hdr_rgba[offset + 0] = float_to_half(pq_encode(r * 203.0f));
    hdr_rgba[offset + 1] = float_to_half(pq_encode(g * 203.0f));
    hdr_rgba[offset + 2] = float_to_half(pq_encode(b * 203.0f));
    hdr_rgba[offset + 3] = float_to_half(1.0f);
  }
  heif_image_release(gain); heif_image_handle_release(gain_handle); heif_image_release(primary); heif_image_handle_release(primary_handle); heif_context_free(context);

  write_u32(static_cast<uint32_t>(output_width)); write_u32(static_cast<uint32_t>(output_height));
  write_u32(static_cast<uint32_t>(gain_width)); write_u32(static_cast<uint32_t>(gain_height));
  std::cout.write(reinterpret_cast<const char*>(sdr_rgba.data()), static_cast<std::streamsize>(sdr_rgba.size()));
  std::cout.write(reinterpret_cast<const char*>(hdr_rgba.data()), static_cast<std::streamsize>(hdr_rgba.size() * sizeof(uint16_t)));
  return std::cout.good() ? 0 : 1;
}
