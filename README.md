# Track Map Viewer

A mobile-first deep-zoom race track map viewer for HPDE instructors to share with students. Displays a high-res track photo as a tiled background with toggleable SVG vector overlays - racing line, braking zones, apexes, corner numbers, etc. Installable as a PWA, works offline after first view, and self-hosts via Docker.

## Features

- **Deep zoom** - pan and pinch-zoom a high-res track photo without janking on mobile
- **Vector layers** - racing line and other paths stay crisp at any zoom level
- **Layer panel** - toggle visibility and adjust opacity per layer; bottom sheet on mobile, side panel on desktop
- **Draggable FAB** - floating button snaps to any corner; position persists
- **Share** - QR code modal of the page URL
- **PWA** - installable, works fully offline after first visit
- **No index** - robots.txt + headers keep the page off search engines

## Quick Start (local dev)

**Prerequisites:** Node.js 20+

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) (or the next available port if 5173 is taken).

## Using Your Own Track Assets

1. **Add your track photo** - drop the high-res JPG into `assets/` (e.g. `assets/mytrack.jpg`). No Git LFS needed; it's committed as a normal file.

2. **Update `public/config.json`** - set the pixel dimensions, the SVG/tile paths, the localized title + track name, and your layers (ids must match the SVG `<g>` ids):

   ```json
   {
   	"imageWidth": 4500,
   	"imageHeight": 8192,
   	"svgScale": 1,
   	"svgPath": "/mytrack.svg",
   	"tileSource": "/tiles/mytrack.dzi",
   	"title": { "en": "Track Map", "fr": "Carte circuit" },
   	"trackName": "My Track",
   	"layers": [
   		{
   			"id": "racing_line",
   			"label": { "en": "Driving line", "fr": "Ligne de conduite" },
   			"defaultOn": true,
   			"defaultOpacity": 1.0
   		}
   	]
   }
   ```

   - `svgScale` - image pixels per SVG user unit. Use `1` if the SVG is drawn at the photo's pixel size; otherwise `imageWidth / svgViewBoxWidth`.
   - `svgPath` / `tileSource` - where the overlay SVG and DZI tiles are served from.

3. **Export your SVG** - from Inkscape, **Save As → Plain SVG**. Each toggleable layer must be a top-level `<g>` with an `id` matching `config.json`. Save it into `public/`.

4. **Generate tiles** - requires [libvips](https://www.libvips.org/install.html):

   ```bash
   vips dzsave assets/mytrack.jpg public/tiles/mytrack --tile-size 256 --overlap 1 --suffix .jpg[Q=82]
   ```

   (`npm run tile` does this for the bundled track.)

5. Run `npm run dev` and check the result.

## Project Structure

```
assets/tremblant.jpg      # source photo - tiled at build, never shipped directly
public/
  config.json             # layer definitions + image dimensions + paths
  tremblant.svg           # vector overlays (Inkscape Plain SVG export)
  icons/                  # PWA icons
  tiles/                  # generated DZI pyramid (gitignored)
src/
  main.ts                 # bootstrap
  viewer.ts               # OpenSeadragon init + SVG overlay
  layers.ts               # layer panel UI
  fab.ts                  # draggable floating action button
  share.ts                # QR modal
  state.ts                # localStorage persistence
  style.css
```

## Build Commands

| Command           | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                                 |
| `npm run build`   | Production build → `dist/`                                 |
| `npm run preview` | Preview production build (tests PWA/SW)                    |
| `npm run tile`    | Generate DZI tiles from `assets/tremblant.jpg` (requires vips) |

## Deploy

A prebuilt image is published to GitHub Container Registry, so you can run it without building anything.

### Run it (Docker)

```bash
docker compose up -d        # then open http://localhost:8080
```

…or without compose:

```bash
docker run -d -p 8080:80 ghcr.io/apatenaude/track-map:latest
```

### Behind a reverse proxy

The container serves plain HTTP on port 80 and sets its own `X-Robots-Tag: noindex`. For HTTPS and a domain, point any reverse proxy (nginx, Caddy, Traefik, …) at it - forward your proxy to the container's port 80 (host port 8080 above).

### Build your own image

The published image bundles the Mont-Tremblant map. To host a _different_ track, swap the assets (see [Using Your Own Track Assets](#using-your-own-track-assets)) and build from source - the Dockerfile runs the whole pipeline (libvips tiling + Vite build) in one step:

```bash
docker build -t my-track-map .
docker run -d -p 8080:80 my-track-map
```

No Git LFS required - the source photo is committed normally, so a plain `git clone` (or a Docker git-context build) gets the real file.

## Tech Stack

- [Vite](https://vitejs.dev/) + vanilla TypeScript
- [OpenSeadragon](https://openseadragon.github.io/) - tiled deep-zoom viewer
- [qrcode](https://github.com/soldair/node-qrcode) - QR code generation
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) - service worker + offline
- [libvips](https://www.libvips.org/) - tile generation at build time (not a runtime dep)
- nginx - static file serving in production
