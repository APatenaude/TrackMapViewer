import type { Point } from "./replayPath.js";
import type { LineNode, Vec } from "./trackDoc.js";

/** One cubic Bezier segment, absolute image px. */
export interface Cubic {
	p0: Point;
	c1: Point;
	c2: Point;
	p1: Point;
}

// Uniform Catmull-Rom expressed as Bezier handles: tangent (next - prev) / 6.
const SMOOTH = 1 / 6;
const FLATTEN_STEP_PX = 4;

function autoTangent(nodes: LineNode[], i: number, closed: boolean): Vec {
	const n = nodes.length;
	// An open path's ends aim at their only neighbour.
	const prev = closed || i > 0 ? nodes[(i - 1 + n) % n] : nodes[i];
	const next = closed || i < n - 1 ? nodes[(i + 1) % n] : nodes[i];
	const k = closed || (i > 0 && i < n - 1) ? SMOOTH : 2 * SMOOTH;
	return [(next.x - prev.x) * k, (next.y - prev.y) * k];
}

// A node with one handle mirrors it for the other side; with none, both are auto.
function handleOut(nodes: LineNode[], i: number, closed: boolean): Vec {
	const node = nodes[i];
	if (node.out) return node.out;
	if (node.in) return [-node.in[0], -node.in[1]];
	return autoTangent(nodes, i, closed);
}

function handleIn(nodes: LineNode[], i: number, closed: boolean): Vec {
	const node = nodes[i];
	if (node.in) return node.in;
	if (node.out) return [-node.out[0], -node.out[1]];
	const t = autoTangent(nodes, i, closed);
	return [-t[0], -t[1]];
}

/** Cubic segments node i -> node i+1; a closed loop adds the last one back to the first. */
export function lineSegments(nodes: LineNode[], closed = true): Cubic[] {
	const n = nodes.length;
	const segs: Cubic[] = [];
	for (let i = 0; i < (closed ? n : n - 1); i++) {
		const a = nodes[i];
		const j = (i + 1) % n;
		const b = nodes[j];
		const out = handleOut(nodes, i, closed);
		const inn = handleIn(nodes, j, closed);
		segs.push({
			p0: { x: a.x, y: a.y },
			c1: { x: a.x + out[0], y: a.y + out[1] },
			c2: { x: b.x + inn[0], y: b.y + inn[1] },
			p1: { x: b.x, y: b.y },
		});
	}
	return segs;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function linePathD(nodes: LineNode[], closed = true): string {
	const segs = lineSegments(nodes, closed);
	if (segs.length === 0) return "";
	let d = `M ${r1(segs[0].p0.x)} ${r1(segs[0].p0.y)}`;
	for (const s of segs) {
		d += ` C ${r1(s.c1.x)} ${r1(s.c1.y)} ${r1(s.c2.x)} ${r1(s.c2.y)} ${r1(s.p1.x)} ${r1(s.p1.y)}`;
	}
	return closed ? `${d} Z` : d;
}

export function cubicAt(s: Cubic, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
		y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y,
	};
}

export interface FlatLine {
	/** Polyline in node order (a closed loop runs back from the last point to points[0]). */
	points: Point[];
	/** Index into `points` where each node sits. */
	nodeIndex: number[];
}

/** Flatten into a polyline dense enough to sample and project onto. */
export function flattenLine(nodes: LineNode[], closed = true): FlatLine {
	const points: Point[] = [];
	const nodeIndex: number[] = [];
	const segs = lineSegments(nodes, closed);
	for (const s of segs) {
		nodeIndex.push(points.length);
		// Control-polygon length bounds the arc length from above: enough samples, never too few.
		const poly =
			Math.hypot(s.c1.x - s.p0.x, s.c1.y - s.p0.y) +
			Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) +
			Math.hypot(s.p1.x - s.c2.x, s.p1.y - s.c2.y);
		const steps = Math.max(2, Math.ceil(poly / FLATTEN_STEP_PX));
		for (let k = 0; k < steps; k++) points.push(cubicAt(s, k / steps));
	}
	if (!closed && segs.length > 0) {
		nodeIndex.push(points.length);
		points.push(segs[segs.length - 1].p1);
	}
	return { points, nodeIndex };
}
