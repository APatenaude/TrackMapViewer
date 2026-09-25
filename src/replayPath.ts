export interface Point {
	x: number;
	y: number;
}

/**
 * Samples a closed racing line in image-pixel (svgEl viewBox) space. `dist` is
 * arc-length in image px, wrapped into [0, total); travel follows increasing `dist`.
 */
export interface PathSampler {
	/** Loop length, in image px. */
	readonly total: number;
	/** Point at arc-length `dist`, in image px. */
	pointAt(dist: number): Point;
	/** Heading in degrees (for `rotate(...)`) of the chord from dist - halfWindow to dist + halfWindow. */
	headingDeg(dist: number, halfWindow: number): number;
	/** Arc-length of the polyline's `index`-th point. */
	distanceOf(index: number): number;
	/** Arc-length of the spot on the loop nearest to `p`. */
	project(p: Point): number;
	/** The loop from `from` to `to` in travel order (wrapping past the start), endpoints included. */
	slice(from: number, to: number): Point[];
}

/**
 * Closed-loop sampler over a polyline (last point connects back to the first),
 * reparametrized by image-space arc length. pointAt is a binary search + lerp.
 */
export function createPolylineSampler(points: Point[]): PathSampler {
	const n = points.length;
	if (n < 2) throw new Error("createPolylineSampler: need at least 2 points");
	const cum = new Float64Array(n); // arc length at each point
	for (let i = 1; i < n; i++) {
		cum[i] = cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	}
	const total = cum[n - 1] + Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y);

	function pointAt(dist: number): Point {
		const d = ((dist % total) + total) % total;
		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (cum[mid] <= d) lo = mid;
			else hi = mid - 1;
		}
		const a = points[lo];
		const b = points[(lo + 1) % n];
		const end = lo === n - 1 ? total : cum[lo + 1];
		const span = end - cum[lo];
		const t = span > 0 ? (d - cum[lo]) / span : 0;
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
	}

	function headingDeg(dist: number, halfWindow: number): number {
		const p0 = pointAt(dist - halfWindow);
		const p1 = pointAt(dist + halfWindow);
		return (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
	}

	function distanceOf(index: number): number {
		return cum[((index % n) + n) % n];
	}

	function project(p: Point): number {
		let best = 0;
		let bestD2 = Infinity;
		for (let i = 0; i < n; i++) {
			const a = points[i];
			const b = points[(i + 1) % n];
			const vx = b.x - a.x;
			const vy = b.y - a.y;
			const len2 = vx * vx + vy * vy;
			const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
			const dx = a.x + vx * t - p.x;
			const dy = a.y + vy * t - p.y;
			const d2 = dx * dx + dy * dy;
			if (d2 < bestD2) {
				bestD2 = d2;
				const end = i === n - 1 ? total : cum[i + 1];
				best = cum[i] + (end - cum[i]) * t;
			}
		}
		return best;
	}

	function slice(from: number, to: number): Point[] {
		const a = ((from % total) + total) % total;
		let b = ((to % total) + total) % total;
		if (b <= a) b += total;
		const out: Point[] = [pointAt(a)];
		// Every polyline vertex strictly inside (a, b), walking forward (second lap for the wrap).
		for (let lap = 0; lap < 2; lap++) {
			for (let i = 0; i < n; i++) {
				const d = cum[i] + lap * total;
				if (d > a && d < b) out.push(points[i]);
			}
		}
		out.push(pointAt(b));
		return out;
	}

	return { total, pointAt, headingDeg, distanceOf, project, slice };
}
