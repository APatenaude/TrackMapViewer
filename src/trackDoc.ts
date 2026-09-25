import type { LocalizedString } from "./types.js";

/*
 * Track document: the source of truth for one track (tracks/<slug>/track.json).
 * The viewer draws the overlay SVG from it at runtime; the editor writes it.
 *
 * COMPATIBILITY: exported files live in git and in people's hands. Any change to
 * the shape or meaning of a field must bump TRACK_SCHEMA and keep readTrackDoc()
 * able to read every older schema.
 *
 * Coordinates are background-image pixels (origin top-left, y down).
 */

export const TRACK_SCHEMA = 1;

/** [dx, dy] in image px. */
export type Vec = [number, number];

export interface LineNode {
	id: string;
	x: number;
	y: number;
	/** Bezier handle arriving at the node, relative to it. Omitted (with `out`) = smooth, auto-computed. */
	in?: Vec;
	/** Bezier handle leaving the node, relative to it. */
	out?: Vec;
	/** Speed here in km/h, interpolated with constant accel/braking. Authoring data: never shown in the UI. */
	kmh?: number;
}

/** A closed racing line. Node order is the direction of travel; the first node is the lap start. */
export interface RacingLine {
	id: string;
	name: LocalizedString;
	nodes: LineNode[];
}

/** A stretch of one racing line where the car brakes; shown with that line only. */
export interface BrakingZone {
	id: string;
	kind: "braking";
	line: string;
	/** Ends, snapped to the nearest spot on the line when drawn. Travel runs from -> to. */
	from: Vec;
	to: Vec;
	/** Opacity along the zone as [offset 0..1 from `from`, opacity 0..1]; omitted = the default fade. */
	stops?: [number, number][];
}

/** Where passing is allowed: a free open path beside the track, drawn in the direction of travel. */
export interface PassingZone {
	id: string;
	kind: "passing";
	nodes: LineNode[];
	/** Direction chevrons at these fractions along the path. */
	arrows?: number[];
}

export type Zone = BrakingZone | PassingZone;
export type ZoneKind = Zone["kind"];

export type MarkerKind = "corner" | "label" | "apex" | "reference" | "crest" | "car";

export interface Marker {
	id: string;
	kind: MarkerKind;
	x: number;
	y: number;
	/** Degrees clockwise. Ignored for markers on a line (`line` + car), which aim along it. */
	rotation?: number;
	/** corner: badge text ("1", "12a"); label: the caption. */
	text?: string;
	/** corner: badge diameter; label: font size; others: symbol scale (1 = built-in size). Image px. */
	size?: number;
	/** Imported artwork, centred on (0,0) in image px. Omitted = the kind's built-in symbol. */
	svg?: string;
	/** Belongs to this line (shown only with it). Omitted = shown with every line. */
	line?: string;
}

export interface TrackReplayConfig {
	/** Open replay in Follow mode rather than Fixed. Default true. */
	follow?: boolean;
	/** Meters across the short side of the map area above the replay bar, when Follow first zooms in. Default 170. */
	viewSpanM?: number;
	/** Start with heading-up on. Default false. */
	followOrient?: boolean;
	/** With heading-up on, the car sits this far below the centre (fraction of the map area, 0-0.4). Default 0.25. */
	lookAhead?: number;
}

export interface TrackDoc {
	schema: number;
	/** URL segment and folder name (lowercase, a-z 0-9 -). */
	slug: string;
	name: LocalizedString;
	/** Background image size in px (must match the tiled JPG). */
	image: { width: number; height: number };
	/** Image scale; with speeds set, 1x replay is real time. */
	metersPerPixel?: number;
	/** Bearing of true north in the image (deg clockwise from image-up). Aims the compass needle only. */
	northOffset?: number;
	lines: RacingLine[];
	zones: Zone[];
	markers: Marker[];
	replay?: TrackReplayConfig;
}

/** Validate + upgrade a parsed track file. Throws with a readable message on anything unusable. */
export function readTrackDoc(raw: unknown): TrackDoc {
	const doc = raw as Partial<TrackDoc> | null;
	if (!doc || typeof doc !== "object") throw new Error("track file is not an object");
	if (doc.schema !== TRACK_SCHEMA) throw new Error(`unsupported track schema ${String(doc.schema)}`);
	if (!doc.slug || !doc.image?.width || !doc.image?.height) throw new Error("track file needs slug and image size");
	return {
		...doc,
		lines: doc.lines ?? [],
		zones: doc.zones ?? [],
		markers: doc.markers ?? [],
	} as TrackDoc;
}

/** Track URLs are /<slug>: lowercase, and not one of the app's own paths. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const RESERVED_SLUGS = new Set([
	"assets",
	"icons",
	"tracks",
	"tiles",
	"admin",
	"index",
	"config",
	"manifest",
	"workbox",
]);

const MARKER_KINDS = new Set<string>(["corner", "label", "apex", "reference", "crest", "car"]);
const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);

/** Everything wrong with a document that readTrackDoc lets through (empty = fine). The build refuses any. */
export function trackDocProblems(doc: TrackDoc): string[] {
	const out: string[] = [];
	if (!SLUG_RE.test(doc.slug) || RESERVED_SLUGS.has(doc.slug)) {
		out.push(`slug "${doc.slug}" must be lowercase a-z, 0-9, dashes and not one of ${[...RESERVED_SLUGS].join(", ")}`);
	}
	const nodesProblem = (nodes: unknown, what: string, min: number): void => {
		if (!Array.isArray(nodes) || nodes.length < min) {
			out.push(`${what} needs at least ${min} nodes`);
			return;
		}
		const bad = nodes.findIndex(
			(n: LineNode) =>
				!n ||
				!num(n.x) ||
				!num(n.y) ||
				(n.in && !vec(n.in)) ||
				(n.out && !vec(n.out)) ||
				(n.kmh !== undefined && !num(n.kmh)),
		);
		if (bad >= 0) out.push(`${what}: node ${bad} needs numeric x, y (and in/out/kmh when set)`);
		if (new Set(nodes.map((n: LineNode) => n?.id)).size !== nodes.length) out.push(`${what} has duplicate node ids`);
	};
	const lineIds = new Set(doc.lines.map((l) => l.id));
	if (lineIds.size !== doc.lines.length) out.push("duplicate line ids");
	for (const l of doc.lines) nodesProblem(l.nodes, `line ${l.id}`, 2);
	for (const z of doc.zones as Partial<Zone & { kind: string }>[]) {
		if (z.kind === "braking") {
			if (!lineIds.has(z.line ?? "")) out.push(`zone ${z.id}: unknown line ${z.line}`);
			if (!vec(z.from) || !vec(z.to)) out.push(`zone ${z.id}: from/to must be [x, y]`);
		} else if (z.kind === "passing") {
			nodesProblem(z.nodes, `zone ${z.id}`, 2);
		} else {
			out.push(`zone ${z.id}: unknown kind "${z.kind}"`);
		}
	}
	for (const m of doc.markers) {
		if (!MARKER_KINDS.has(m.kind)) out.push(`marker ${m.id}: unknown kind "${m.kind}"`);
		if (!num(m.x) || !num(m.y)) out.push(`marker ${m.id}: needs numeric x, y`);
		if (m.line && !lineIds.has(m.line)) out.push(`marker ${m.id}: unknown line ${m.line}`);
	}
	const ids = [...doc.zones.map((z) => z.id), ...doc.markers.map((m) => m.id)];
	if (new Set(ids).size !== ids.length) out.push("duplicate zone/marker ids");
	return out;
}

/** One entry of the generated tracks/index.json. */
export interface TrackIndexEntry {
	slug: string;
	name: LocalizedString;
	/** URL of the track document. */
	doc: string;
	/** URL of the DZI tile source (folder name carries the image hash, so a new image never hits old cached tiles). */
	tiles: string;
}
