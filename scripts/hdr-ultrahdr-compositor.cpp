// Spike (.planning/spikes/002-ultrahdr-jpeg-native-encoder/): produces a real ISO 21496-1
// "Ultra HDR" gain-map JPEG using Google's libultrahdr reference encoder. Everything through the
// per-pixel Apple gain-map reconstruction is copied verbatim from scripts/hdr-gainmap-compositor.cpp
// (same MakerNote 33/48 stop curve, same Rec.709/sRGB linearization, same Display-P3 matrix) --
// see that file's comments and docs/hdr-media.md for the math itself. This program only diverges
// at the final step: instead of PQ-encoding into a 16-bit PPM for ffmpeg, it hands libultrahdr a
// linear HDR buffer and the plain SDR buffer and lets the reference encoder compute the
// standards-compliant gain map and JPEG container.
#include <libheif/heif.h>
#include <ultrahdr_api.h>

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

bool parse_float(const char* value, float& result) {
  char* end = nullptr;
  result = std::strtof(value, &end);
  return end && *end == '\0' && std::isfinite(result) && result >= 0.0f && result <= 1000.0f;
}

const char* argument(int argc, char** argv, const char* name) {
  for (int i = 1; i + 1 < argc; ++i) if (std::strcmp(argv[i], name) == 0) return argv[i + 1];
  return nullptr;
}

void check(heif_error error, const char* operation) {
  if (error.code != heif_error_Ok) {
    std::cerr << operation << ": " << error.message << "\n";
    std::exit(1);
  }
}

// IEEE 754 binary32 -> binary16, round-to-nearest-even. libultrahdr's linear HDR intent format
// (UHDR_IMG_FMT_64bppRGBAHalfFloat) requires this exact representation; relying on a compiler
// extension (_Float16) would make the build toolchain-dependent for no benefit.
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
} // namespace

int main(int argc, char** argv) {
  const char* version = argument(argc, argv, "--hdr-version");
  const char* maker33_arg = argument(argc, argv, "--maker-note-33");
  const char* maker48_arg = argument(argc, argv, "--maker-note-48");
  const char* profile = argument(argc, argv, "--source-profile");
  const char* transfer = argument(argc, argv, "--source-transfer");
  const char* orientation = argument(argc, argv, "--orientation");
  // Spike-only tunable overrides (.planning/spikes/004-tunable-gain-map-and-slider-compare/),
  // both optional and defaulting to exactly the Apple-derived behavior when omitted -- see
  // hdr-gainmap-compositor-tunable.cpp's header comment for why these exist.
  const char* headroom_override_arg = argument(argc, argv, "--headroom-override");
  const char* gain_gamma_arg = argument(argc, argv, "--gain-gamma");
  float maker33 = 0.0f, maker48 = 0.0f;
  if (!version || (std::strcmp(version, "1") != 0 && std::strcmp(version, "1.0") != 0) || !maker33_arg || !maker48_arg || !parse_float(maker33_arg, maker33) || !parse_float(maker48_arg, maker48) || !profile || !transfer || !orientation || std::strcmp(orientation, "1") != 0 || (std::strcmp(profile, "display-p3") != 0 && std::strcmp(profile, "rec709") != 0) || (std::strcmp(transfer, "srgb") != 0 && std::strcmp(transfer, "rec709") != 0)) {
    std::cerr << "invalid Apple HDR metadata contract\n";
    return 2;
  }
  float headroom_override = -1.0f;
  if (headroom_override_arg && (!parse_float(headroom_override_arg, headroom_override) || headroom_override < 1.0f || headroom_override > 16.0f)) {
    std::cerr << "invalid --headroom-override (expected 1.0-16.0)\n";
    return 2;
  }
  float gain_gamma = 1.0f;
  if (gain_gamma_arg && (!parse_float(gain_gamma_arg, gain_gamma) || gain_gamma < 0.1f || gain_gamma > 10.0f)) {
    std::cerr << "invalid --gain-gamma (expected 0.1-10.0)\n";
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
  size_t primary_stride = 0, gain_stride = 0;
  const uint8_t* primary_pixels = heif_image_get_plane_readonly2(primary, heif_channel_interleaved, &primary_stride);
  const uint8_t* gain_pixels = heif_image_get_plane_readonly2(gain, heif_channel_Y, &gain_stride);
  const int width = heif_image_get_width(primary, heif_channel_interleaved), height = heif_image_get_height(primary, heif_channel_interleaved);
  const int gain_width = heif_image_get_width(gain, heif_channel_Y), gain_height = heif_image_get_height(gain, heif_channel_Y);
  if (!primary_pixels || !gain_pixels || width <= 0 || height <= 0 || gain_width <= 0 || gain_height <= 0 || width > kMaxDimension || height > kMaxDimension || gain_width > kMaxDimension || gain_height > kMaxDimension || static_cast<uint64_t>(width) * height > kMaxPixels) { std::cerr << "decoded dimensions exceed limits\n"; return 1; }

  const float scale = std::min({1.0f, static_cast<float>(kMaxOutputDimension) / width, static_cast<float>(kMaxOutputDimension) / height});
  const int output_width = std::max(1, static_cast<int>(std::round(width * scale))), output_height = std::max(1, static_cast<int>(std::round(height * scale)));
  const float headroom = headroom_override > 0.0f ? headroom_override : apple_headroom(maker33, maker48);
  const bool is_display_p3 = std::strcmp(profile, "display-p3") == 0;

  // Two buffers, same dimensions, pixel-for-pixel aligned: libultrahdr computes the gain map
  // itself from the (HDR, SDR) pair, exactly mirroring the per-channel reconstruction the
  // existing compositor already performs -- just stopping one step earlier (no PQ encode, no
  // forced output color space) and letting the reference encoder own the final packaging.
  std::vector<uint16_t> hdr_rgba(static_cast<size_t>(output_width) * output_height * 4);
  std::vector<uint8_t> sdr_rgba(static_cast<size_t>(output_width) * output_height * 4);
  for (int oy = 0; oy < output_height; ++oy) for (int ox = 0; ox < output_width; ++ox) {
    const float x = (ox + 0.5f) / output_width, y = (oy + 0.5f) / output_height;
    const int sx = std::min(static_cast<int>(x * width), width - 1), sy = std::min(static_cast<int>(y * height), height - 1);
    const uint8_t* pixel = primary_pixels + static_cast<size_t>(sy) * primary_stride + sx * 3;
    const float shaped_gain = std::pow(std::clamp(sample_gain(gain_pixels, gain_stride, gain_width, gain_height, x, y), 0.0f, 1.0f), gain_gamma);
    const float gain_factor = 1.0f + (headroom - 1.0f) * shaped_gain;
    float r = source_to_linear(pixel[0] / 255.0f, transfer) * gain_factor, g = source_to_linear(pixel[1] / 255.0f, transfer) * gain_factor, b = source_to_linear(pixel[2] / 255.0f, transfer) * gain_factor;
    if (is_display_p3) {
      const float nr = 0.8225927f * r + 0.177533f * g, ng = 0.0331995f * r + 0.9667835f * g, nb = 0.0170853f * r + 0.0723957f * g + 0.910519f * b;
      r = nr; g = ng; b = nb;
    }
    const size_t hdr_offset = (static_cast<size_t>(oy) * output_width + ox) * 4;
    hdr_rgba[hdr_offset + 0] = float_to_half(r);
    hdr_rgba[hdr_offset + 1] = float_to_half(g);
    hdr_rgba[hdr_offset + 2] = float_to_half(b);
    hdr_rgba[hdr_offset + 3] = float_to_half(1.0f);
    const size_t sdr_offset = hdr_offset;
    sdr_rgba[sdr_offset + 0] = pixel[0];
    sdr_rgba[sdr_offset + 1] = pixel[1];
    sdr_rgba[sdr_offset + 2] = pixel[2];
    sdr_rgba[sdr_offset + 3] = 255;
  }
  heif_image_release(gain); heif_image_handle_release(gain_handle); heif_image_release(primary); heif_image_handle_release(primary_handle); heif_context_free(context);

  uhdr_raw_image_t hdr_image{};
  hdr_image.fmt = UHDR_IMG_FMT_64bppRGBAHalfFloat;
  hdr_image.cg = UHDR_CG_BT_2100; // Matches the existing video path's fixed BT.2020 output tag (encodeHdrMp4); see hdr-gainmap-compositor.cpp's identical display-p3-only matrix for why this is an approximation, not a per-profile color-managed transform.
  hdr_image.ct = UHDR_CT_LINEAR;
  hdr_image.range = UHDR_CR_FULL_RANGE;
  hdr_image.w = static_cast<unsigned int>(output_width);
  hdr_image.h = static_cast<unsigned int>(output_height);
  hdr_image.planes[0] = hdr_rgba.data();
  hdr_image.planes[1] = nullptr;
  hdr_image.planes[2] = nullptr;
  hdr_image.stride[0] = static_cast<unsigned int>(output_width);

  uhdr_raw_image_t sdr_image{};
  sdr_image.fmt = UHDR_IMG_FMT_32bppRGBA8888;
  sdr_image.cg = is_display_p3 ? UHDR_CG_DISPLAY_P3 : UHDR_CG_BT_709;
  sdr_image.ct = UHDR_CT_SRGB;
  sdr_image.range = UHDR_CR_FULL_RANGE;
  sdr_image.w = static_cast<unsigned int>(output_width);
  sdr_image.h = static_cast<unsigned int>(output_height);
  sdr_image.planes[0] = sdr_rgba.data();
  sdr_image.planes[1] = nullptr;
  sdr_image.planes[2] = nullptr;
  sdr_image.stride[0] = static_cast<unsigned int>(output_width);

  uhdr_codec_private_t* encoder = uhdr_create_encoder();
  if (!encoder) { std::cerr << "uhdr_create_encoder failed\n"; return 1; }
  check_uhdr(uhdr_enc_set_raw_image(encoder, &hdr_image, UHDR_HDR_IMG), "set HDR raw image");
  check_uhdr(uhdr_enc_set_raw_image(encoder, &sdr_image, UHDR_SDR_IMG), "set SDR raw image");
  check_uhdr(uhdr_enc_set_quality(encoder, 90, UHDR_BASE_IMG), "set base quality");
  check_uhdr(uhdr_enc_set_output_format(encoder, UHDR_CODEC_JPG), "set output format");
  check_uhdr(uhdr_encode(encoder), "encode");
  uhdr_compressed_image_t* output = uhdr_get_encoded_stream(encoder);
  if (!output || !output->data || output->data_sz == 0) { std::cerr << "uhdr_get_encoded_stream returned empty output\n"; return 1; }
  std::cout.write(static_cast<const char*>(output->data), static_cast<std::streamsize>(output->data_sz));
  const bool ok = std::cout.good();
  uhdr_release_encoder(encoder);
  return ok ? 0 : 1;
}
