import { cubicAt, flattenLine, type Cubic } from "../lineGeometry.js";
import { createPolylineSampler, type PathSampler, type Point } from "../replayPath.js";
import { TRACK_SCHEMA, type LineNode, type Marker, type TrackDoc, type Vec, type Zone } from "../trackDoc.js";
import type { LocalizedString } from "../types.js";

/*
 * Inkscape SVG -> track document. Runs in the browser: it needs layout to resolve each
 * element's transforms (getScreenCTM) and sizes (getBBox). Expects the layer groups
 * the Tremblant file uses (racing_line, braking, passing_zones, apex, references,
 * compression_crest, cars, corner_numbers); missing groups are skipped.
 */

export interface InkscapeImportOptions {
	slug: string;
	name: LocalizedString;
	lineName: LocalizedString;
	/** Background image size in px; the SVG's viewBox is scaled onto it. */
	imageWidth: number;
	imageHeight: number;
	/** Real loop length, sets metersPerPixel. */
	trackLengthM?: number;
	/** Speeds at positions along the path `d` (0..1), put on nodes (segments are split there). */
	speedPoints?: { u: number; kmh: number }[];
	/** Position along the path `d` (0..1) where the lap starts. */
	startOffset?: number;
	/** Travel the loop against the path `d`. */
	reverse?: boolean;
	northOffset?: number;
	replay?: TrackDoc["replay"];
}

type Matrix = DOMMatrix;

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function importInkscape(svgText: string, opts: InkscapeImportOptions): TrackDoc {
	const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
	const root = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
	// Laid out (not display:none) so CTMs and bboxes resolve; off-screen and invisible.
	root.setAttribute("width", String(opts.imageWidth));
	root.setAttribute("height", String(opts.imageHeight));
	root.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden";
	document.body.appendChild(root);
	try {
		return convert(root, opts);
	} finally {
		root.remove();
	}
}

function convert(root: SVGSVGElement, opts: InkscapeImportOptions): TrackDoc {
	const vb = root.viewBox.baseVal;
	const scale = vb && vb.width ? opts.imageWidth / vb.width : 1;
	const rootInv = root.getScreenCTM()!.inverse();
	// Element-local coordinates -> image px.
	const toImage = (el: SVGGraphicsElement): Matrix =>
		new DOMMatrix().scale(scale, scale).multiply(rootInv).multiply(el.getScreenCTM()!);
	const classStyles = readClassStyles(root);

	const line = importLine(root, toImage, opts);
	const sampler = createPolylineSampler(flattenLine(line.nodes).points);
	let seq = 0;
	const nextId = (prefix: string): string => `${prefix}${++seq}`;

	const zones: Zone[] = [];
	for (const path of groupChildren(root, "braking", "path") as SVGPathElement[]) {
		const m = toImage(path);
		// The stroke's gradient fades to transparent at both ends, so only the stretch under
		// its vector is visible; fall back to the path's own ends without one.
		const grad = strokeGradient(root, path, m);
		const segs = grad ? [] : pathCubics(path.getAttribute("d") ?? "", m);
		const [a, b] = grad ? [grad.start, grad.end] : segs.length ? [segs[0].p0, segs[segs.length - 1].p1] : [null, null];
		if (!a || !b) continue;
		const { from, to, flipped } = travelOrder(sampler, a, b);
		// Stops run from the gradient's start; restate them from the zone's upstream end.
		const stops = grad?.stops.map(([o, op]): [number, number] => [flipped ? r4(1 - o) : o, op]);
		if (flipped) stops?.reverse();
		zones.push({ id: nextId("z"), kind: "braking", line: line.id, from, to, stops });
	}
	for (const g of groupChildren(root, "passing_zones")) {
		const paths = Array.from(g.querySelectorAll("path")) as SVGPathElement[];
		if (paths.length === 0 || isHidden(g)) continue;
		const main = paths.reduce((a, b) => (a.getTotalLength() >= b.getTotalLength() ? a : b));
		let segs = pathCubics(main.getAttribute("d") ?? "", toImage(main));
		if (segs.length === 0) continue;
		// Drawn in the direction of travel, so chevrons point the right way.
		if (travelOrder(sampler, segs[0].p0, segs[segs.length - 1].p1).flipped) {
			segs = segs.reverse().map((s) => ({ p0: s.p1, c1: s.c2, c2: s.c1, p1: s.p0 }));
		}
		const nodes = openNodes(segs);
		// Any other path in the group is a direction chevron: keep where along the zone it sits.
		const flat = flattenLine(nodes, false).points;
		const cum = [0];
		for (let i = 1; i < flat.length; i++)
			cum.push(cum[i - 1] + Math.hypot(flat[i].x - flat[i - 1].x, flat[i].y - flat[i - 1].y));
		const arrows = paths
			.filter((p) => p !== main)
			.map((p) => {
				const bb = p.getBBox();
				const c = xform(toImage(p), { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
				let best = 0;
				for (let i = 1; i < flat.length; i++) {
					if (Math.hypot(flat[i].x - c.x, flat[i].y - c.y) < Math.hypot(flat[best].x - c.x, flat[best].y - c.y))
						best = i;
				}
				return Math.round((cum[best] / cum[cum.length - 1]) * 100) / 100;
			});
		zones.push({ id: nextId("z"), kind: "passing", nodes, arrows: arrows.length ? arrows : undefined });
	}

	const markers: Marker[] = [];
	const artMarker = (g: SVGGraphicsElement, kind: Marker["kind"], onLine: boolean): void => {
		if (isHidden(g)) return;
		const m = toImage(g);
		const b = g.getBBox();
		const c = xform(m, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
		// Line-bound cars are drawn rotated to the line's heading, so store their art un-rotated by it.
		let art = new DOMMatrix().translate(-c.x, -c.y).multiply(m);
		if (kind === "car") {
			const heading = sampler.headingDeg(sampler.project(c), 10);
			art = new DOMMatrix().rotate(-heading).multiply(art);
		}
		const svg = serializeArt(g, art, classStyles);
		if (!svg) return;
		markers.push({
			id: nextId("m"),
			kind,
			x: r1(c.x),
			y: r1(c.y),
			svg,
			line: onLine ? line.id : undefined,
		});
	};
	for (const g of groupChildren(root, "apex")) artMarker(g, "apex", true);
	for (const g of groupChildren(root, "cars")) artMarker(g, "car", true);
	for (const g of groupChildren(root, "references")) artMarker(g, "reference", false);
	for (const g of groupChildren(root, "compression_crest")) artMarker(g, "crest", false);

	const label = (t: SVGTextElement): void => {
		const text = t.textContent?.trim();
		if (!text) return;
		const m = toImage(t);
		const b = t.getBBox();
		const c = xform(m, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
		const fontPx = parseFloat(getComputedStyle(t).fontSize) || b.height;
		markers.push({ id: nextId("m"), kind: "label", x: r1(c.x), y: r1(c.y), text, size: r1(fontPx * matrixScale(m)) });
	};
	for (const g of groupChildren(root, "corner_numbers")) {
		if (isHidden(g)) continue;
		const circle = g.querySelector("circle");
		if (!circle) {
			if (g instanceof SVGTextElement) label(g);
			continue;
		}
		const m = toImage(circle);
		const c = xform(m, { x: circle.cx.baseVal.value, y: circle.cy.baseVal.value });
		// The badge's number is the text nearest the circle's centre; any other text is a name.
		const texts = Array.from(g.querySelectorAll("text"));
		const dist = (t: SVGTextElement): number => {
			const b = t.getBBox();
			const p = xform(toImage(t), { x: b.x + b.width / 2, y: b.y + b.height / 2 });
			return Math.hypot(p.x - c.x, p.y - c.y);
		};
		texts.sort((a, b) => dist(a) - dist(b));
		markers.push({
			id: nextId("m"),
			kind: "corner",
			x: r1(c.x),
			y: r1(c.y),
			text: texts[0]?.textContent?.trim() ?? "",
			size: r1(circle.r.baseVal.value * 2 * matrixScale(m)),
		});
		texts.slice(1).forEach(label);
	}

	const total = sampler.total;
	return {
		schema: TRACK_SCHEMA,
		slug: opts.slug,
		name: opts.name,
		image: { width: opts.imageWidth, height: opts.imageHeight },
		metersPerPixel: opts.trackLengthM ? Math.round((opts.trackLengthM / total) * 1e6) / 1e6 : undefined,
		northOffset: opts.northOffset,
		lines: [line],
		zones,
		markers,
		replay: opts.replay,
	};
}

// ---------------------------------------------------------------- racing line

function importLine(
	root: SVGSVGElement,
	toImage: (el: SVGGraphicsElement) => Matrix,
	opts: InkscapeImportOptions,
): { id: string; name: LocalizedString; nodes: LineNode[] } {
	const path = root.querySelector<SVGPathElement>("#racing_line path");
	if (!path) throw new Error("no #racing_line path in the SVG");
	let segs = pathCubics(path.getAttribute("d") ?? "", toImage(path));
	const reverse = opts.reverse === true;
	if (reverse) segs = segs.reverse().map((s) => ({ p0: s.p1, c1: s.c2, c2: s.c1, p1: s.p0 }));
	const toTravel = (u: number): number => (reverse ? (1 - u + 1) % 1 : u);

	// Split at every speed point and the lap start, so each lands on a node. Points closer
	// than SNAP_M merge (and snap onto an existing node): nodes a few meters apart only
	// clutter the editor and are invisible in the replay.
	const SNAP_M = 5;
	const snapU = opts.trackLengthM ? SNAP_M / opts.trackLengthM : 0;
	const startU = toTravel(opts.startOffset ?? 0);
	const raw = [
		{ u: startU, kmh: [] as number[], start: true },
		...(opts.speedPoints ?? []).map((p) => ({ u: toTravel(p.u), kmh: [p.kmh], start: false })),
	].sort((a, b) => a.u - b.u);
	const merged: typeof raw = [];
	for (const c of raw) {
		const prev = merged[merged.length - 1];
		if (prev && c.u - prev.u < snapU) {
			prev.kmh.push(...c.kmh);
			if (c.start) {
				prev.u = c.u;
				prev.start = true;
			}
		} else {
			merged.push({ ...c, kmh: [...c.kmh] });
		}
	}
	const cuts = new Map<number, number | undefined>(); // travel u -> kmh
	for (const c of merged) {
		cuts.set(c.u, c.kmh.length ? Math.round(c.kmh.reduce((a, b) => a + b, 0) / c.kmh.length) : undefined);
	}
	const { segs: split, cutIndex } = splitAt(segs, [...cuts.keys()], snapU);

	const n = split.length;
	const nodes: LineNode[] = split.map((s, i) => {
		const prev = split[(i - 1 + n) % n];
		return {
			id: `n${i + 1}`,
			x: r1(s.p0.x),
			y: r1(s.p0.y),
			in: [r1(prev.c2.x - s.p0.x), r1(prev.c2.y - s.p0.y)] as Vec,
			out: [r1(s.c1.x - s.p0.x), r1(s.c1.y - s.p0.y)] as Vec,
		};
	});
	for (const [u, kmh] of cuts) {
		if (kmh !== undefined) nodes[cutIndex.get(u)!].kmh = kmh;
	}
	// First node = lap start.
	const start = cutIndex.get(startU) ?? 0;
	const rotated = [...nodes.slice(start), ...nodes.slice(0, start)];
	rotated.forEach((node, i) => (node.id = `n${i + 1}`));
	return { id: "main", name: opts.lineName, nodes: rotated };
}

/** Split the loop at arc positions (0..1). Returns the new segments and, per cut, the node index it landed on. */
function splitAt(segs: Cubic[], cuts: number[], snapU: number): { segs: Cubic[]; cutIndex: Map<number, number> } {
	const SAMPLES = 256;
	const tables = segs.map((s) => {
		const cum = [0];
		let prev = s.p0;
		for (let k = 1; k <= SAMPLES; k++) {
			const p = cubicAt(s, k / SAMPLES);
			cum.push(cum[k - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
			prev = p;
		}
		return cum;
	});
	const segStart: number[] = [];
	let total = 0;
	for (const t of tables) {
		segStart.push(total);
		total += t[SAMPLES];
	}

	// Per segment: sorted local t values to cut at (snapping to an existing node when close).
	const snapPx = Math.max(2, snapU * total);
	const perSeg = new Map<number, { t: number; u: number }[]>();
	const atNode = new Map<number, number>(); // u -> original segment index whose start it snaps to
	for (const u of cuts) {
		const d = (((u % 1) + 1) % 1) * total;
		let i = segStart.length - 1;
		while (i > 0 && segStart[i] > d) i--;
		const local = d - segStart[i];
		const table = tables[i];
		const segLen = table[SAMPLES];
		if (local < snapPx) {
			atNode.set(u, i);
			continue;
		}
		if (segLen - local < snapPx) {
			atNode.set(u, (i + 1) % segs.length);
			continue;
		}
		let k = 1;
		while (k < SAMPLES && table[k] < local) k++;
		const t = (k - 1 + (local - table[k - 1]) / (table[k] - table[k - 1])) / SAMPLES;
		const list = perSeg.get(i) ?? [];
		list.push({ t, u });
		perSeg.set(i, list);
	}

	const out: Cubic[] = [];
	const firstOut: number[] = []; // original segment index -> index of its first piece in `out`
	const cutIndex = new Map<number, number>();
	segs.forEach((s, i) => {
		firstOut[i] = out.length;
		let rest = s;
		let done = 0; // t already consumed from the original segment
		for (const { t, u } of (perSeg.get(i) ?? []).sort((a, b) => a.t - b.t)) {
			const [left, right] = splitCubic(rest, (t - done) / (1 - done));
			out.push(left);
			cutIndex.set(u, out.length); // the right piece starts the new node
			rest = right;
			done = t;
		}
		out.push(rest);
	});
	for (const [u, i] of atNode) cutIndex.set(u, firstOut[i]);
	return { segs: out, cutIndex };
}

function splitCubic(s: Cubic, t: number): [Cubic, Cubic] {
	const lerp = (a: Point, b: Point): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	const a = lerp(s.p0, s.c1);
	const b = lerp(s.c1, s.c2);
	const c = lerp(s.c2, s.p1);
	const d = lerp(a, b);
	const e = lerp(b, c);
	const f = lerp(d, e);
	return [
		{ p0: s.p0, c1: a, c2: d, p1: f },
		{ p0: f, c1: e, c2: c, p1: s.p1 },
	];
}

// ---------------------------------------------------------------- helpers

function groupChildren(root: SVGSVGElement, id: string, tag?: string): SVGGraphicsElement[] {
	const g = root.querySelector(`#${id}`);
	if (!g) return [];
	return Array.from(g.children).filter(
		(c): c is SVGGraphicsElement => c instanceof SVGGraphicsElement && (!tag || c.tagName === tag),
	);
}

interface StrokeGradient {
	start: Point;
	end: Point;
	/** [offset, opacity] from `start`. */
	stops: [number, number][];
}

/** The linearGradient a stroke uses: its vector in image px and its opacity stops (follows xlink:href). */
function strokeGradient(root: SVGSVGElement, el: Element, m: Matrix): StrokeGradient | null {
	const ref =
		/url\(#([^)]+)\)/.exec(el.getAttribute("style") ?? "")?.[1] ??
		/url\(#([^)]+)\)/.exec(el.getAttribute("stroke") ?? "")?.[1];
	const grad = ref ? root.getElementById(ref) : null;
	const chain: Element[] = [];
	for (let g: Element | null = grad; g && chain.length < 8;) {
		chain.push(g);
		const href = g.getAttribute("xlink:href") ?? g.getAttribute("href");
		g = href?.startsWith("#") ? root.getElementById(href.slice(1)) : null;
	}
	const attr = (name: string): string | null => chain.map((g) => g.getAttribute(name)).find((v) => v !== null) ?? null;
	if (!grad || grad.localName !== "linearGradient" || attr("gradientUnits") !== "userSpaceOnUse") return null;
	const nums = ["x1", "y1", "x2", "y2"].map((k) => parseFloat(attr(k) ?? ""));
	if (!nums.every(Number.isFinite)) return null;
	const stopEls = chain.map((g) => Array.from(g.querySelectorAll("stop"))).find((s) => s.length > 0) ?? [];
	const stops = stopEls.map((s): [number, number] => {
		const off = s.getAttribute("offset") ?? "0";
		const offset = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
		const op =
			/stop-opacity\s*:\s*([\d.]+)/.exec(s.getAttribute("style") ?? "")?.[1] ?? s.getAttribute("stop-opacity") ?? "1";
		return [r4(offset), r4(parseFloat(op))];
	});
	let gm = m;
	const gt = attr("gradientTransform");
	if (gt) {
		const tmp = document.createElementNS("http://www.w3.org/2000/svg", "g");
		tmp.setAttribute("transform", gt);
		root.appendChild(tmp);
		const local = (tmp as SVGGElement).transform.baseVal.consolidate()?.matrix;
		tmp.remove();
		if (local) gm = m.multiply(DOMMatrix.fromMatrix(local));
	}
	return { start: xform(gm, { x: nums[0], y: nums[1] }), end: xform(gm, { x: nums[2], y: nums[3] }), stops };
}

/** Nodes of an open path (its segments' ends), with each side's handle kept exact. */
function openNodes(segs: Cubic[]): LineNode[] {
	const nodes: LineNode[] = segs.map((s, i) => ({
		id: `p${i + 1}`,
		x: r1(s.p0.x),
		y: r1(s.p0.y),
		in: i > 0 ? ([r1(segs[i - 1].c2.x - s.p0.x), r1(segs[i - 1].c2.y - s.p0.y)] as Vec) : undefined,
		out: [r1(s.c1.x - s.p0.x), r1(s.c1.y - s.p0.y)] as Vec,
	}));
	const last = segs[segs.length - 1];
	nodes.push({
		id: `p${segs.length + 1}`,
		x: r1(last.p1.x),
		y: r1(last.p1.y),
		in: [r1(last.c2.x - last.p1.x), r1(last.c2.y - last.p1.y)],
	});
	return nodes;
}

/** Hidden in the editor (display:none on the element itself). */
function isHidden(el: Element): boolean {
	return /display\s*:\s*none/.test(el.getAttribute("style") ?? "") || el.getAttribute("display") === "none";
}

function xform(m: Matrix, p: { x: number; y: number }): Point {
	const q = new DOMPoint(p.x, p.y).matrixTransform(m);
	return { x: q.x, y: q.y };
}

function matrixScale(m: Matrix): number {
	return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

/** Snap both ends onto the line and order them along travel (the shorter way round); `flipped` = b came first. */
function travelOrder(s: PathSampler, a: Point, b: Point): { from: Vec; to: Vec; flipped: boolean } {
	const da = s.project(a);
	const db = s.project(b);
	const flipped = (((db - da) % s.total) + s.total) % s.total > s.total / 2;
	const pa = s.pointAt(flipped ? db : da);
	const pb = s.pointAt(flipped ? da : db);
	return { from: [r1(pa.x), r1(pa.y)], to: [r1(pb.x), r1(pb.y)], flipped };
}

/** Absolute cubic segments of a path `d`, transformed by `m`. Lines and quadratics become cubics; arcs, chords. */
export function pathCubics(d: string, m: Matrix): Cubic[] {
	const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
	const segs: Cubic[] = [];
	let i = 0;
	let cmd = "";
	let cur = { x: 0, y: 0 };
	let start = { x: 0, y: 0 };
	let lastCtrl: Point | null = null; // for S/s and T/t reflection
	let lastQuad: Point | null = null;
	const num = (): number => parseFloat(tokens[i++]);
	const isCmd = (t: string | undefined): boolean => t !== undefined && /[a-zA-Z]/.test(t);
	const line = (p: Point): void => {
		segs.push({
			p0: cur,
			c1: { x: cur.x + (p.x - cur.x) / 3, y: cur.y + (p.y - cur.y) / 3 },
			c2: { x: cur.x + ((p.x - cur.x) * 2) / 3, y: cur.y + ((p.y - cur.y) * 2) / 3 },
			p1: p,
		});
		cur = p;
	};
	while (i < tokens.length) {
		if (isCmd(tokens[i])) cmd = tokens[i++];
		const rel = cmd === cmd.toLowerCase();
		const abs = (x: number, y: number): Point => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
		const C = cmd.toUpperCase();
		if (C === "M") {
			cur = abs(num(), num());
			start = cur;
			cmd = rel ? "l" : "L"; // further pairs are line-tos
			lastCtrl = lastQuad = null;
		} else if (C === "L") {
			line(abs(num(), num()));
			lastCtrl = lastQuad = null;
		} else if (C === "H") {
			const x = num();
			line({ x: rel ? cur.x + x : x, y: cur.y });
			lastCtrl = lastQuad = null;
		} else if (C === "V") {
			const y = num();
			line({ x: cur.x, y: rel ? cur.y + y : y });
			lastCtrl = lastQuad = null;
		} else if (C === "C" || C === "S") {
			const c1: Point =
				C === "C" ? abs(num(), num()) : lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
			const c2 = abs(num(), num());
			const p1 = abs(num(), num());
			segs.push({ p0: cur, c1, c2, p1 });
			lastCtrl = c2;
			lastQuad = null;
			cur = p1;
		} else if (C === "Q" || C === "T") {
			const q: Point =
				C === "Q" ? abs(num(), num()) : lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
			const p1 = abs(num(), num());
			segs.push({
				p0: cur,
				c1: { x: cur.x + ((q.x - cur.x) * 2) / 3, y: cur.y + ((q.y - cur.y) * 2) / 3 },
				c2: { x: p1.x + ((q.x - p1.x) * 2) / 3, y: p1.y + ((q.y - p1.y) * 2) / 3 },
				p1,
			});
			lastQuad = q;
			lastCtrl = null;
			cur = p1;
		} else if (C === "A") {
			i += 5; // rx ry rotation large-arc sweep
			line(abs(num(), num()));
			lastCtrl = lastQuad = null;
		} else if (C === "Z") {
			if (Math.hypot(cur.x - start.x, cur.y - start.y) > 1e-6) line(start);
			cur = start;
			lastCtrl = lastQuad = null;
			if (!isCmd(tokens[i])) break;
		} else {
			break; // unknown command
		}
	}
	return segs.map((s) => ({ p0: xform(m, s.p0), c1: xform(m, s.c1), c2: xform(m, s.c2), p1: xform(m, s.p1) }));
}

// ---------------------------------------------------------------- marker art

/** Simple `.name{decls}` rules from <style>, to inline (the art leaves its stylesheet behind). */
function readClassStyles(root: SVGSVGElement): Map<string, string> {
	const out = new Map<string, string>();
	for (const style of Array.from(root.querySelectorAll("style"))) {
		for (const m of (style.textContent ?? "").matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) out.set(m[1], m[2].trim());
	}
	return out;
}

const DROP_TAGS = new Set(["script", "foreignObject", "image", "metadata", "title", "desc"]);

/** The element's children as markup under one matrix, cleaned of editor noise and anything executable. */
function serializeArt(g: SVGGraphicsElement, art: Matrix, classStyles: Map<string, string>): string {
	const clone = g.cloneNode(true) as Element;
	const clean = (el: Element): void => {
		for (const child of Array.from(el.children)) {
			const style = child.getAttribute("style") ?? "";
			if (DROP_TAGS.has(child.localName) || /display\s*:\s*none/.test(style)) {
				child.remove();
				continue;
			}
			clean(child);
		}
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name;
			if (
				name === "id" ||
				name.startsWith("on") ||
				name.startsWith("inkscape:") ||
				name.startsWith("sodipodi:") ||
				name === "xml:space"
			) {
				el.removeAttribute(name);
			}
		}
		const cls = el.getAttribute("class");
		if (cls) {
			const decls = cls
				.split(/\s+/)
				.map((c) => classStyles.get(c))
				.filter(Boolean)
				.join(";");
			if (decls) el.setAttribute("style", `${decls};${el.getAttribute("style") ?? ""}`);
			el.removeAttribute("class");
		}
	};
	clean(clone);
	const inner = Array.from(clone.childNodes)
		.map((n) => (n.nodeType === Node.ELEMENT_NODE ? new XMLSerializer().serializeToString(n) : ""))
		.join("")
		.replace(/\s+xmlns(:\w+)?="[^"]*"/g, "")
		.replace(/\s{2,}/g, " ");
	if (!inner.trim()) return "";
	// The group's own style (e.g. a shared fill) must wrap the children too.
	const groupStyle = clone.getAttribute("style");
	const m = [art.a, art.b, art.c, art.d, art.e, art.f].map(r4).join(" ");
	return `<g transform="matrix(${m})"${groupStyle ? ` style="${groupStyle.replace(/"/g, "'")}"` : ""}>${inner}</g>`;
}
