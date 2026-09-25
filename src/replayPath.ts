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

	return { total, pointAt, headingDeg };
}

/** Incremental sampling of a <path> into image-px points. */
export interface PathSampling {
	readonly points: Point[];
	/** Sample until `budgetMs` elapses (Infinity = finish now); true once every point is in. */
	advance(budgetMs: number): boolean;
}

/**
 * Samples `count` points evenly along a racing-line <path>, in travel order
 * (`reverse` walks the path `d` backwards). getPointAtLength is slow (~0.2 ms a
 * call in Chromium), so the work is split into time-boxed chunks.
 */
export function samplePath(path: SVGPathElement, count: number, reverse = false): PathSampling {
	// Map path-local d-space -> overlay viewBox (image-pixel) space. Composing the
	// two screen CTMs cancels OSD's live zoom/pan/rotation, leaving only the static
	// internal SVG transforms (scale + group translates). getCTM() targets the wrong
	// space here (the car landed offset + shrunk in a corner), so avoid it.
	const root = path.ownerSVGElement;
	const pathScreen = path.getScreenCTM();
	const rootScreen = root?.getScreenCTM();
	if (!root || !pathScreen || !rootScreen) {
		throw new Error("samplePath: overlay not rendered (screen CTM unavailable)");
	}
	const ctm = rootScreen.inverse().multiply(pathScreen);
	if (![ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f].every(Number.isFinite)) {
		throw new Error("samplePath: degenerate CTM (overlay not laid out yet)");
	}
	const length = path.getTotalLength();
	const points: Point[] = [];

	return {
		points,
		advance(budgetMs: number): boolean {
			const end = performance.now() + budgetMs;
			while (points.length < count) {
				const i = points.length;
				const p = path.getPointAtLength(((reverse ? count - i : i) / count) * length);
				const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
				points.push({ x: q.x, y: q.y });
				if (performance.now() >= end) break;
			}
			return points.length >= count;
		},
	};
}
