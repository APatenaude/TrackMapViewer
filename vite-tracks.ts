import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { readTrackDoc, trackDocProblems, type TrackIndexEntry } from "./src/trackDoc";

/*
 * Track documents: tracks/<slug>/track.json -> /tracks/<slug>/track.json + /tracks/index.json.
 * Dev serves them live from tracks/ (edits show on reload); build validates and emits them.
 * Tiles come from `npm run tiles` (scripts/tiles.mjs) into public/tracks/.
 */

const SRC = "tracks";
const TILES = join("public", "tracks");
const IMAGE_NAMES = ["image.jpg", "image.jpeg", "image.png", "image.webp"];

interface LoadedTrack {
	entry: TrackIndexEntry;
	json: string;
}

const sha1 = (s: string | Buffer): string => createHash("sha1").update(s).digest("hex");

/** The track's tiles, if they are of its current image (tiles.json is written by scripts/tiles.mjs). */
function tilesFor(slug: string): { dzi: string } | string {
	const dir = join(SRC, slug);
	const image = readdirSync(dir).find((n) => IMAGE_NAMES.includes(n.toLowerCase()));
	if (!image) return `no image (${IMAGE_NAMES.join(" / ")})`;
	const stampPath = join(TILES, slug, "tiles.json");
	if (!existsSync(stampPath)) return `no tiles in ${join(TILES, slug)} (run npm run tiles)`;
	const stamp = JSON.parse(readFileSync(stampPath, "utf8")) as { dzi: string; image: string };
	if (stamp.image !== sha1(readFileSync(join(dir, image))) || !existsSync(join(TILES, slug, stamp.dzi))) {
		return `tiles are out of date for ${image} (run npm run tiles)`;
	}
	return { dzi: stamp.dzi };
}

function loadTracks(): { tracks: LoadedTrack[]; errors: string[] } {
	const tracks: LoadedTrack[] = [];
	const errors: string[] = [];
	if (!existsSync(SRC)) return { tracks, errors: [`no ${SRC}/ folder`] };
	for (const dir of readdirSync(SRC, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const slug = dir.name;
		const file = join(SRC, slug, "track.json");
		if (!existsSync(file)) continue;
		try {
			const json = readFileSync(file, "utf8");
			const doc = readTrackDoc(JSON.parse(json));
			const problems = trackDocProblems(doc);
			if (doc.slug !== slug) problems.push(`slug "${doc.slug}" must match its folder "${slug}"`);
			const tiles = tilesFor(slug);
			if (typeof tiles === "string") problems.push(tiles);
			else {
				const xml = readFileSync(join(TILES, slug, tiles.dzi), "utf8");
				const w = Number(/Width="(\d+)"/.exec(xml)?.[1]);
				const h = Number(/Height="(\d+)"/.exec(xml)?.[1]);
				if (w !== doc.image.width || h !== doc.image.height) {
					problems.push(`image is ${w}x${h} but track.json says ${doc.image.width}x${doc.image.height}`);
				}
			}
			if (problems.length || typeof tiles === "string") {
				errors.push(...problems.map((p) => `${file}: ${p}`));
				continue;
			}
			tracks.push({
				json,
				entry: {
					slug,
					name: doc.name,
					// ?v= follows the content: the URL can be cached forever and a new deploy still shows.
					doc: `/tracks/${slug}/track.json?v=${sha1(json).slice(0, 8)}`,
					tiles: `/tracks/${slug}/${tiles.dzi}`,
				},
			});
		} catch (e) {
			errors.push(`${file}: ${(e as Error).message}`);
		}
	}
	tracks.sort((a, b) => a.entry.slug.localeCompare(b.entry.slug));
	return { tracks, errors };
}

export function tracksPlugin(): Plugin {
	return {
		name: "track-map-tracks",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				if (!path.startsWith("/tracks/") || !path.endsWith(".json")) return next();
				const { tracks, errors } = loadTracks();
				for (const e of errors) server.config.logger.warn(`tracks: ${e}`);
				let body: string | undefined;
				if (path === "/tracks/index.json") body = JSON.stringify(tracks.map((t) => t.entry));
				else body = tracks.find((t) => path === `/tracks/${t.entry.slug}/track.json`)?.json;
				if (body === undefined) return next();
				res.setHeader("Content-Type", "application/json");
				res.setHeader("Cache-Control", "no-store");
				res.end(body);
			});
		},
		generateBundle() {
			const { tracks, errors } = loadTracks();
			if (errors.length) this.error(`tracks:\n  ${errors.join("\n  ")}`);
			if (tracks.length === 0) this.error(`tracks: none found in ${SRC}/`);
			for (const t of tracks) {
				this.emitFile({ type: "asset", fileName: `tracks/${t.entry.slug}/track.json`, source: t.json });
			}
			this.emitFile({
				type: "asset",
				fileName: "tracks/index.json",
				source: `${JSON.stringify(tracks.map((t) => t.entry))}\n`,
			});
		},
	};
}
