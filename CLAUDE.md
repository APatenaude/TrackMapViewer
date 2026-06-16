# Track Map Viewer

Mobile-first deep-zoom race track map viewer. Tiled raster background (DZI) with SVG vector layers (racing line, braking zones, etc.). Self-hosted PWA via Docker/Portainer + Traefik.

## Stack

- **Vite 5 + vanilla TypeScript** - no UI framework
- **OpenSeadragon 4.x** - tiled viewer (`/tiles/tremblant.dzi`)
- **qrcode** - QR share modal
- **vite-plugin-pwa** - service worker, offline, installable
- **libvips** - tile generation at Docker build time only

## Project Structure

```
assets/tremblant.jpg      # source JPG (committed normally, NOT Git LFS) - tiled at build, never shipped
public/
  config.json             # imageWidth/imageHeight + layer definitions (authoritative)
  tremblant.svg           # Plain SVG, layers as <g id="..."> matching config
  icons/                  # PWA icons (192, 512, maskable)
  tiles/                  # generated DZI - gitignored, built by vips dzsave
src/
  types.ts                # shared interfaces (AppConfig, PersistedState, etc.)
  state.ts                # localStorage persistence (key: trackmap.state)
  viewer.ts               # OSD init + SVG overlay via addOverlay
  layers.ts               # layer panel, visibility/opacity controls
  fab.ts                  # draggable FAB with corner-snap
  share.ts                # QR modal
  main.ts                 # bootstrap: fetch config + svg, init all modules
  style.css               # full-viewport, bottom-sheet/side-panel, FAB, modal
```

## Key Implementation Details

### Tiling
- **Docker:** `vips dzsave assets/tremblant.jpg public/tiles/tremblant --tile-size 256 --overlap 1 --suffix .jpg[Q=82]`
  - Note: the spec says `vips dzi` but Alpine's vips-tools 8.17+ uses `vips dzsave`
- **Local dev:** `npm run tile` (requires libvips installed). The DZI under `public/tiles/` is gitignored; regenerate it once before `npm run dev`.

### OSD SVG Overlay
`viewer.addOverlay()` **must** be called inside the OSD `"open"` event handler. Uses `document.adoptNode()` to move SVG `<g>` elements into the overlay `<svg>`.

### Swapping the track assets
The bundled track is Mont-Tremblant (`assets/tremblant.jpg` + `public/tremblant.svg`). To host a different track:
1. Drop the new JPG into `assets/` and the Plain-SVG overlay into `public/`
2. Update `public/config.json`: `imageWidth`/`imageHeight` (actual JPG pixels), `svgPath`, `tileSource`, `svgScale`, and the `layers` (ids must match the SVG `<g>` ids)
3. Regenerate tiles (`npm run tile` locally, or let the Docker build handle it)

### Config is the source of truth
`config.json` `imageWidth`/`imageHeight` drive the SVG overlay rect, viewBox, and all aspect-ratio math. Nothing hardcodes dimensions.

### Deploy
A prebuilt image is published to GHCR (`ghcr.io/apatenaude/track-map`) by `.github/workflows/release.yml`, which builds + pushes on a pushed `v*` tag (e.g. `git tag v1.1.0 && git push origin v1.1.0`). Deployments pull the image; they don't build.
- `compose.yml` - the public "run anywhere" file (pulls `:latest`, publishes `:8080`).
- `compose.traefik.yml` - the owner's **private, gitignored** Portainer/Traefik stack (TLS + host routing, self-hosted Umami). Not part of the public repo.

**Assets are NOT in Git LFS** - `assets/tremblant.jpg` is committed as a normal file, so a plain `git clone` / Docker git-context build gets the real image (an LFS pointer would break `vips dzsave`).

## Dev Commands

```bash
npm run dev          # Vite dev server (needs tiles in public/tiles/)
npm run build        # Production build → dist/
npm run preview      # Preview production build (tests PWA/SW)
npm run tile         # Generate tiles with local vips (required before dev)
```

## Build

```bash
docker build -t track-map .
docker run -p 8080:80 track-map   # Serves on localhost:8080
```

## PWA / Service Worker

- Precaches app shell, config, SVG, icons, `tremblant.dzi`
- `revision: null` on `tremblant.dzi` in Workbox config - required to avoid hash mismatch on rebuild
- Tiles cached at runtime with CacheFirst (immutable, 30 days)
- SW only active in production build - use `npm run preview` to test offline behavior
