# syntax=docker/dockerfile:1.7-labs
# (1.7-labs for COPY --parents: copy only the track images, keeping their folders.)

# ---- Stage 1: build (tile + vite build) ----
FROM node:20-alpine AS build
RUN apk add --no-cache vips-tools
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Track images on their own layer, so tiles only regenerate when an image changes
# (not on every track.json edit).
COPY scripts/tiles.mjs ./scripts/
COPY --parents tracks/*/image.* ./
RUN node scripts/tiles.mjs

COPY . .
RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
