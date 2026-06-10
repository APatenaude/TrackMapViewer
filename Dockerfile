# ---- Stage 1: build (tile + vite build) ----
FROM node:20-alpine AS build
RUN apk add --no-cache vips-tools
WORKDIR /app

COPY package*.json ./
RUN npm ci

# JPG on its own layer so tiles only regenerate when the image changes
COPY assets/tremblant.jpg ./assets/tremblant.jpg
RUN mkdir -p public/tiles && \
    vips dzsave assets/tremblant.jpg public/tiles/tremblant --tile-size 256 --overlap 1 --suffix .jpg[Q=82]

COPY . .
RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
