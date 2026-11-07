# Track Map Viewer

A mobile-first deep-zoom race track map viewer for HPDE instructors to share with students. Displays a high-res track photo as a tiled background with toggleable SVG vector overlays - racing line, braking zones, apexes, corner numbers, etc. Installable as a PWA, works offline after first view, and self-hosts via Docker.

## Features

- **Deep zoom** - pan and pinch-zoom a high-res track photo without janking on mobile
- **Vector layers** - racing line and other paths stay crisp at any zoom level
- **Layer panel** - toggle visibility and adjust opacity per layer; bottom sheet on mobile, side panel on desktop
- **Draggable FAB** - floating button snaps to any corner; position persists
- **Several tracks** - one address per track (`/mytrack`), switch in the Options panel
- **Share** - QR code modal of the page URL
- **PWA** - installable, works fully offline after first visit
- **No index** - robots.txt + headers keep the page off search engines

## Quick Start (local dev)

**Prerequisites:** Node.js 20+

```bash
npm install
npm run tiles   # tile the track photos once (needs libvips)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) (or the next available port if 5173 is taken).

## Adding a Track

Each track is a folder under `tracks/`; the folder name is its address (`tracks/mytrack/` is served at `/mytrack`). A track list appears in the Options panel once there are two or more.

1. **Create `tracks/mytrack/`** with the high-res photo as `image.jpg` (or `.png` / `.webp`). No Git LFS needed; it's committed as a normal file.

2. **Add `tracks/mytrack/track.json`** - the track document (full format in `src/trackDoc.ts`). Coordinates are photo pixels:

   ```json
   {
   	"schema": 1,
   	"slug": "mytrack",
   	"name": { "en": "My Track", "fr": "Mon circuit" },
   	"image": { "width": 4500, "height": 8192 },
   	"metersPerPixel": 0.19,
   	"lines": [],
   	"zones": [],
   	"markers": []
   }
   ```

   - `image` must match the photo's real pixel size (the build checks it).
   - `metersPerPixel` sets the drawing scale and makes 1x replay real time.
   - Racing lines go in `lines` as `{ "id", "name", "nodes": [{ "id", "x", "y" }, ...] }` (at least 2 nodes), in the direction of travel; the first node is the lap start. A node without `in`/`out` handles is smoothed automatically; `kmh` on a node sets the replay speed there.
   - Mistakes in track.json are printed in the `npm run dev` terminal (the track is left out until fixed), and `npm run build` refuses them.

3. **Generate tiles** - requires [libvips](https://www.libvips.org/install.html):

   ```bash
   npm run tiles
   ```

4. Run `npm run dev` and open `/mytrack`. Edits to `track.json` show on reload.

The track editor below writes these same files, so you rarely need to edit them by hand. (`src/import/inkscape.ts` converted the original Inkscape art into the Tremblant track.)

## Track editor

Run `npm run dev` and open [http://localhost:5173/admin](http://localhost:5173/admin). Pick a track, or choose a photo to start a new one.

- **Select** (V): click a point, zone or marker to select it and drag it. Dragging a point's round handles shapes the curve (hold Alt for a sharp corner). F zooms to the selection, Delete removes it, Ctrl+Z / Ctrl+Y undo and redo.
- **Line points** (P): click on the line to add a point, or beside the selected point to add the next one. **New line** (panel) draws a line from scratch: click its points in driving order, then Done.
- **Speeds**: select a point and type its km/h in the panel. The replay accelerates evenly between points with a speed. Speeds and the lap time appear only in the editor, never in the viewer.
- **Braking zone** (B): click where braking starts on the line, then where it ends. **Passing zone** (G): click along the track, then Done. **Marker** (M): pick an icon from the palette, then click the map. Select a marker to swap its icon.
- **Track** (panel): name, web address (new tracks only), lap length (sets the map scale), north. **Link only** hides the track from the track list while its web address and QR code keep working.
- Edits are kept as a draft in this browser until you Save. **Preview** opens the draft in the viewer.
- **On this machine under `npm run dev`**, Save writes straight into `tracks/<slug>/` (a new photo is tiled right away, which needs libvips like `npm run tiles`).
- **Anywhere else** (another device on the LAN, a deployed site), Save downloads a zip instead: unzip it at the repo root and run `npm run tiles` if the photo changed.
- `/admin` is open on every deployment. It only works in the visitor's own browser and can't change anything on the server.

## Publishing tracks

From `main`, run `npm run publish-tracks` (add `-- --dry-run` to rehearse). It checks that everything builds, commits `tracks/`, tags the next version and pushes; the tag builds the Docker image. When the build finishes, pull the new image in your deployment.

A few things are plain file edits, followed by `npm run publish-tracks`:

- **Delete a track:** delete `tracks/<slug>/`.
- **Replace a photo:** overwrite `tracks/<slug>/image.jpg` with an image of the same size (points are stored in image pixels).
- **Change a web address:** rename `tracks/<slug>/` and set the same `slug` in its `track.json`. Old links and QR codes stop working.

## Project Structure

```
tracks/<slug>/            # one folder per track: track.json + image.jpg
public/
  config.json             # app-wide settings: title, layer toggles
  icons/                  # PWA icons
  tracks/                 # generated DZI tiles (gitignored)
scripts/tiles.mjs         # tiles every track image (libvips)
scripts/publish.mjs       # commits tracks/, tags the next version, pushes
vite-tracks.ts            # serves / validates / emits the track documents
src/
  main.ts                 # bootstrap: pick the track from the URL
  trackDoc.ts             # track document format
  trackRender.ts          # track document -> SVG overlay
  viewer.ts               # OpenSeadragon init + SVG overlay
  layers.ts               # options panel UI
  replay*.ts              # lap replay
  fab.ts                  # draggable floating action button
  share.ts                # QR modal
  state.ts                # localStorage persistence
  style.css
```

## Build Commands

| Command           | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `npm run tiles`   | Generate DZI tiles for every track image (requires vips)       |
| `npm run dev`     | Dev server with hot reload                                     |
| `npm run build`   | Production build → `dist/` (fails on an invalid track.json)   |
| `npm run preview` | Preview production build (tests PWA/SW)                        |
| `npm run publish-tracks` | Commit `tracks/`, tag the next version and push (from `main`) |

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

The published image bundles the Mont-Tremblant map. To host other tracks, add them (see [Adding a Track](#adding-a-track)) and build from source - the Dockerfile runs the whole pipeline (libvips tiling + Vite build) in one step:

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
