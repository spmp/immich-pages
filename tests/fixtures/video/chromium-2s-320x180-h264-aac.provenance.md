# Chromium video fixture provenance

This fixture is generated with FFmpeg 7.0.2-static (John Van Sickle build):

```text
ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/ Copyright (c) 2000-2024 the FFmpeg developers
```

The reproducible generation command is:

```sh
ffmpeg -hide_banner -f lavfi -i testsrc=duration=2:size=320x180:rate=30 -f lavfi -i sine=frequency=1000:sample_rate=48000:duration=2 -c:v libx264 -preset veryslow -b:v 40M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -t 2 tests/fixtures/video/chromium-2s-320x180-h264-aac.mp4
```

The generated MP4 is followed by a valid `free` atom so the checked-in fixture
also exercises ordinary multi-megabyte native range responses without changing
the encoded stream metadata.
