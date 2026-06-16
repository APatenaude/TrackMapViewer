# Track Map Viewer - Implementation Spec

A self-hosted, mobile-first deep-zoom viewer for a race track map with a vector racing line (and other toggleable vector layers) overlaid on a high-res raster background. Built for an HPDE instructor to share with students. Single fixed map for now.

Use **Claude Code** to implement this end to end: scaffold the repo, install deps, run the tiling step, run the build, and fix any integration issues by actually running them.

---

## 1. Stack (keep it lean - no UI framework)

- **Vite + vanilla TypeScript** - app base.
- **OpenSeadragon** - tiled deep-zoom viewer (pan/zoom/minimap/momentum). The one unavoidable runtime dep.
- **qrcode** - render a QR of the page URL client-side.
- **vite-plugin-pwa** (dev dep) - service worker + offline.
- **libvips** (`vips` CLI, build-time only) - tile the JPG into a DZI pyramid.

**No** UI framework, **no** animation library. Animations are plain CSS transitions only (see §7). Do **not** add the `openseadragon-svg-overlay` plugin - use OSD's built-in `addOverlay` instead (§5).

Self-host all libs (bundled by Vite) - nothing from a CDN, so the PWA works fully offline.

---

## 2. Why tiling (context, don't second-guess it)

The background is a large high-res JPG (roughly 8k × 5k, ~40 MP). Even though the JPG is ~15 MB on disk, a browser decodes it to a raw bitmap of width × height × 4 bytes ≈ **~160 MB of RAM** at that size, which janks or crashes mid-range phones during interactive zoom. Tiling into a DZI pyramid means first paint pulls a tiny low-res overview (tens of KB) and only the on-screen 256px tiles stream in afterward - better for memory _and_ for a flaky track-day connection. The PWA caches tiles after first view.

The racing line and other paths are **real SVG vector**, so they stay crisp at any zoom. The JPG background softens at extreme zoom - that's inherent to any raster and is fine; the line is what matters.

---

## 3. Source assets the user provides

- `assets/track.jpg` - the high-res background. **Tracked with Git LFS** (see `.gitattributes`). Tiled at build time; never shipped as-is.
- `public/track.svg` - paths only, exported from Inkscape as **Plain SVG**. The Inkscape document size matches the JPG's pixel dimensions, and the exported `viewBox` matches the document, so SVG coords map 1:1 to image pixels. (The user guarantees these match; the app does not hardcode any dimensions - see below.) Each toggleable group is an Inkscape **layer** (`<g inkscape:groupmode="layer">`) with a stable `id` and an `inkscape:label`. The `id`s must match `config.json`.
- `public/config.json` - defines the layers/UI **and the image dimensions** (schema below). This decouples the UI from the SVG internals so the user can finalize Inkscape grouping later, and gives the app the canonical width/height to build the overlay rect from.

If `track.svg` / `track.jpg` aren't present yet, scaffold with a placeholder SVG (a few demo layers) and a small placeholder JPG so the build and app run.

### config.json schema

`imageWidth`/`imageHeight` are the **single source of truth** for the image dimensions - the overlay rect, the SVG viewBox handling, and any aspect-ratio math all derive from these. They must equal the actual JPG pixel size and the Inkscape document size (the user guarantees the match). Nothing in the code hardcodes dimensions.

```json
{
	"imageWidth": 8000,
	"imageHeight": 5000,
	"title": "Track Map",
	"layers": [
		{ "id": "racing-line", "label": "Racing line", "defaultOn": true, "defaultOpacity": 1.0 },
		{ "id": "braking", "label": "Braking zones", "defaultOn": true, "defaultOpacity": 0.8 },
		{ "id": "apexes", "label": "Apexes", "defaultOn": true, "defaultOpacity": 1.0 },
		{ "id": "corner-nums", "label": "Corner numbers", "defaultOn": true, "defaultOpacity": 1.0 },
		{ "id": "wet-line", "label": "Wet line", "defaultOn": false, "defaultOpacity": 1.0 }
	]
}
```

`id` is matched against the SVG group's `id`. If a configured layer has no matching group, skip it gracefully (warn in console). If the SVG has groups not in config, leave them visible and untouched.

---

## 4. File tree

```
track-map/
  .gitattributes          # assets/*.jpg via Git LFS
  .gitignore              # node_modules, dist, public/tiles
  compose.yml             # Portainer builds this from the git repo
  Dockerfile              # multi-stage: tile + build, then nginx
  nginx.conf
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  robots.txt
  assets/
    track.jpg             # source background (LFS) - tiled at build, not shipped
  public/
    config.json
    track.svg
    icons/                # PWA icons (192, 512, maskable)
    # tiles/ generated into here at build time (gitignored)
  src/
    main.ts               # bootstrap: load config + svg, init modules
    viewer.ts             # OSD init, gestures, SVG overlay, minimap reset
    layers.ts             # parse svg groups, build panel, visibility/opacity
    fab.ts                # draggable FAB, snap to nearest corner
    share.ts              # QR modal of window.location.href
    state.ts              # localStorage persist/restore
    style.css
```

---

## 5. Viewer + SVG overlay (the key integration)

Initialize OpenSeadragon on a full-viewport container, tile source `/tiles/track.dzi`.

**Overlay approach (no plugin):** build one `<svg>` element with `viewBox="0 0 {cfg.imageWidth} {cfg.imageHeight}"`, `width/height: 100%`, `preserveAspectRatio="xMinYMin meet"`, and inject the parsed `track.svg` group nodes into it. (Use the dimensions from `config.json`; if `track.svg` already carries a matching `viewBox` you can reuse it, but config is authoritative.) Attach it via OSD's built-in overlay, positioned to cover the entire image in image coordinates:

```ts
viewer.addHandler("open", () => {
	const rect = viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(0, 0, cfg.imageWidth, cfg.imageHeight));
	viewer.addOverlay({ element: svgEl, location: rect });
});
```

OSD then keeps the SVG glued to the image through all pan/zoom, and because it's vector inside a matching viewBox it stays crisp at every zoom level. Set `pointer-events: none` on the SVG so all gestures pass straight through to OSD (paths are display-only; toggling is via the panel, not tapping the map).

**Gesture config (this is the fiddly part - set exactly):**

```ts
new OpenSeadragon({
	element: container,
	tileSources: "/tiles/track.dzi",
	showNavigator: true, // minimap
	navigatorPosition: "TOP_RIGHT",
	navigatorAutoFade: false,
	animationTime: 0.4, // OSD's own zoom easing - our only "animation" on the map
	springStiffness: 7,
	gestureSettingsTouch: {
		pinchToZoom: true,
		flickEnabled: true, // momentum panning
		dblClickToZoom: false, // reserved/disabled
		clickToZoom: false,
	},
	gestureSettingsMouse: {
		scrollToZoom: true, // desktop wheel zoom
		clickToZoom: false,
		dblClickToZoom: false,
	},
	// optional: constrain so user can't fling the map off-screen
	visibilityRatio: 1.0,
	minZoomImageRatio: 0.8,
});
```

**Minimap reset:** wire a `dblclick` on the navigator element to `viewer.viewport.goHome()`. Also add a small reset/home button in the panel as a fallback. `goHome()` should also reset to the fit-to-screen view.

---

## 6. Layers panel + FAB

**FAB:** a single floating action button. **Draggable, snaps to the nearest of the 4 corners on release** (free drag while held). Implement with pointer events on the FAB only; `stopPropagation` so dragging it never pans the map. On `pointerup`, compute nearest corner by distance and settle there (CSS transition on position). Persist the chosen corner key (`tl|tr|bl|br`) to localStorage and restore on load. Tapping the FAB (without dragging - distinguish by a small movement threshold) opens the panel.

**Panel:** opens from the FAB.

- **Mobile (default):** bottom sheet sliding up from the bottom.
- **Desktop (min-width breakpoint, e.g. ≥768px):** side panel.
  Contents:
- One row per configured layer: a visibility toggle + an opacity slider (0-100%).
- Global **All on / All off**.
- **Reset view** button (`goHome()`).
- **Share** button → opens QR modal.
- Close button / tap-scrim-to-close.

**Applying layer state to SVG:** each layer group gets `transition: opacity 200ms ease`. Visibility on → set group opacity to the slider value; visibility off → set opacity 0. (Animating opacity gives the smooth cross-fade; no display toggling needed.) Slider changes update opacity live.

---

## 7. Animations (minimal, CSS only)

Exactly two, both pure CSS:

1. **Panel open/close** - one `transform` + `opacity` transition (slide-up on mobile, fade/slide on desktop). ~200-250ms.
2. **Layer toggle** - the opacity cross-fade on SVG groups above.

The map's zoom easing is OpenSeadragon's own (`animationTime`), not a transition. Nothing else animates. Do not add spring physics or an animation library.

---

## 8. Persisted state (localStorage)

Single JSON key, e.g. `trackmap.state`:

```ts
{
  view: { x: number, y: number, zoom: number } | null,  // OSD viewport center + zoom
  layers: { [id: string]: { visible: boolean, opacity: number } },
  fabCorner: "tl" | "tr" | "bl" | "br"
}
```

- Restore on load: apply layer state before/at `open`, then restore view with `viewport.panTo(new OpenSeadragon.Point(x,y), true)` + `viewport.zoomTo(zoom, null, true)`. If no saved view, `goHome()`.
- Save (debounced ~300ms) on viewport `animation-finish`, and immediately on any panel/FAB change.
- Defaults come from `config.json` when nothing is stored.

---

## 9. QR share

Share button opens a small centered modal with a QR (rendered via `qrcode` to a `<canvas>`) of `window.location.href` plus the URL as selectable text and a copy button. The URL is fixed (single map), so no state encoding needed. Tap scrim to dismiss.

---

## 10. PWA / offline

`vite-plugin-pwa` with `registerType: "autoUpdate"`:

- **Precache** the app shell (HTML/JS/CSS), `config.json`, `track.svg`, icons, and `track.dzi`.
- **Runtime cache** tile requests under `/tiles/` with a `CacheFirst` strategy (tiles are immutable), so areas viewed once work offline afterward.
- Web manifest: name, theme color, icons, `display: standalone`.

(Skip a "download all tiles" button for now - runtime caching covers the use case and keeps it lean. Easy to add later.)

---

## 11. Deploy: Portainer builds from Git, Traefik fronts it

Path: push the repo to Git, add a **Stack** in Portainer pointing at the repo (`compose.yml` with `build: .`). Portainer clones + builds on the server; redeploy = pull + rebuild. The JPG rides along via Git LFS.

### .gitattributes

```
assets/*.jpg filter=lfs diff=lfs merge=lfs -text
```

### .gitignore

```
node_modules/
dist/
public/tiles/
```

### Dockerfile (multi-stage)

```dockerfile
# ---- Stage 1: build (tile + vite build), thrown away ----
FROM node:20-alpine AS build
RUN apk add --no-cache vips-tools
WORKDIR /app

COPY package*.json ./
RUN npm ci

# JPG on its own layer so tiles only regenerate when it changes
COPY assets/track.jpg ./assets/track.jpg
RUN mkdir -p public/tiles && \
    vips dzi assets/track.jpg public/tiles/track --tile-size 256 --overlap 1 --suffix .jpg[Q=82]

COPY . .
RUN npm run build      # emits /app/dist including public/tiles

# ---- Stage 2: serve (tiny) ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

The `vips dzi` command produces `public/tiles/track.dzi` + `public/tiles/track_files/`; OSD loads `/tiles/track.dzi`. Vite copies `public/` into `dist/`.

### nginx.conf

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  add_header X-Robots-Tag "noindex, nofollow" always;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /tiles/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
    add_header X-Robots-Tag "noindex, nofollow" always;
  }

  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### robots.txt + meta

`robots.txt`:

```
User-agent: *
Disallow: /
```

Also add `<meta name="robots" content="noindex, nofollow">` in `index.html`. (Best-effort "no index" - the site is still reachable by anyone with the URL, as requested.)

### compose.yml

> **Adjust to the user's Traefik install:** the `Host()` rule, the `entrypoints` name, the `certresolver` name, and the external network name all depend on their existing setup.

```yaml
services:
  track-map:
    build: .
    image: track-map:latest
    container_name: track-map
    restart: unless-stopped
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.trackmap.rule=Host(`track.example.com`)"
      - "traefik.http.routers.trackmap.entrypoints=websecure"
      - "traefik.http.routers.trackmap.tls.certresolver=letsencrypt"
      - "traefik.http.services.trackmap.loadbalancer.server.port=80"

networks:
  traefik:
    external: true
```

---

## 12. Build/run commands

- Dev (needs tiles generated once locally): `vips dzi assets/track.jpg public/tiles/track --tile-size 256 --overlap 1 --suffix .jpg[Q=82]` then `npm run dev`.
- Prod: handled entirely by the Dockerfile.

---

## 13. Acceptance checklist

- [ ] Map loads fast on mobile; low-res overview appears almost immediately, tiles stream in on zoom.
- [ ] Pinch-zoom + flick/momentum pan on touch; wheel-zoom + drag-pan on desktop. No double-tap zoom.
- [ ] Racing line and other vector layers stay crisp at max zoom and stay aligned to the background.
- [ ] FAB drags freely and snaps to the nearest corner; position persists across reloads.
- [ ] Panel: per-layer visibility toggle + opacity slider, all-on/off, reset view, share. Bottom sheet on mobile, side panel on desktop.
- [ ] Layer toggles cross-fade smoothly; panel slides; nothing else animates.
- [ ] Minimap visible; double-clicking it resets the view; reset button also works.
- [ ] View (center+zoom), layer states, and FAB corner all persist in localStorage.
- [ ] Share button shows a scannable QR of the page URL + copy button.
- [ ] Installable PWA; previously viewed tiles work offline.
- [ ] `noindex` header, meta, and robots.txt present.
- [ ] `docker build` succeeds; container serves on port 80; Traefik labels present (placeholders flagged for the user to edit).

```

```
