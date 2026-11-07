import { cubicAt, lineSegments } from "../lineGeometry.js";
import type { Point } from "../replayPath.js";
import type { RacingLine, TrackDoc, Vec } from "../trackDoc.js";
import { lineTrace } from "../trackRender.js";

/*
 * Braking zones and cars on a line are stored as points that the viewer snaps onto the
 * line. When the line itself is edited, re-snapping by nearest point can jump to the
 * other leg of a hairpin, so the editor instead remembers where each one sits (which
 * segment, identified by its two node ids, and the curve parameter on it) and writes the
 * point back at the same spot on the edited curve. The stored point then always lies on
 * the line.
 */

interface Anchor {
	from: string;
	to: string;
	t: number;
}

/** Where on the line `p` sits: nearest flattened point, refined within its segment. */
export function anchorOf(line: RacingLine, p: Point): Anchor | null {
	const nodes = line.nodes;
	if (nodes.length < 2) return null;
	const { flat } = lineTrace(line);
	const pts = flat.points;
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < pts.length; i++) {
		const d = (pts[i].x - p.x) ** 2 + (pts[i].y - p.y) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	// Refine towards whichever neighbour lies in the same segment.
	let t = flat.t[best];
	const seg = flat.seg[best];
	for (const j of [best + 1, best - 1]) {
		if (j < 0 || j >= pts.length || flat.seg[j] !== seg) continue;
		const a = pts[best];
		const b = pts[j];
		const vx = b.x - a.x;
		const vy = b.y - a.y;
		const len2 = vx * vx + vy * vy;
		const f = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
		if (f > 0) {
			t = flat.t[best] + Math.min(1, f) * (flat.t[j] - flat.t[best]);
			break;
		}
	}
	return { from: nodes[seg].id, to: nodes[(seg + 1) % nodes.length].id, t };
}

/** The point at `a` on the (edited) line, or null when that segment no longer exists. */
export function pointOf(line: RacingLine, a: Anchor): Point | null {
	const nodes = line.nodes;
	const segs = lineSegments(nodes);
	for (let k = 0; k < nodes.length; k++) {
		if (nodes[k].id === a.from && nodes[(k + 1) % nodes.length].id === a.to) return cubicAt(segs[k], a.t);
	}
	return null;
}

/** Nearest point on the line (fallback when a segment was split or merged). */
function snap(line: RacingLine, p: Point): Point {
	const s = lineTrace(line).sampler;
	return s.pointAt(s.project(p));
}

const vec = (p: Point): Vec => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];

/**
 * Remember where `lineId`'s braking zones and cars sit in `doc`; the returned function
 * moves them to the same spots on the line as edited in a later doc. Call it once
 * before an edit (or a whole drag) and apply it to every resulting doc.
 */
export function anchorLine(doc: TrackDoc, lineId: string): (next: TrackDoc) => TrackDoc {
	const line = doc.lines.find((l) => l.id === lineId);
	if (!line || line.nodes.length < 2) return (next) => next;
	const zoneAnchors = new Map<string, { from: Anchor | null; to: Anchor | null; pf: Point; pt: Point }>();
	for (const z of doc.zones) {
		if (z.kind !== "braking" || z.line !== lineId) continue;
		const pf = { x: z.from[0], y: z.from[1] };
		const pt = { x: z.to[0], y: z.to[1] };
		zoneAnchors.set(z.id, { from: anchorOf(line, pf), to: anchorOf(line, pt), pf, pt });
	}
	const carAnchors = new Map<string, { a: Anchor | null; p: Point }>();
	for (const m of doc.markers) {
		if (m.kind !== "car" || m.line !== lineId) continue;
		const p = { x: m.x, y: m.y };
		carAnchors.set(m.id, { a: anchorOf(line, p), p });
	}

	return (next) => {
		const edited = next.lines.find((l) => l.id === lineId);
		if (!edited || edited === line || edited.nodes.length < 2) return next;
		const place = (a: Anchor | null, fallback: Point): Point => (a && pointOf(edited, a)) ?? snap(edited, fallback);
		return {
			...next,
			zones: next.zones.map((z) => {
				const za = z.kind === "braking" ? zoneAnchors.get(z.id) : undefined;
				return za && z.kind === "braking"
					? { ...z, from: vec(place(za.from, za.pf)), to: vec(place(za.to, za.pt)) }
					: z;
			}),
			markers: next.markers.map((m) => {
				const ca = carAnchors.get(m.id);
				if (!ca) return m;
				const p = place(ca.a, ca.p);
				return { ...m, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
			}),
		};
	};
}
