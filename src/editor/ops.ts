import { lineSegments, nodeHandles, splitCubic } from "../lineGeometry.js";
import type { BrakingZone, LineNode, Marker, PassingZone, RacingLine, TrackDoc, Vec } from "../trackDoc.js";
import type { LocalizedString } from "../types.js";

/*
 * Pure document edits: each returns a new TrackDoc and never touches its input, copying
 * only along the path it changes. That keeps undo snapshots valid and makes the line
 * caches (keyed by line object) see every change.
 */

/** A node-bearing path: a racing line (closed loop) or a passing zone (open). */
export type PathRef = { kind: "line"; id: string } | { kind: "passing"; id: string };

export const MIN_LINE_NODES = 3;
const MIN_PASSING_NODES = 2;

export function pathNodes(doc: TrackDoc, ref: PathRef): LineNode[] | undefined {
	if (ref.kind === "line") return doc.lines.find((l) => l.id === ref.id)?.nodes;
	const z = doc.zones.find((z) => z.id === ref.id);
	return z?.kind === "passing" ? z.nodes : undefined;
}

export const isClosed = (ref: PathRef): boolean => ref.kind === "line";

function withNodes(doc: TrackDoc, ref: PathRef, nodes: LineNode[]): TrackDoc {
	if (ref.kind === "line") {
		return { ...doc, lines: doc.lines.map((l) => (l.id === ref.id ? { ...l, nodes } : l)) };
	}
	return { ...doc, zones: doc.zones.map((z) => (z.id === ref.id && z.kind === "passing" ? { ...z, nodes } : z)) };
}

function mapNode(doc: TrackDoc, ref: PathRef, nodeId: string, fn: (n: LineNode) => LineNode): TrackDoc {
	const nodes = pathNodes(doc, ref);
	if (!nodes) return doc;
	return withNodes(
		doc,
		ref,
		nodes.map((n) => (n.id === nodeId ? fn(n) : n)),
	);
}

// ---------------------------------------------------------------- ids

function nextNumber(ids: Iterable<string>, prefix: string): number {
	let max = 0;
	for (const id of ids) {
		const m = id.startsWith(prefix) ? /^\d+$/.exec(id.slice(prefix.length)) : null;
		if (m) max = Math.max(max, Number(m[0]));
	}
	return max + 1;
}

export function nextNodeId(nodes: LineNode[]): string {
	return `n${nextNumber(
		nodes.map((n) => n.id),
		"n",
	)}`;
}

/** Zones and markers share one id namespace (gradients are named after zone ids). */
export function nextItemId(doc: TrackDoc, prefix: "z" | "m"): string {
	return `${prefix}${nextNumber([...doc.zones.map((z) => z.id), ...doc.markers.map((m) => m.id)], prefix)}`;
}

function nextLineId(doc: TrackDoc): string {
	return `line${nextNumber(
		doc.lines.map((l) => l.id),
		"line",
	)}`;
}

// ---------------------------------------------------------------- nodes

export function moveNode(doc: TrackDoc, ref: PathRef, nodeId: string, x: number, y: number): TrackDoc {
	return mapNode(doc, ref, nodeId, (n) => ({ ...n, x, y }));
}

/**
 * Drag one handle. `smooth` keeps the other handle on the same line (opposite direction)
 * with its own length: most real nodes have unequal handle lengths, so mirroring the
 * length too would change the curve on the other side.
 */
export function setHandle(
	doc: TrackDoc,
	ref: PathRef,
	nodeId: string,
	which: "in" | "out",
	vec: Vec,
	smooth: boolean,
): TrackDoc {
	const nodes = pathNodes(doc, ref);
	const i = nodes?.findIndex((n) => n.id === nodeId) ?? -1;
	if (!nodes || i < 0) return doc;
	const current = nodeHandles(nodes, i, isClosed(ref));
	const other = which === "in" ? "out" : "in";
	let otherVec = current[other];
	const len = Math.hypot(vec[0], vec[1]);
	if (smooth && len > 1e-6) {
		const otherLen = Math.hypot(otherVec[0], otherVec[1]) || len;
		otherVec = [(-vec[0] / len) * otherLen, (-vec[1] / len) * otherLen];
	}
	return mapNode(doc, ref, nodeId, (n) => ({ ...n, [which]: vec, [other]: otherVec }));
}

/** Drop the node's handles: it goes back to the automatic smooth curve. */
export function setAuto(doc: TrackDoc, ref: PathRef, nodeId: string): TrackDoc {
	return mapNode(doc, ref, nodeId, (n) => {
		const { in: _in, out: _out, ...rest } = n;
		return rest;
	});
}

/** Whether the two handles point in opposite directions (a smooth node, not a corner). */
export function isSmoothNode(nodes: LineNode[], i: number, closed: boolean): boolean {
	const h = nodeHandles(nodes, i, closed);
	const a = Math.hypot(h.in[0], h.in[1]);
	const b = Math.hypot(h.out[0], h.out[1]);
	if (a < 1e-6 || b < 1e-6) return true;
	const cos = -(h.in[0] * h.out[0] + h.in[1] * h.out[1]) / (a * b);
	return cos > 0.995;
}

/**
 * Insert a node on segment `seg` at curve parameter t. If either end has explicit
 * handles, both ends get their drawn handles written out and the segment is split
 * exactly, so the curve keeps its shape; between two auto nodes the new node is auto
 * too (the curve shifts slightly, but stays automatic).
 */
export function insertNode(doc: TrackDoc, ref: PathRef, seg: number, t: number): { doc: TrackDoc; nodeId?: string } {
	const nodes = pathNodes(doc, ref);
	if (!nodes) return { doc };
	const closed = isClosed(ref);
	const segs = lineSegments(nodes, closed);
	const s = segs[seg];
	if (!s) return { doc };
	const a = seg;
	const b = (seg + 1) % nodes.length;
	const id = nextNodeId(nodes);
	const [left, right] = splitCubic(s, Math.min(0.999, Math.max(0.001, t)));
	const auto = !nodes[a].in && !nodes[a].out && !nodes[b].in && !nodes[b].out;
	const mid: LineNode = auto
		? { id, x: left.p1.x, y: left.p1.y }
		: {
				id,
				x: left.p1.x,
				y: left.p1.y,
				in: [left.c2.x - left.p1.x, left.c2.y - left.p1.y],
				out: [right.c1.x - right.p0.x, right.c1.y - right.p0.y],
			};
	const next = nodes.map((n, i) => {
		if (auto || (i !== a && i !== b)) return n;
		const h = nodeHandles(nodes, i, closed);
		const handles = { in: h.in, out: h.out };
		if (i === a) handles.out = [left.c1.x - left.p0.x, left.c1.y - left.p0.y];
		if (i === b) handles.in = [right.c2.x - right.p1.x, right.c2.y - right.p1.y];
		return { ...n, ...handles };
	});
	next.splice(a + 1, 0, mid);
	return { doc: withNodes(doc, ref, next), nodeId: id };
}

/** Add an auto node after `afterId` (or at the end), e.g. while drawing a new line. */
export function addNode(
	doc: TrackDoc,
	ref: PathRef,
	afterId: string | undefined,
	x: number,
	y: number,
): { doc: TrackDoc; nodeId: string } {
	const nodes = pathNodes(doc, ref) ?? [];
	const id = nextNodeId(nodes);
	const at = afterId ? nodes.findIndex((n) => n.id === afterId) + 1 : nodes.length;
	const next = [...nodes];
	next.splice(at > 0 ? at : nodes.length, 0, { id, x, y });
	return { doc: withNodes(doc, ref, next), nodeId: id };
}

/** Remove a node; refused (returns the doc unchanged) when the path would get too short. */
export function deleteNode(doc: TrackDoc, ref: PathRef, nodeId: string): TrackDoc {
	const nodes = pathNodes(doc, ref);
	if (!nodes) return doc;
	const min = ref.kind === "line" ? MIN_LINE_NODES : MIN_PASSING_NODES;
	if (nodes.length <= min) return doc;
	return withNodes(
		doc,
		ref,
		nodes.filter((n) => n.id !== nodeId),
	);
}

export function setKmh(doc: TrackDoc, lineId: string, nodeId: string, kmh: number | undefined): TrackDoc {
	return mapNode(doc, { kind: "line", id: lineId }, nodeId, (n) => {
		const { kmh: _k, ...rest } = n;
		return kmh === undefined ? rest : { ...rest, kmh };
	});
}

// ---------------------------------------------------------------- lines

/** The lap starts at this node: rotate the node order (ids stay). */
export function setLapStart(doc: TrackDoc, lineId: string, nodeId: string): TrackDoc {
	const nodes = pathNodes(doc, { kind: "line", id: lineId });
	const i = nodes?.findIndex((n) => n.id === nodeId) ?? -1;
	if (!nodes || i <= 0) return doc;
	return withNodes(doc, { kind: "line", id: lineId }, [...nodes.slice(i), ...nodes.slice(0, i)]);
}

/** Drive the loop the other way; its braking zones swap ends (and fades) to match. */
export function reverseLine(doc: TrackDoc, lineId: string): TrackDoc {
	const line = doc.lines.find((l) => l.id === lineId);
	if (!line || line.nodes.length < 2) return doc;
	const flipped = line.nodes.map((n) => {
		const { in: inn, out, ...rest } = n;
		return { ...rest, ...(out ? { in: out } : {}), ...(inn ? { out: inn } : {}) };
	});
	// Keep the same start node: reversed order is start, last, ..., second.
	const nodes = [flipped[0], ...flipped.slice(1).reverse()];
	const next = withNodes(doc, { kind: "line", id: lineId }, nodes);
	return {
		...next,
		zones: next.zones.map((z) =>
			z.kind === "braking" && z.line === lineId
				? {
						...z,
						from: z.to,
						to: z.from,
						stops: z.stops?.map(([o, op]): [number, number] => [1 - o, op]).reverse(),
					}
				: z,
		),
	};
}

export function addLine(doc: TrackDoc, name: LocalizedString): { doc: TrackDoc; lineId: string } {
	const lineId = nextLineId(doc);
	return { doc: { ...doc, lines: [...doc.lines, { id: lineId, name, nodes: [] }] }, lineId };
}

export function renameLine(doc: TrackDoc, lineId: string, name: LocalizedString): TrackDoc {
	return { ...doc, lines: doc.lines.map((l) => (l.id === lineId ? { ...l, name } : l)) };
}

/** Copy a line with its speeds, braking zones and line-bound markers (to tweak into e.g. a wet line). */
export function duplicateLine(
	doc: TrackDoc,
	lineId: string,
	name: LocalizedString,
): { doc: TrackDoc; lineId?: string } {
	const src = doc.lines.find((l) => l.id === lineId);
	if (!src) return { doc };
	const newId = nextLineId(doc);
	let next: TrackDoc = { ...doc, lines: [...doc.lines, { ...structuredClone(src), id: newId, name }] };
	for (const z of doc.zones) {
		if (z.kind !== "braking" || z.line !== lineId) continue;
		next = { ...next, zones: [...next.zones, { ...structuredClone(z), id: nextItemId(next, "z"), line: newId }] };
	}
	for (const m of doc.markers) {
		if (m.line !== lineId) continue;
		next = { ...next, markers: [...next.markers, { ...structuredClone(m), id: nextItemId(next, "m"), line: newId }] };
	}
	return { doc: next, lineId: newId };
}

/** Remove a line with its braking zones and line-bound markers. */
export function deleteLine(doc: TrackDoc, lineId: string): TrackDoc {
	return {
		...doc,
		lines: doc.lines.filter((l) => l.id !== lineId),
		zones: doc.zones.filter((z) => !(z.kind === "braking" && z.line === lineId)),
		markers: doc.markers.filter((m) => m.line !== lineId),
	};
}

// ---------------------------------------------------------------- zones

export function addBraking(doc: TrackDoc, lineId: string, from: Vec, to: Vec): { doc: TrackDoc; zoneId: string } {
	const zoneId = nextItemId(doc, "z");
	const zone: BrakingZone = { id: zoneId, kind: "braking", line: lineId, from, to };
	return { doc: { ...doc, zones: [...doc.zones, zone] }, zoneId };
}

export function setBrakingEnd(doc: TrackDoc, zoneId: string, end: "from" | "to", p: Vec): TrackDoc {
	return { ...doc, zones: doc.zones.map((z) => (z.id === zoneId && z.kind === "braking" ? { ...z, [end]: p } : z)) };
}

export function addPassing(doc: TrackDoc, nodes: LineNode[]): { doc: TrackDoc; zoneId: string } {
	const zoneId = nextItemId(doc, "z");
	const zone: PassingZone = { id: zoneId, kind: "passing", nodes };
	return { doc: { ...doc, zones: [...doc.zones, zone] }, zoneId };
}

export function setArrows(doc: TrackDoc, zoneId: string, arrows: number[]): TrackDoc {
	return {
		...doc,
		zones: doc.zones.map((z) =>
			z.id === zoneId && z.kind === "passing" ? { ...z, arrows: arrows.length ? arrows : undefined } : z,
		),
	};
}

export function deleteZone(doc: TrackDoc, zoneId: string): TrackDoc {
	return { ...doc, zones: doc.zones.filter((z) => z.id !== zoneId) };
}

// ---------------------------------------------------------------- markers

export function addMarker(doc: TrackDoc, m: Omit<Marker, "id">): { doc: TrackDoc; markerId: string } {
	const markerId = nextItemId(doc, "m");
	return { doc: { ...doc, markers: [...doc.markers, { id: markerId, ...m }] }, markerId };
}

/** Patch a marker; a key set to undefined is removed. */
export function updateMarker(doc: TrackDoc, markerId: string, patch: Partial<Omit<Marker, "id">>): TrackDoc {
	return {
		...doc,
		markers: doc.markers.map((m) => {
			if (m.id !== markerId) return m;
			const next: Marker = { ...m, ...patch };
			for (const [k, v] of Object.entries(patch))
				if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
			return next;
		}),
	};
}

export function deleteMarker(doc: TrackDoc, markerId: string): TrackDoc {
	return { ...doc, markers: doc.markers.filter((m) => m.id !== markerId) };
}

export function duplicateMarker(
	doc: TrackDoc,
	markerId: string,
	dx: number,
	dy: number,
): { doc: TrackDoc; markerId?: string } {
	const m = doc.markers.find((x) => x.id === markerId);
	if (!m) return { doc };
	const { id: _id, ...rest } = structuredClone(m);
	return addMarker(doc, { ...rest, x: m.x + dx, y: m.y + dy });
}

// ---------------------------------------------------------------- track

export function setTrack(
	doc: TrackDoc,
	patch: Partial<Pick<TrackDoc, "name" | "slug" | "northOffset" | "metersPerPixel">>,
): TrackDoc {
	const next = { ...doc, ...patch };
	for (const [k, v] of Object.entries(patch))
		if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
	return next;
}

export function lineById(doc: TrackDoc, id: string | undefined): RacingLine | undefined {
	return doc.lines.find((l) => l.id === id);
}
