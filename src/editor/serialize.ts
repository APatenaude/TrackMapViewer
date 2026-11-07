import type { TrackDoc } from "../trackDoc.js";

/*
 * Writes track.json exactly as prettier (.prettierrc.json: tabs, 120 cols, json parser) lays it out, so an
 * editor save diffs only the values it changed and a later prettier run is a no-op.
 */

/** Scalars are finished JSON text. */
type Json = string | Json[] | JsonObject;
interface JsonObject {
	entries: [string, Json][];
}
type Conv = (v: unknown) => Json;

const PRINT_WIDTH = 120;
// prettier measures an indent tab as tabWidth columns (default 2), not 1 or the editor's 4
const TAB_WIDTH = 2;

const isObject = (v: Json): v is JsonObject => typeof v === "object" && !Array.isArray(v);

function scalar(v: unknown): string {
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "boolean") return String(v);
	if (typeof v !== "number" || !Number.isFinite(v)) return "null";
	// prettier rewrites 1e+21 as 1e21
	return String(v).replace("e+", "e");
}

function plain(v: unknown): Json {
	if (v === null || typeof v !== "object") return scalar(v);
	if (Array.isArray(v)) return v.map((x) => (x === undefined ? "null" : plain(x)));
	const entries: [string, Json][] = [];
	for (const [k, x] of Object.entries(v)) if (x !== undefined) entries.push([k, plain(x)]);
	return { entries };
}

/** Known keys first, in `fields` order; unknown keys keep their order after them. */
function record(fields: [string, Conv][]): Conv {
	const known = new Map(fields);
	return (v) => {
		if (!v || typeof v !== "object" || Array.isArray(v)) return plain(v);
		const own = new Map(Object.entries(v));
		const entries: [string, Json][] = [];
		for (const [k, conv] of fields) {
			const x = own.get(k);
			if (x !== undefined) entries.push([k, conv(x)]);
		}
		for (const [k, x] of own) if (!known.has(k) && x !== undefined) entries.push([k, plain(x)]);
		return { entries };
	};
}

const list =
	(conv: Conv): Conv =>
	(v) =>
		Array.isArray(v) ? v.map((x) => (x === undefined ? "null" : conv(x))) : plain(v);

function num(decimals: number): Conv {
	const f = 10 ** decimals;
	return (v) => {
		if (typeof v !== "number") return plain(v);
		const r = Math.round(v * f) / f;
		return scalar(r === 0 ? 0 : r);
	};
}

const coord = num(1);
const vec = list(coord);
const localized: Conv = (v) =>
	typeof v === "string"
		? scalar(v)
		: record([
				["en", plain],
				["fr", plain],
			])(v);
const lineNode = record([
	["id", plain],
	["x", coord],
	["y", coord],
	["in", vec],
	["out", vec],
	["kmh", num(0)],
]);
const brakingZone = record([
	["id", plain],
	["kind", plain],
	["line", plain],
	["from", vec],
	["to", vec],
	["stops", list(list(num(4)))],
]);
const passingZone = record([
	["id", plain],
	["kind", plain],
	["nodes", list(lineNode)],
	["arrows", list(num(2))],
]);
const zone: Conv = (v) => ((v as { kind?: unknown } | null)?.kind === "passing" ? passingZone(v) : brakingZone(v));
const marker = record([
	["id", plain],
	["kind", plain],
	["x", coord],
	["y", coord],
	["rotation", num(1)],
	["text", plain],
	["size", num(1)],
	["svg", plain],
	["icon", plain],
	["line", plain],
]);
const track = record([
	["schema", plain],
	["slug", plain],
	["name", localized],
	[
		"image",
		record([
			["width", plain],
			["height", plain],
		]),
	],
	["metersPerPixel", num(6)],
	["northOffset", num(1)],
	["unlisted", plain],
	[
		"lines",
		list(
			record([
				["id", plain],
				["name", localized],
				["nodes", list(lineNode)],
			]),
		),
	],
	["zones", list(zone)],
	["markers", list(marker)],
	[
		"replay",
		record([
			["follow", plain],
			["viewSpanM", plain],
			["followOrient", plain],
			["lookAhead", plain],
		]),
	],
]);

// Code points; prettier counts East Asian wide chars and emoji as 2, which only matters for string arrays.
const width = (s: string): number => [...s].length;

/*
 * Layout rules (prettier's, for input that already has every non-empty object expanded):
 * - a non-empty object is always expanded (prettier keeps an object expanded when `{` is followed by a newline);
 * - an array breaks when an element breaks, or when it has 2+ elements that are all arrays of 2+ elements;
 * - any other array stays on one line when it fits, counting the comma after it;
 * - an array of numbers that does not fit is filled (as many per line as fit), others get one element per line;
 * - a key and its value always share a line, so long strings are never moved or wrapped.
 */
const breaks = (v: Json): boolean =>
	typeof v === "string"
		? false
		: isObject(v)
			? v.entries.length > 0
			: v.some(breaks) || (v.length > 1 && v.every((x) => Array.isArray(x) && x.length > 1));

const flat = (v: Json): string =>
	typeof v === "string"
		? v
		: isObject(v)
			? v.entries.length
				? `{ ${v.entries.map(([k, x]) => `${JSON.stringify(k)}: ${flat(x)}`).join(", ")} }`
				: "{}"
			: `[${v.map(flat).join(", ")}]`;

const isNumber = (v: Json): boolean => typeof v === "string" && /^-?\d/.test(v);

function fill(items: string[], pad: string, start: number): string {
	let out = "";
	let col = start;
	items.forEach((item, i) => {
		const text = i < items.length - 1 ? `${item},` : item;
		const w = width(text);
		if (i === 0) {
			out = text;
			col += w;
		} else if (col + 1 + w <= PRINT_WIDTH) {
			out += ` ${text}`;
			col += 1 + w;
		} else {
			out += `\n${pad}${text}`;
			col = start + w;
		}
	});
	return out;
}

/** `col` is where `v` starts; `tail` is the width of what follows it on the line (a comma, or nothing). */
function print(v: Json, depth: number, col: number, tail: number): string {
	if (typeof v === "string") return v;
	const pad = "\t".repeat(depth + 1);
	const inner = (depth + 1) * TAB_WIDTH;
	const close = "\t".repeat(depth);
	if (isObject(v)) {
		if (!v.entries.length) return "{}";
		const last = v.entries.length - 1;
		const lines = v.entries.map(([k, x], i) => {
			const key = `${JSON.stringify(k)}: `;
			return pad + key + print(x, depth + 1, inner + width(key), i < last ? 1 : 0);
		});
		return `{\n${lines.join(",\n")}\n${close}}`;
	}
	if (!v.length) return "[]";
	if (!breaks(v)) {
		const text = flat(v);
		if (col + width(text) + tail <= PRINT_WIDTH) return text;
	}
	if (v.every(isNumber)) return `[\n${pad}${fill(v as string[], pad, inner)}\n${close}]`;
	const last = v.length - 1;
	const lines = v.map((x, i) => pad + print(x, depth + 1, inner, i < last ? 1 : 0));
	return `[\n${lines.join(",\n")}\n${close}]`;
}

/** Canonical track.json text: rounded, fixed key order, prettier-identical layout, trailing newline. */
export function serializeTrackDoc(doc: TrackDoc): string {
	return `${print(track(doc), 0, 0, 0)}\n`;
}
