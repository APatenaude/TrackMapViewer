import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import type { Logger, Plugin } from "vite";
import {
	readTrackDoc,
	RESERVED_SLUGS,
	SLUG_RE,
	slugProblem,
	trackDocProblems,
	type TrackDoc,
	type TrackIndexEntry,
} from "./src/trackDoc";

/*
 * Track documents: tracks/<slug>/track.json -> /tracks/<slug>/track.json + /tracks/index.json.
 * Dev serves them live from tracks/ (edits show on reload); build validates and emits them.
 * Tiles come from `npm run tiles` (scripts/tiles.mjs) into public/tracks/.
 * Dev also takes the editor's saves (POST /__editor/save); that endpoint only exists in the dev server.
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

function sizeProblem(slug: string, dzi: string, doc: TrackDoc): string | undefined {
	const xml = readFileSync(join(TILES, slug, dzi), "utf8");
	const w = Number(/Width="(\d+)"/.exec(xml)?.[1]);
	const h = Number(/Height="(\d+)"/.exec(xml)?.[1]);
	if (w !== doc.image.width || h !== doc.image.height) {
		return `image is ${w}x${h} but track.json says ${doc.image.width}x${doc.image.height}`;
	}
	return undefined;
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
				const size = sizeProblem(slug, tiles.dzi, doc);
				if (size) problems.push(size);
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
					...(doc.unlisted ? { unlisted: true } : {}),
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

// ---- Editor save (dev server only) ----

const MAX_BODY_MB = 150;
const MAX_BODY = MAX_BODY_MB * 2 ** 20;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface Save {
	slug: string;
	json: string;
	doc: TrackDoc;
	image?: Buffer;
	/** A new track: refused if tracks/<slug>/ already exists. */
	create: boolean;
}

interface Refused {
	error: string;
	problems?: string[];
}

function send(res: ServerResponse, status: number, body: object): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

function parseUrl(url: string): URL | undefined {
	try {
		return new URL(url);
	} catch {
		return undefined;
	}
}

/**
 * Why this request may not write into the repo (undefined = it may). `npm run dev` listens on the LAN, and
 * any site open in the owner's browser can post to localhost: hence loopback only, a localhost Host header
 * (DNS rebinding) and a same-origin Origin whenever the browser sends one.
 */
function saveRefusal(req: IncomingMessage): string | undefined {
	if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return "direct save only works on the machine running npm run dev";
	const host = parseUrl(`http://${req.headers.host ?? ""}`);
	if (!host || !LOCAL_HOSTS.has(host.hostname))
		return "direct save only works with the editor opened at http://localhost";
	const origin = req.headers.origin;
	if (origin !== undefined && parseUrl(origin)?.host !== host.host) return `requests from ${origin} may not save`;
	return undefined;
}

/** The body, or undefined past MAX_BODY_MB (the rest is still drained so the client reads the 413). */
function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
	return new Promise((resolve, reject) => {
		let chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MAX_BODY) chunks.push(chunk);
			else chunks = [];
		});
		req.on("end", () => resolve(size <= MAX_BODY ? Buffer.concat(chunks) : undefined));
		req.on("error", reject);
		req.on("close", () => {
			if (!req.complete) reject(new Error("request aborted"));
		});
	});
}

function checkSave(raw: Buffer): Save | Refused {
	let body: unknown;
	try {
		body = JSON.parse(raw.toString("utf8"));
	} catch {
		body = undefined;
	}
	const { slug, json, image, create } = (body ?? {}) as Record<string, unknown>;
	if (
		typeof slug !== "string" ||
		typeof json !== "string" ||
		(image !== undefined && typeof image !== "string") ||
		(create !== undefined && typeof create !== "boolean")
	) {
		return {
			error: 'the body must be JSON { "slug": string, "json": string, "image"?: base64 JPEG, "create"?: boolean }',
		};
	}
	if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return { error: slugProblem(slug) };
	let doc: TrackDoc;
	let problems: string[];
	try {
		doc = readTrackDoc(JSON.parse(json));
		problems = trackDocProblems(doc);
	} catch (e) {
		return { error: `track.json: ${(e as Error).message}` };
	}
	if (doc.slug !== slug) problems.push(`slug "${doc.slug}" must match the track being saved ("${slug}")`);
	if (problems.length) return { error: "track.json has problems", problems };
	if (image === undefined) return { slug, json, doc, create: create === true };
	// A FileReader data URL is accepted as is.
	const jpeg = Buffer.from(image.startsWith("data:") ? image.slice(image.indexOf(",") + 1) : image, "base64");
	if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) return { error: "image must be a base64-encoded JPEG" };
	return { slug, json, doc, image: jpeg, create: create === true };
}

// Windows: an indexer or antivirus briefly holding a fresh file makes rename/rm fail (as in scripts/tiles.mjs).
async function retry(fn: () => Promise<void>): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (e) {
			if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
			await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
		}
	}
}

async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
	const tmp = join(dirname(path), `.tmp-${randomBytes(4).toString("hex")}-${basename(path)}`);
	try {
		await writeFile(tmp, data);
		await retry(() => rename(tmp, path));
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

function runTiles(): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [join("scripts", "tiles.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding("utf8");
			stream.on("data", (text: string) => {
				output += text;
			});
		}
		child.on("error", (e) => resolve({ ok: false, output: `${output}${e.message}` }));
		child.on("close", (code) => resolve({ ok: code === 0, output }));
	});
}

/** Why the viewer would skip this track after the save (undefined = it shows). */
function showProblem(slug: string, doc: TrackDoc): string | undefined {
	try {
		const tiles = tilesFor(slug);
		return typeof tiles === "string" ? tiles : sizeProblem(slug, tiles.dzi, doc);
	} catch (e) {
		return (e as Error).message;
	}
}

// Saves run one at a time: two tiles.mjs runs at once would delete each other's half-written pyramids.
let saving: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
	const run = saving.then(fn);
	saving = run.catch(() => undefined);
	return run;
}

async function writeTrack(save: Save, logger: Logger): Promise<{ status: number; body: object }> {
	const dir = join(SRC, save.slug);
	const path = `${SRC}/${save.slug}/track.json`;
	// The editor's list of taken slugs can be stale (another tab, another new track saved since).
	if (save.create && existsSync(dir)) {
		return { status: 409, body: { error: `${SRC}/${save.slug}/ already exists: choose another web address.` } };
	}
	await mkdir(dir, { recursive: true });
	await writeAtomic(join(dir, "track.json"), save.json);
	if (save.image) {
		await writeAtomic(join(dir, "image.jpg"), save.image);
		// An older image.png/.webp would compete with it: tiles.mjs tiles whichever it lists first.
		for (const name of await readdir(dir)) {
			const lower = name.toLowerCase();
			if (IMAGE_NAMES.includes(lower) && lower !== "image.jpg") await retry(() => rm(join(dir, name)));
		}
		const run = await runTiles();
		const output = run.output.trim();
		if (!run.ok) {
			logger.error(output);
			const tail = output.split(/\r?\n/).filter(Boolean).slice(-15).join("\n");
			return {
				status: 500,
				body: {
					error: `${path} and image.jpg were saved, but tiling failed (fix it, then run npm run tiles):\n${tail}`,
					saved: true,
				},
			};
		}
		logger.info(output);
	}
	logger.info(`editor: saved ${path}${save.image ? " and image.jpg" : ""}`, { timestamp: true });
	const problem = showProblem(save.slug, save.doc);
	return {
		status: 200,
		body: {
			ok: true,
			tiled: save.image !== undefined,
			path,
			...(problem ? { warning: `saved, but the viewer skips this track until this is fixed: ${problem}` } : {}),
		},
	};
}

async function handleSave(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
	const refusal = saveRefusal(req);
	if (refusal) return send(res, 403, { error: refusal });
	const raw = await readBody(req);
	if (!raw) return send(res, 413, { error: `the request is over ${MAX_BODY_MB} MB` });
	const save = checkSave(raw);
	if ("error" in save) return send(res, 400, save);
	const { status, body } = await serialized(() => writeTrack(save, logger));
	send(res, status, body);
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
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				if (path === "/__editor/ping" && req.method === "GET") {
					return send(res, 200, { ok: true, canSave: saveRefusal(req) === undefined });
				}
				if (path !== "/__editor/save" || req.method !== "POST") return next();
				handleSave(req, res, server.config.logger).catch((e: Error) => {
					server.config.logger.error(`editor: save failed: ${e.message}`);
					if (!res.headersSent) send(res, 500, { error: e.message });
				});
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
