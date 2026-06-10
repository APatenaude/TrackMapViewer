# Track Map Viewer

Mobile-first deep-zoom race track map viewer. Tiled raster background (DZI) with SVG vector layers (racing line, braking zones, etc.). Self-hosted PWA via Docker/Portainer + Traefik.

## Stack

- **Vite 5 + vanilla TypeScript** — no UI framework
- **OpenSeadragon 4.x** — tiled viewer (`/tiles/track.dzi`)
- **qrcode** — QR share modal
- **vite-plugin-pwa** — service worker, offline, installable
- **libvips** — tile generation at Docker build time only

## Project Structure

```
assets/track.jpg          # source JPG (Git LFS) — tiled at build, never shipped
public/
  config.json             # imageWidth/imageHeight + layer definitions (authoritative)
  track.svg               # Plain SVG, layers as <g id="..."> matching config
  icons/                  # PWA icons (192, 512, maskable)
  tiles/                  # generated DZI — gitignored, built by vips dzsave
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
- **Docker:** `vips dzsave assets/track.jpg public/tiles/track --tile-size 256 --overlap 1 --suffix .jpg[Q=82]`
  - Note: the spec says `vips dzi` but Alpine's vips-tools 8.17+ uses `vips dzsave`
- **Local dev (vips installed):** `npm run tile`
- **Local dev (no vips):** `node scripts/gen-placeholder-tiles.mjs` creates placeholder DZI from the dummy track.jpg

### OSD SVG Overlay
`viewer.addOverlay()` **must** be called inside the OSD `"open"` event handler. Uses `document.adoptNode()` to move SVG `<g>` elements into the overlay `<svg>`.

### Replacing Placeholder Assets
When the real track.jpg arrives:
1. Drop it into `assets/track.jpg` (replace placeholder)
2. Update `public/config.json`: set `imageWidth` and `imageHeight` to the actual JPG pixel dimensions
3. Update `public/track.svg`: set `viewBox="0 0 {width} {height}"` to match
4. Regenerate tiles (either `npm run tile` locally or let Docker build handle it)

### Config is the source of truth
`config.json` `imageWidth`/`imageHeight` drive the SVG overlay rect, viewBox, and all aspect-ratio math. Nothing hardcodes dimensions.

### Deploy
Edit `compose.yml` — replace the four `# TODO` placeholders:
- `track.example.com` → your domain
- `websecure` → your Traefik entrypoint
- `letsencrypt` → your certresolver
- `traefik` (network) → your external Traefik network name

**Git LFS:** The Portainer host must have `git-lfs` installed. Without it, `COPY assets/track.jpg` in the Dockerfile gets the LFS pointer (134 bytes) instead of the real image, and `vips dzsave` will fail.

## Dev Commands

```bash
npm run dev          # Vite dev server (needs tiles in public/tiles/)
npm run build        # Production build → dist/
npm run preview      # Preview production build (tests PWA/SW)
npm run tile         # Generate tiles with local vips (if installed)

node scripts/gen-placeholders.mjs       # Regenerate placeholder JPG + icons
node scripts/gen-placeholder-tiles.mjs # Regenerate placeholder DZI tiles
```

## Build

```bash
docker build -t track-map .
docker run -p 8080:80 track-map   # Serves on localhost:8080
```

## PWA / Service Worker

- Precaches app shell, config, SVG, icons, `track.dzi`
- `revision: null` on `track.dzi` in Workbox config — required to avoid hash mismatch on rebuild
- Tiles cached at runtime with CacheFirst (immutable, 30 days)
- SW only active in production build — use `npm run preview` to test offline behavior
