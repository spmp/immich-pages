FROM node:24-alpine AS build

RUN apk add --no-cache ffmpeg g++ make libheif-dev
LABEL org.opencontainers.image.description="Immich Pages production runtime; HDR compositor compiled from source"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN g++ -O2 -std=c++17 -Wall -Wextra scripts/hdr-gainmap-compositor.cpp -lheif -o /usr/local/bin/hdr-gainmap-compositor
RUN npm run check && npm run build

FROM node:24-alpine AS runtime

RUN apk add --no-cache ffmpeg libheif exiftool

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
