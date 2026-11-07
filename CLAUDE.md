# Track Map Viewer

Mobile-first deep-zoom race track map viewer. Tiled raster background (DZI) with SVG vector layers (racing line, braking zones, etc.) drawn at runtime from a per-track JSON document. Several tracks, one URL each (`/<slug>`). Self-hosted PWA via Docker/Portainer + Traefik.

**Read `HANDOFF.md` when you start a session:** machine setup, how to release, product decisions, next work, and the owner's pending tests (remind them until they clear the list).

## Stack

- **Vite 5 + vanilla TypeScript** - no UI framework
- **OpenSeadragon 4.x** - tiled viewer (`/tracks/<slug>/tiles-<hash>.dzi`)
- **qrcode** - QR share modal
- **vite-plugin-pwa** - service worker, offline, installable
- **libvips** - tile generation (`npm run tiles`, and at Docker build)

## Project Structure

```
tracks/<slug>/            # one folder per track (the folder name is the URL: /<slug>)
  track.json              # the track document (source of truth, see src/trackDoc.ts)
  image.jpg               # background photo (committed normally, NOT Git LFS) - tiled, never shipped
  source.svg              # (Tremblant only) original Inkscape art the track.json was converted from
public/
  config.json             # app-wide: title, layer toggles (ids = overlay group ids)
  icons/                  # PWA icons (192, 512, maskable)
  tracks/                 # generated tiles - gitignored, built by `npm run tiles`
scripts/tiles.mjs         # tracks/*/image.* -> public/tracks/<slug>/tiles-<hash>.dzi (+ _files/)
scripts/publish.mjs       # npm run publish-tracks: checks the build, commits tracks/, tags, pushes (main only)
vite-tracks.ts            # Vite plugin: serves tracks/*/track.json + /tracks/index.json live in dev,
                          #   validates and emits them at build
src/
  trackDoc.ts             # track document types + readTrackDoc (schema version, compat note)
  trackRender.ts          # track document -> overlay <g> groups (same ids the layer toggles use)
  lineGeometry.ts         # line nodes (bezier handles / auto-smooth) -> path data, flattened polylines
  markerIcons.ts          # built-in marker icons (Marker.icon ids), drawn at Tremblant's scale
  import/inkscape.ts      # Inkscape SVG -> track document (browser-only; converted Tremblant, no UI)
  editor/                 # /admin track editor (own lazy chunk): ops.ts pure doc edits, anchors.ts,
                          #   store.ts undo/redo, canvas.ts + interaction.ts map, panel.ts, drafts.ts
                          #   (IndexedDB), serialize.ts (stable track.json layout), save.ts
  main.ts                 # bootstrap: config, track index, pick track from the URL, init all modules
  viewer.ts               # OSD init + SVG overlay via addOverlay, line switching
  layers.ts               # options panel: track/line pickers, layer visibility/opacity
  replay*.ts              # lap replay (car, speed timeline, follow/fixed camera)
  state.ts                # localStorage persistence (key: trackmap.state)
  shareState.ts           # ?s= share-link format (versioned, compat contract)
```

## Key Implementation Details

### Tracks
- A track is `tracks/<slug>/track.json` + `image.jpg`. Coordinates are image pixels; `metersPerPixel` scales line widths and makes 1x replay real time.
- Lines: closed loops, node order = travel direction, first node = lap start. Nodes may carry `kmh` (replay speeds; never shown in the UI).
- Braking zones are attached to a line (ends snapped by projection at render); passing zones are free open paths; markers carry optional imported `svg` art (sanitized at render).
- `/` opens the visitor's last track (`state.lastTrack`), else the only listed track, else a first-visit chooser; there is no default track. Bare `/?s=` links predate per-track URLs and always mean Tremblant.
- `unlisted: true` (the editor's Link only) hides a track from the chooser and the menu's track list; its `/<slug>` link still opens it. It is not private: `/tracks/index.json` still names it.
- Slugs can't be `assets`, `icons`, `tracks`, `tiles`, `admin`, ... (they're app paths; see RESERVED_SLUGS in src/trackDoc.ts). The build validates every track.json (trackDocProblems) and that its tiles are of the current image (tiles.json).

### Tiling
- `npm run tiles` (needs libvips on PATH) tiles every `tracks/*/image.*` into `public/tracks/<slug>/tiles-<hash>`; the hash of the image names the folder, so an unchanged image is never re-tiled and cached tiles never go stale. Run it once before `npm run dev`, and after changing an image.
- Alpine's vips-tools 8.17+ uses `vips dzsave` (not `vips dzi`).

### Track editor (/admin)
- Edits are immutable ops on the TrackDoc (`editor/ops.ts`); after editing a line, `anchorLine` re-places its braking zone ends and cars at the same segment + curve t so they follow the line.
- `serializeTrackDoc` must stay byte-identical to prettier's output with every non-empty object expanded (how all committed track.json files are laid out): saving an unchanged track produces no git diff. A hand-collapsed `{ ... }` gets expanded on its first editor save.
- Drafts autosave to IndexedDB per slug (`new-<time>` for unsaved new tracks, with the photo blob); `/<slug>?draft=<id>` previews one in the viewer.
- Dev-only save endpoint in vite-tracks.ts (`configureServer`, never in the build): `POST /__editor/save` `{ slug, json, image?, create? }` validates like the build (`create`: refused with 409 if the folder exists), writes `tracks/<slug>/track.json` (+ `image.jpg`, then runs scripts/tiles.mjs); `GET /__editor/ping` returns `canSave`. Loopback, localhost-Host, same-origin requests only (`npm run dev` listens on the LAN).
- `/admin` is open on every deployment on purpose: a deployed site is static files, so the editor only touches the visitor's own browser (drafts, zip download). Only the owner's `npm run publish-tracks` (git push + tag) changes what's published; there is no auth to maintain. Deleting a track, replacing a photo or changing a slug are manual file edits (see README).

### OSD SVG Overlay
`viewer.addOverlay()` **must** be called inside the OSD `"open"` event handler. The overlay's layer groups are created once and refilled on a line switch (layer toggles and upright billboarding keep their elements; `upright.refresh()` re-scans).

### Deploy
A prebuilt image is published to GHCR (`ghcr.io/apatenaude/track-map`) by `.github/workflows/release.yml`, which builds + pushes on a pushed `v*` tag (e.g. `git tag v1.1.0 && git push origin v1.1.0`). Deployments pull the image; they don't build.
- `compose.yml` - the public "run anywhere" file (pulls `:latest`, publishes `:8080`).
- `compose.traefik.yml` - the owner's **private, gitignored** Portainer/Traefik stack (TLS + host routing, self-hosted Umami). Not part of the public repo.
- The Dockerfile copies only `tracks/*/image.*` before tiling (`COPY --parents`, dockerfile syntax 1.7-labs), so editing a track.json doesn't re-tile.

**Images are NOT in Git LFS** - committed as normal files, so a plain `git clone` / Docker git-context build gets the real image (an LFS pointer would break `vips dzsave`).

## Dev Commands

```bash
npm run tiles        # Tile track images with local vips (once, and after an image changes)
npm run dev          # Vite dev server (track.json edits show on reload)
npm run build        # Production build -> dist/ (fails on an invalid track.json)
npm run preview      # Preview production build (tests PWA/SW)
npm run publish-tracks  # From main: commit tracks/, tag the next version, push (-- --dry-run to rehearse)
```

## Build

```bash
docker build -t track-map .
docker run -p 8080:80 track-map   # Serves on localhost:8080
```

## PWA / Service Worker

- Precaches the app shell, config and icons; `tracks/**` is excluded on purpose.
- `/tracks/index.json` is NetworkFirst (3 s), so a newly added track is seen right after a deploy; track documents (`track.json?v=<hash>`) and tiles (`/tracks/*/tiles-*`) are content-addressed, CacheFirst, no expiry.
- First visit: the SW takes control after the track loaded, so main.ts warmOfflineCache re-fetches the list, the document and the overview tiles through it.
- SW only active in production build - use `npm run preview` to test offline behavior
