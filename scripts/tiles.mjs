#!/usr/bin/env node
/*
 * Deep Zoom tiles for every track image: tracks/<slug>/image.jpg ->
 * public/tracks/<slug>/tiles-<hash>.dzi (+ _files/). The hash covers the image and the
 * tiling settings, so browsers and the service worker (which cache tiles forever) never
 * mix two pyramids, and an unchanged image is never re-tiled. tiles.json records which
 * image the tiles are of, for the build to check. Needs libvips (`vips` on PATH) when tiling.
 * Track documents are handled by the Vite plugin (vite-tracks.ts), not here.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "tracks";
const OUT = join("public", "tracks");
const IMAGE_NAMES = ["image.jpg", "image.jpeg", "image.png", "image.webp"];
const DZSAVE_ARGS = ["--tile-size", "256", "--overlap", "1", "--suffix", ".jpg[Q=82]"];

function fail(msg) {
	console.error(`tiles: ${msg}`);
	process.exit(1);
}

const sha1 = (data) => createHash("sha1").update(data).digest("hex");

// Windows: an indexer or antivirus briefly holding a fresh file makes rm/rename fail with EPERM/EBUSY.
function retry(fn) {
	for (let attempt = 0; ; attempt++) {
		try {
			return fn();
		} catch (e) {
			if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1));
		}
	}
}
const remove = (path) => rmSync(path, { recursive: true, force: true, maxRetries: 5 });

if (!existsSync(SRC)) fail(`no ${SRC}/ folder`);
mkdirSync(OUT, { recursive: true });

const slugs = [];
for (const entry of readdirSync(SRC, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const slug = entry.name;
	const dir = join(SRC, slug);
	// Case-insensitive, so image.JPG behaves the same on Windows and in Docker (Linux).
	const imageName = readdirSync(dir).find((n) => IMAGE_NAMES.includes(n.toLowerCase()));
	if (!imageName) {
		if (existsSync(join(dir, "track.json"))) fail(`${dir}: track.json but no image (${IMAGE_NAMES.join(" / ")})`);
		continue;
	}
	slugs.push(slug);

	const imagePath = join(dir, imageName);
	const imageHash = sha1(readFileSync(imagePath));
	const tiles = `tiles-${sha1(imageHash + DZSAVE_ARGS.join(" ")).slice(0, 10)}`;
	const outDir = join(OUT, slug);
	mkdirSync(outDir, { recursive: true });
	const done = existsSync(join(outDir, `${tiles}.dzi`));

	// Drop older pyramids and half-written runs (a _files folder without its .dzi).
	for (const name of readdirSync(outDir)) {
		const keep = done && (name === `${tiles}.dzi` || name === `${tiles}_files` || name === "tiles.json");
		if (!keep && (name.startsWith("tiles") || name.startsWith(".tmp-"))) remove(join(outDir, name));
	}

	if (!done) {
		// Tile under a temp name, then rename: the .dzi only appears once the whole pyramid is there.
		console.log(`tiles: tiling ${imagePath} (this takes a moment)`);
		const tmp = join(outDir, `.tmp-${tiles}`);
		const res = spawnSync("vips", ["dzsave", imagePath, tmp, ...DZSAVE_ARGS], { stdio: "inherit" });
		if (res.error || res.status !== 0) {
			fail(`vips dzsave failed for ${imagePath}${res.error ? ` (${res.error.message}; is libvips installed?)` : ""}`);
		}
		retry(() => renameSync(`${tmp}_files`, join(outDir, `${tiles}_files`)));
		retry(() => renameSync(`${tmp}.dzi`, join(outDir, `${tiles}.dzi`)));
	}
	writeFileSync(join(outDir, "tiles.json"), `${JSON.stringify({ dzi: `${tiles}.dzi`, image: imageHash })}\n`);
}

// Tracks removed from tracks/ lose their tiles too.
for (const entry of readdirSync(OUT, { withFileTypes: true })) {
	if (entry.isDirectory() && !slugs.includes(entry.name)) remove(join(OUT, entry.name));
}
console.log(`tiles: ${slugs.join(", ") || "no track images found"}`);
