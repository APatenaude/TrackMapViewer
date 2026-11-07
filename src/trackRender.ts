import { flattenLine, linePathD, type FlatLine } from "./lineGeometry.js";
import { markerIcon } from "./markerIcons.js";
import { createPolylineSampler, type PathSampler, type Point } from "./replayPath.js";
import type { BrakingZone, Marker, MarkerKind, PassingZone, RacingLine, TrackDoc } from "./trackDoc.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Overlay groups, bottom to top. The ids are the layer ids config.json toggles
 * (and upright.ts billboards), so they must not change.
 */
export const LAYER_GROUP_IDS = [
	"compression_crest",
	"corner_numbers",
	"passing_zones",
	"apex",
	"racing_line",
	"braking",
	"cars",
	"references",
] as const;
export type LayerGroupId = (typeof LAYER_GROUP_IDS)[number];

const MARKER_GROUP: Record<MarkerKind, LayerGroupId> = {
	corner: "corner_numbers",
	label: "corner_numbers",
	apex: "apex",
	reference: "references",
	crest: "compression_crest",
	car: "cars",
};

// Style sizes in meters (the Tremblant art's widths), so every track draws them to real scale.
const LINE_CASING_M = 3.36;
const LINE_INK_M = 3.0;
const BRAKING_M = 3.0;
const PASSING_M = 2.1;
const CHEVRON_M = 8.4;
const CORNER_STROKE_M = 2.1;
const DEFAULT_CORNER_M = 35;
const DEFAULT_LABEL_M = 12;
// Scale of the built-in symbols' drawing units and the fallback when a track has no scale.
const REF_MPP = 0.1869;
const CORNER_FONT = "'Arial Rounded MT Bold', 'Arial Black', Arial, sans-serif";
// Full braking almost at once, held, then tapering off toward the corner (the Tremblant art's shape).
const DEFAULT_BRAKING_STOPS: [number, number][] = [
	[0, 0],
	[0.06, 1],
	[0.7, 1],
	[0.78, 0.5],
	[1, 0],
];

function el<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
	const e = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	return e;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

function pointsD(pts: Point[]): string {
	return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${r1(p.x)} ${r1(p.y)}`).join(" ");
}

export interface LineTrace {
	sampler: PathSampler;
	/** Arc-length (image px) of each node along the loop, node 0 = 0. */
	nodeDist: number[];
	flat: FlatLine;
}

/** Cached per line object: flattening is the expensive part of a render or replay. */
const traceCache = new WeakMap<RacingLine, LineTrace>();
export function lineTrace(line: RacingLine): LineTrace {
	let tr = traceCache.get(line);
	if (!tr) {
		const flat = flattenLine(line.nodes);
		const sampler = createPolylineSampler(flat.points);
		tr = { sampler, nodeDist: flat.nodeIndex.map((i) => sampler.distanceOf(i)), flat };
		traceCache.set(line, tr);
	}
	return tr;
}

/** Empty layer groups, created once; renderTrack refills them (so toggles keep their elements). */
export function createLayerGroups(): Map<LayerGroupId, SVGGElement> {
	const groups = new Map<LayerGroupId, SVGGElement>();
	for (const id of LAYER_GROUP_IDS) groups.set(id, el("g", { id, class: "layer-group" }));
	return groups;
}

export interface RenderResult {
	/** Braking zones that couldn't be drawn (their ends no longer fit the line). */
	skipped: string[];
}

/**
 * Draw `doc` into the layer groups, showing only `lineId` (its line, braking zones and
 * line-bound markers). `defs` receives the gradients. `only` redraws just those groups
 * (the editor, during a drag).
 */
export function renderTrack(
	doc: TrackDoc,
	lineId: string | undefined,
	groups: Map<LayerGroupId, SVGGElement>,
	defs: SVGDefsElement,
	only?: ReadonlySet<LayerGroupId>,
): RenderResult {
	const want = (id: LayerGroupId): boolean => !only || only.has(id);
	for (const [id, g] of groups) if (want(id)) g.replaceChildren();
	if (want("braking")) defs.replaceChildren();
	const skipped: string[] = [];
	const px = (m: number): number => m / (doc.metersPerPixel ?? REF_MPP);
	const line = doc.lines.find((l) => l.id === lineId) ?? doc.lines[0];
	const linesById = new Map(doc.lines.map((l) => [l.id, l]));

	if (want("racing_line") && line && line.nodes.length >= 2) {
		const d = linePathD(line.nodes);
		const g = groups.get("racing_line")!;
		g.appendChild(el("path", { d, fill: "none", stroke: "#000", "stroke-width": r1(px(LINE_CASING_M)) }));
		g.appendChild(el("path", { d, fill: "none", stroke: "#fff", "stroke-width": r1(px(LINE_INK_M)) }));
	}

	// A hand-edited file can still be malformed here (the build refuses it, the dev server
	// only warns): skip what can't be drawn instead of losing the whole map.
	for (const zone of doc.zones) {
		if (zone.kind === "braking") {
			if (!want("braking") || !line || zone.line !== line.id || line.nodes.length < 2 || !zone.from || !zone.to)
				continue;
			const node = brakingZone(zone, line, defs, px);
			if (node) groups.get("braking")!.appendChild(node);
			else skipped.push(zone.id);
		} else if (
			want("passing_zones") &&
			zone.kind === "passing" &&
			Array.isArray(zone.nodes) &&
			zone.nodes.length >= 2
		) {
			groups.get("passing_zones")!.appendChild(passingZone(zone, px));
		}
	}

	for (const m of doc.markers) {
		if (m.line && (!line || m.line !== line.id)) continue;
		const id = MARKER_GROUP[m.kind];
		if (id && want(id)) groups.get(id)!.appendChild(marker(m, m.line ? linesById.get(m.line) : undefined, px));
	}
	return { skipped };
}

function brakingZone(
	zone: BrakingZone,
	line: RacingLine,
	defs: SVGDefsElement,
	px: (m: number) => number,
): SVGElement | null {
	const s = lineTrace(line).sampler;
	const a = s.project({ x: zone.from[0], y: zone.from[1] });
	const b = s.project({ x: zone.to[0], y: zone.to[1] });
	// Ends that swapped, met, or snapped to another leg after a line edit would paint most of the lap.
	const span = (((b - a) % s.total) + s.total) % s.total;
	if (span < 1 || span > s.total / 2) {
		console.warn(`track: braking zone ${zone.id} no longer fits its line, skipped`);
		return null;
	}
	const pts = s.slice(a, b);
	const start = pts[0];
	const end = pts[pts.length - 1];
	const gradId = `grad-${zone.id}`;
	const grad = el("linearGradient", {
		id: gradId,
		gradientUnits: "userSpaceOnUse",
		x1: r1(start.x),
		y1: r1(start.y),
		x2: r1(end.x),
		y2: r1(end.y),
	});
	for (const [offset, opacity] of zone.stops ?? DEFAULT_BRAKING_STOPS) {
		grad.appendChild(el("stop", { offset, "stop-color": "#ff0000", "stop-opacity": opacity }));
	}
	defs.appendChild(grad);
	return el("path", {
		d: pointsD(pts),
		fill: "none",
		stroke: `url(#${gradId})`,
		"stroke-width": r1(px(BRAKING_M)),
	});
}

function passingZone(zone: PassingZone, px: (m: number) => number): SVGElement {
	const style = {
		fill: "none",
		stroke: "#00ff00",
		"stroke-width": r1(px(PASSING_M)),
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
	};
	const g = el("g");
	g.appendChild(el("path", { d: linePathD(zone.nodes, false), ...style }));
	if (zone.arrows?.length) {
		const pts = flattenLine(zone.nodes, false).points;
		const cum = [0];
		for (let i = 1; i < pts.length; i++)
			cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
		const total = cum[cum.length - 1];
		const len = px(CHEVRON_M);
		for (const f of zone.arrows) {
			const d = Math.min(1, Math.max(0, f)) * total;
			let i = 1;
			while (i < pts.length - 1 && cum[i] < d) i++;
			const a = pts[i - 1];
			const b = pts[i];
			const t = cum[i] > cum[i - 1] ? (d - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
			const tip = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			const ang = Math.atan2(b.y - a.y, b.x - a.x);
			const wing = (da: number): string =>
				`${r1(tip.x - Math.cos(ang + da) * len)} ${r1(tip.y - Math.sin(ang + da) * len)}`;
			g.appendChild(el("path", { d: `M ${wing(0.5)} L ${r1(tip.x)} ${r1(tip.y)} L ${wing(-0.5)}`, ...style }));
		}
	}
	return g;
}

// Built-in symbols for markers without imported art, in REF_MPP pixels around 0,0 (pointing +x).
const BUILTIN: Record<Exclude<MarkerKind, "corner" | "label">, string> = {
	apex: `<path d="M -24 -30 L 36 0 L -24 30 Z" fill="#ffff00" stroke="#000" stroke-width="2"/>`,
	reference: `<circle r="18" fill="none" stroke="#00ffff" stroke-width="7"/>`,
	crest: `<path d="M -40 14 Q 0 -30 40 14" fill="none" stroke="#ff6600" stroke-width="10" stroke-linecap="round"/>`,
	car: `<rect x="-36" y="-16" width="72" height="32" rx="10" fill="#000"/><rect x="-6" y="-12" width="18" height="24" rx="3" fill="#fff"/>`,
};

function marker(m: Marker, line: RacingLine | undefined, px: (m: number) => number): SVGGElement {
	let x = m.x;
	let y = m.y;
	let rotation = m.rotation ?? 0;
	// Cars on a line sit on it and aim along it, so they follow edits to the line.
	if (m.kind === "car" && line && line.nodes.length >= 2) {
		const s = lineTrace(line).sampler;
		const d = s.project({ x, y });
		const p = s.pointAt(d);
		x = p.x;
		y = p.y;
		rotation = s.headingDeg(d, 10);
	}
	const g = el("g", { transform: `translate(${r1(x)} ${r1(y)})${rotation ? ` rotate(${r1(rotation)})` : ""}` });
	g.dataset.id = m.id;

	if (m.kind === "corner") {
		const size = m.size ?? px(DEFAULT_CORNER_M);
		g.appendChild(
			el("circle", { r: r1(size / 2), fill: "#000", stroke: "#fff", "stroke-width": r1(px(CORNER_STROKE_M)) }),
		);
		const text = el("text", {
			"text-anchor": "middle",
			"dominant-baseline": "central",
			fill: "#fff",
			"font-family": CORNER_FONT,
			"font-weight": "bold",
			"font-size": r1(size * 0.55),
		});
		text.textContent = m.text ?? "";
		g.appendChild(text);
		return g;
	}
	if (m.kind === "label") {
		const size = m.size ?? px(DEFAULT_LABEL_M);
		const text = el("text", {
			"text-anchor": "middle",
			"dominant-baseline": "central",
			fill: "#000",
			stroke: "#fff",
			"stroke-width": r1(size * 0.12),
			"paint-order": "stroke",
			"font-family": CORNER_FONT,
			"font-weight": "bold",
			"font-size": r1(size),
		});
		text.textContent = m.text ?? "";
		g.appendChild(text);
		return g;
	}
	const inner = el("g");
	// Imported art is already at image scale; built-ins are drawn at REF_MPP.
	const scale = (m.size ?? 1) * (m.svg ? 1 : px(REF_MPP));
	if (scale !== 1) inner.setAttribute("transform", `scale(${Math.round(scale * 1000) / 1000})`);
	appendArt(inner, m.svg ?? markerIcon(m.icon)?.svg ?? BUILTIN[m.kind]);
	g.appendChild(inner);
	return g;
}

const ART_TAGS = new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan"]);

// Parsed + cleaned art per markup string: a render reuses it instead of re-parsing every marker.
const artCache = new Map<string, Element | null>();

function appendArt(parent: SVGGElement, markup: string): void {
	let root = artCache.get(markup);
	if (root === undefined) {
		root = parseArt(markup);
		artCache.set(markup, root);
	}
	if (!root) return;
	for (const child of Array.from(root.childNodes)) parent.appendChild(document.importNode(child, true));
}

/**
 * Parse marker art in an inert document and keep only plain drawing elements: no scripts,
 * handlers or links, no ids (one could shadow a layer group's), and no url() (an external
 * one would make every viewer fetch it; internal ones have no ids left to point at).
 */
function parseArt(markup: string): Element | null {
	const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${markup}</svg>`, "image/svg+xml");
	if (doc.querySelector("parsererror")) return null;
	const clean = (node: Element): void => {
		for (const child of Array.from(node.children)) {
			if (!ART_TAGS.has(child.localName)) child.remove();
			else clean(child);
		}
		for (const attr of Array.from(node.attributes)) {
			const name = attr.name.toLowerCase();
			if (name.startsWith("on") || name.endsWith("href") || name === "id") node.removeAttribute(attr.name);
			else if (/url\s*\(/i.test(attr.value))
				node.setAttribute(attr.name, attr.value.replace(/url\s*\([^)]*\)/gi, "none"));
		}
	};
	clean(doc.documentElement);
	return doc.documentElement;
}
