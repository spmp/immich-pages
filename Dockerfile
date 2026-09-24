FROM node:24-alpine AS build

# libheif ships HEIC/HEVC decoding as a separate runtime-loaded plugin (libheif-libde265);
# without it, heif_decode_image fails on every real Apple HEIC photo before any gain-map
# math runs, and heif-convert (SDR full-size) fails identically. Install it in the build
# stage too so the smoke test below actually exercises it.
RUN apk add --no-cache ffmpeg g++ make libheif-dev libheif-libde265 libheif-tools
LABEL org.opencontainers.image.description="Immich Pages production runtime; HDR compositor compiled from source"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN g++ -O2 -std=c++17 -Wall -Wextra scripts/hdr-gainmap-compositor.cpp -lheif -o /usr/local/bin/hdr-gainmap-compositor
# Build-time smoke test: fail loudly if the HEVC decoder plugin isn't actually registered,
# instead of silently breaking HDR/full-size decode only once a real photo reaches production.
RUN heif-convert --list-decoders | grep -q '^- libde265 ' || (echo "libheif HEVC decoder plugin missing" >&2 && exit 1)
RUN npm run check && npm run build

FROM node:24-alpine AS runtime

RUN apk add --no-cache ffmpeg libheif libheif-libde265 libheif-tools exiftool

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /usr/local/bin/hdr-gainmap-compositor /usr/local/bin/hdr-gainmap-compositor

# Do not copy tests/resources or any fixture/media file into the production image.

USER node
EXPOSE 3000
CMD ["node", "build"]
