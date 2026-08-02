import type { PathSampler } from "./replayPath.js";

/**
 * Maps normalized playback time (tNorm in [0,1]) to a path arc-length distance in
 * [0, total]. Linear, curvature-profile and manual modes all implement this, so
 * the controller can swap between them without other changes. `startOffset`
 * (path-normalized) shifts where the lap begins on the path.
 */
export interface LapTimeline {
	readonly total: number;
	distanceAt(tNorm: number): number;
}

/** A manual speed control point: relative speed at a path position. */
export interface SpeedPoint {
	/** Path-normalized position in [0,1] (0 = start of the path `d`). */
	u: number;
	/** Relative speed factor (> 0); bigger = faster. */
	speed: number;
}

export interface SpeedProfileOptions {
	/** Path-normalized position [0,1] where the lap starts. */
	startOffset?: number;
	/** Number of samples taken along the path to build the profile. */
	samples?: number;
	/** Slowest speed factor (tight corners). */
	minSpeed?: number;
	/** Fastest speed factor (straights). */
	maxSpeed?: number;
	/** Moving-average window (in samples) that smooths braking/acceleration. */
	smoothing?: number;
}

export interface ManualProfileOptions {
	/** Path-normalized position [0,1] where the lap starts. */
	startOffset?: number;
	/** Control points (interpolated + wrapped around the loop). */
	speedPoints: SpeedPoint[];
	/** Number of samples the interpolated profile is baked into. */
	samples?: number;
	/** Optional moving-average window to soften the interpolation. */
	smoothing?: number;
}

const FLOOR = 1e-3;

function clamp01(t: number): number {
	return Math.min(1, Math.max(0, t));
}

function wrap01(u: number): number {
	return ((u % 1) + 1) % 1;
}

/** Wrap-around moving average; passthrough (with a floor) when window <= 1. */
function smoothWrap(raw: number[], smoothing: number): number[] {
	const N = raw.length;
	if (smoothing <= 1) return raw.map((v) => Math.max(FLOOR, v));
	const half = Math.floor(smoothing / 2);
	const win = 2 * half + 1;
	const out = new Array<number>(N);
	for (let i = 0; i < N; i++) {
		let sum = 0;
		for (let j = -half; j <= half; j++) sum += raw[(((i + j) % N) + N) % N];
		out[i] = Math.max(FLOOR, sum / win);
	}
	return out;
}

/**
 * Integrate a per-sample speed array (indexed by path position u_i = i/N) into a
 * time -> path-distance timeline, starting the lap at `startOffset`.
 */
function buildTimeline(speed: number[], total: number, startOffset: number): LapTimeline {
	const N = speed.length;
	const ds = total / N;
	const s = (((Math.round(startOffset * N) % N) + N) % N); // start sample index

	// Cumulative normalized time around the loop, starting at index s.
	const tn = new Array<number>(N + 1);
	let Ttot = 0;
	for (let k = 0; k < N; k++) Ttot += ds / Math.max(FLOOR, speed[(s + k) % N]);
	if (Ttot <= 0) {
		for (let k = 0; k <= N; k++) tn[k] = k / N;
	} else {
		let acc = 0;
		tn[0] = 0;
		for (let k = 0; k < N; k++) {
			acc += ds / Math.max(FLOOR, speed[(s + k) % N]);
			tn[k + 1] = acc / Ttot;
		}
		tn[N] = 1;
	}

	return {
		total,
		distanceAt(tNorm: number): number {
			const t = clamp01(tNorm);
			// First index with tn[j] >= t; bracket is [j-1, j].
			let lo = 1;
			let hi = N;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (tn[mid] >= t) hi = mid;
				else lo = mid + 1;
			}
			const k = lo - 1;
			const span = tn[k + 1] - tn[k];
			const frac = span > 0 ? (t - tn[k]) / span : 0;
			const lapStep = k + frac; // steps from the start index
			return wrap01((s + lapStep) / N) * total;
		},
	};
}

/** Constant-speed timeline: distance is linear in time (lap position == time). */
export function createLinearTimeline(total: number, startOffset = 0): LapTimeline {
	const off = wrap01(startOffset);
	return {
		total,
		distanceAt(tNorm: number): number {
			return wrap01(off + clamp01(tNorm)) * total;
		},
	};
}

/**
 * Curvature-based timeline: samples the path, estimates local radius (tight =
 * slow, straight = fast), smooths the speed, then integrates from `startOffset`.
 */
export function createProfileTimeline(sampler: PathSampler, opts: SpeedProfileOptions = {}): LapTimeline {
	const N = opts.samples ?? 400;
	const minSpeed = opts.minSpeed ?? 0.25;
	const maxSpeed = opts.maxSpeed ?? 1;
	const smoothing = opts.smoothing ?? 15;
	const startOffset = opts.startOffset ?? 0;
	const total = sampler.total;

	// Equal arc-length samples of the (closed) loop.
	const pts: { x: number; y: number }[] = new Array(N);
	for (let i = 0; i < N; i++) pts[i] = sampler.pointAt((i / N) * total);

	// Curvature radius per sample via three-point circumradius (wrapped neighbors).
	const radii = new Array<number>(N);
	for (let i = 0; i < N; i++) {
		const p0 = pts[(i - 1 + N) % N];
		const p1 = pts[i];
		const p2 = pts[(i + 1) % N];
		const a = Math.hypot(p1.x - p2.x, p1.y - p2.y);
		const b = Math.hypot(p2.x - p0.x, p2.y - p0.y);
		const c = Math.hypot(p0.x - p1.x, p0.y - p1.y);
		const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
		const area = 0.5 * Math.abs(cross);
		radii[i] = area < 1e-9 ? Infinity : (a * b * c) / (4 * area);
	}

	// Reference radius: 85th percentile of finite radii (a "fast enough" corner).
	const finite = radii.filter((r) => Number.isFinite(r)).sort((x, y) => x - y);
	let Rref = 0;
	if (finite.length > 0) {
		const idx = Math.min(finite.length - 1, Math.floor(0.85 * (finite.length - 1)));
		Rref = finite[idx];
	}

	// Radius -> speed factor (Infinity -> maxSpeed via clamp01).
	const rawSpeed = new Array<number>(N);
	for (let i = 0; i < N; i++) {
		rawSpeed[i] = Rref <= 0 ? maxSpeed : minSpeed + (maxSpeed - minSpeed) * clamp01(radii[i] / Rref);
	}

	return buildTimeline(smoothWrap(rawSpeed, smoothing), total, startOffset);
}

/** Speed at a path position by wrap-around linear interpolation of control points. */
function sampleManualSpeed(points: SpeedPoint[], u: number): number {
	const n = points.length;
	if (n === 0) return 1;
	if (n === 1) return points[0].speed;
	const first = points[0];
	const last = points[n - 1];
	// Before the first or after the last point: interpolate across the u=1 seam.
	if (u < first.u || u >= last.u) {
		const span = first.u + 1 - last.u;
		const uu = u < first.u ? u + 1 : u;
		const t = span > 0 ? clamp01((uu - last.u) / span) : 0;
		return last.speed + (first.speed - last.speed) * t;
	}
	for (let i = 0; i < n - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (u >= a.u && u <= b.u) {
			const span = b.u - a.u;
			const t = span > 0 ? (u - a.u) / span : 0;
			return a.speed + (b.speed - a.speed) * t;
		}
	}
	return first.speed;
}

/**
 * Manual timeline: interpolate sparse {u, speed} control points into a per-sample
 * speed profile, then integrate from `startOffset`. Author-friendly - set a speed
 * at a few path positions and the rest is filled in.
 */
export function createManualTimeline(sampler: PathSampler, opts: ManualProfileOptions): LapTimeline {
	const N = opts.samples ?? 400;
	const startOffset = opts.startOffset ?? 0;
	const smoothing = opts.smoothing ?? 0;
	const total = sampler.total;

	const pts = opts.speedPoints
		.map((p) => ({ u: wrap01(p.u), speed: Math.max(FLOOR, p.speed) }))
		.sort((a, b) => a.u - b.u);

	const raw = new Array<number>(N);
	for (let i = 0; i < N; i++) raw[i] = sampleManualSpeed(pts, i / N);

	return buildTimeline(smoothWrap(raw, smoothing), total, startOffset);
}
