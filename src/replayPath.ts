export interface Point {
	x: number;
	y: number;
}

/**
 * Samples a racing-line <path> in image-pixel (svgEl viewBox) space.
 * `dist` is arc-length along the path in the path's local d-space units,
 * wrapped into [0, total). Direction of travel follows increasing `dist`
 * (flipped when `reverse` is set).
 */
export interface PathSampler {
	/** Total path length, in the path's local d-space units. */
	readonly total: number;
	/** Point at arc-length `dist`, in image-pixel space. */
	pointAt(dist: number): Point;
	/** Heading in degrees (for `rotate(...)`) along the direction of travel, image-pixel space. */
	headingDeg(dist: number): number;
}

export interface PathSamplerOptions {
	/** Travel the loop in the opposite direction. */
	reverse?: boolean;
	/** Lookahead (local units) used to estimate heading. */
	lookahead?: number;
}

/**
 * Build a sampler from a racing-line path. Caches getTotalLength() and the
 * path->viewBox CTM once (both are constant), so per-frame cost is just
 * getPointAtLength + a matrix transform.
 */
export function createPathSampler(path: SVGPathElement, opts: PathSamplerOptions = {}): PathSampler {
	const total = path.getTotalLength();
	// Map path-local d-space -> overlay viewBox (image-pixel) space. Composing the
	// two screen CTMs cancels OSD's live zoom/pan, leaving only the static internal
	// SVG transforms (scale + group translates). getCTM() targets the wrong space
	// here (the car landed offset + shrunk in a corner), so avoid it.
	const root = path.ownerSVGElement;
	const pathScreen = path.getScreenCTM();
	const rootScreen = root?.getScreenCTM();
	if (!root || !pathScreen || !rootScreen) {
		throw new Error("createPathSampler: overlay not rendered (screen CTM unavailable)");
	}
	const ctm = rootScreen.inverse().multiply(pathScreen);
	if (![ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f].every(Number.isFinite)) {
		throw new Error("createPathSampler: degenerate CTM (overlay not laid out yet)");
	}

	const reverse = opts.reverse ?? false;
	const lookahead = opts.lookahead ?? Math.max(2, total * 0.002);

	// SVGPoint in the path's local d-space, with reverse remap applied.
	function localPoint(dist: number): DOMPoint {
		const d = ((dist % total) + total) % total;
		const p = path.getPointAtLength(reverse ? total - d : d);
		return new DOMPoint(p.x, p.y);
	}

	function toImg(p: DOMPoint): Point {
		const dp = new DOMPoint(p.x, p.y).matrixTransform(ctm);
		return { x: dp.x, y: dp.y };
	}

	function pointAt(dist: number): Point {
		return toImg(localPoint(dist));
	}

	function headingDeg(dist: number): number {
		const p0 = toImg(localPoint(dist));
		const p1 = toImg(localPoint(dist + lookahead));
		return Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
	}

	return { total, pointAt, headingDeg };
}
