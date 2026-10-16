FROM node:24-alpine AS build

# libheif ships HEIC/HEVC decoding as a separate runtime-loaded plugin (libheif-libde265);
# without it, heif_decode_image fails on every real Apple HEIC photo before any gain-map
# math runs, and heif-convert (SDR full-size) fails identically. Install it in the build
# stage too so the smoke test below actually exercises it.
RUN apk add --no-cache ffmpeg g++ make libheif-dev libheif-libde265 libheif-tools libavif-dev
LABEL org.opencontainers.image.description="Immich Pages production runtime; HDR compositor compiled from source"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN g++ -O2 -std=c++17 -Wall -Wextra scripts/hdr-gainmap-compositor.cpp -lheif -o /usr/local/bin/hdr-gainmap-compositor
# AVIF HDR delivery (.planning/spikes/005-avif-gainmap-and-p3-preservation/): two single-library
# binaries piped together, same one-native-contract-per-concern pattern as the HEVC/MP4 path
# above -- decode links only libheif, encode links only libavif. See hdr-avif-decode.cpp's header
# comment for the full story. libavif-dev is a plain Alpine package, no from-source build needed.
RUN g++ -O2 -std=c++17 -Wall -Wextra scripts/hdr-avif-decode.cpp -lheif -o /usr/local/bin/hdr-avif-decode
RUN g++ -O2 -std=c++17 -Wall -Wextra scripts/hdr-avif-encode.cpp -lavif -o /usr/local/bin/hdr-avif-encode
# Build-time smoke test: fail loudly if the HEVC decoder plugin isn't actually registered,
# instead of silently breaking HDR/full-size decode only once a real photo reaches production.
RUN heif-convert --list-decoders | grep -q '^- libde265 ' || (echo "libheif HEVC decoder plugin missing" >&2 && exit 1)
RUN npm run check && npm run build

# The full test suite against the real HDR toolchain: the same libheif, libavif, ffmpeg and
# compiled binaries as production, plus exiftool (the runtime image's metadata reader), so the
# native HDR tests run instead of skipping. Not part of the production image: build it with
#   docker build --target test --build-context tests=tests .
# (tests/ is excluded from the main context; npm run test:isolated does this from a clean export).
FROM build AS test
RUN apk add --no-cache exiftool libavif-apps
COPY --from=tests . ./tests
RUN chown -R node:node /app
USER node
# Native HDR tests must run here: a missing binary or tool fails the suite rather than skipping.
ENV CI=true TZ=UTC HDR_NATIVE_TESTS=required
CMD ["npm", "test"]

FROM node:24-alpine AS runtime

RUN apk add --no-cache ffmpeg libheif libheif-libde265 libheif-tools exiftool libavif-apps libavif

WORKDIR /app
# Listen address, and the origin behind a TLS-terminating reverse proxy. Pages checks that form
# posts come from its own origin; these headers let it see the visitor's https://host rather than
# the proxy's plain-HTTP hop. adapter-node falls back to the Host header and https when the proxy
# sends neither, so they are safe defaults. Set ORIGIN to pin a fixed origin instead.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PROTOCOL_HEADER=X-Forwarded-Proto HOST_HEADER=X-Forwarded-Host
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /usr/local/bin/hdr-gainmap-compositor /usr/local/bin/hdr-gainmap-compositor
COPY --from=build /usr/local/bin/hdr-avif-decode /usr/local/bin/hdr-avif-decode
COPY --from=build /usr/local/bin/hdr-avif-encode /usr/local/bin/hdr-avif-encode

USER node
EXPOSE 3000
CMD ["node", "build"]
