import type { PathSampler } from "./replayPath.js";
import type { ReplaySpeedPoint } from "./types.js";

/** Lap length at 1x when speeds have no real scale (no track length, or the curvature fallback). */
export const RELATIVE_LAP_MS = 120000;

/**
 * Maps normalized playback time (tNorm in [0,1]) to a path arc-length distance in
 * [0, total). Curvature-profile and manual modes both implement this, so the
 * controller can swap between them without other changes. `startOffset`
 * (path-normalized, travel direction) shifts where the lap begins on the path.
 */
export interface LapTimeline {
	readonly total: number;
	/** Wall-clock length of one lap at 1x, in ms. */
	readonly lapMs: number;
	distanceAt(tNorm: number): number;
}

export interface SpeedProfileOptions {
	/** Position [0,1] along the travel direction where the lap starts. */
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
	/** Position [0,1] along the travel direction where the lap starts. */
	startOffset?: number;
	/** Control points in travel order space (interpolated + wrapped around the loop). */
	speedPoints: ReplaySpeedPoint[];
	/** Real loop length in meters; without it speeds only shape the motion and the lap lasts RELATIVE_LAP_MS. */
	trackLengthM?: number;
	/** Number of samples the interpolated profile is baked into. */
	samples?: number;
}

const FLOOR = 1e-3;
const MIN_KMH = 5;

function clamp01(t: number): number {
	return Math.min(1, Math.max(0, t));
}

export function wrap01(u: number): number {
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
 * time -> path-distance timeline, starting the lap at `startOffset`. With
 * `sampleM` (meters between samples) speeds are m/s and the lap runs in real
 * time; without it they are relative and the lap lasts RELATIVE_LAP_MS.
 */
function buildTimeline(speed: number[], total: number, startOffset: number, sampleM?: number): LapTimeline {
	const N = speed.length;
	const ds = sampleM ?? 1;
	const s = ((Math.round(startOffset * N) % N) + N) % N; // start sample index

	// Cumulative normalized time around the loop, starting at index s. Each step
	// assumes constant acceleration between its two samples: dt = 2 ds / (v0 + v1).
	const tn = new Array<number>(N + 1);
	let Ttot = 0;
	tn[0] = 0;
	for (let k = 0; k < N; k++) {
		const v0 = Math.max(FLOOR, speed[(s + k) % N]);
		const v1 = Math.max(FLOOR, speed[(s + k + 1) % N]);
		Ttot += (2 * ds) / (v0 + v1);
		tn[k + 1] = Ttot;
	}
	for (let k = 1; k <= N; k++) tn[k] /= Ttot;
	tn[N] = 1;

	return {
		total,
		lapMs: sampleM === undefined ? RELATIVE_LAP_MS : Ttot * 1000,
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

/**
 * Curvature-based timeline: samples the path, estimates local radius (tight =
 * slow, straight = fast), smooths the speed, then integrates from `startOffset`.
 * Speeds are relative, so the lap lasts RELATIVE_LAP_MS.
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

/**
 * Speed (m/s) at a path position between control points, wrapping across the
 * u=1 seam. v^2 is linear in distance between two points, i.e. constant
 * acceleration or braking, so the car brakes and accelerates like a car instead
 * of easing symmetrically.
 */
function sampleManualSpeed(points: ReplaySpeedPoint[], u: number): number {
	const n = points.length;
	if (n === 0) return 1;
	const mps = (p: ReplaySpeedPoint): number => Math.max(FLOOR, p.kmh / 3.6);
	if (n === 1) return mps(points[0]);
	let a = points[n - 1];
	let b = points[0];
	let span = b.u + 1 - a.u;
	let t = u >= a.u ? u - a.u : u + 1 - a.u;
	for (let i = 0; i < n - 1; i++) {
		if (u >= points[i].u && u < points[i + 1].u) {
			a = points[i];
			b = points[i + 1];
			span = b.u - a.u;
			t = u - a.u;
			break;
		}
	}
	const va = mps(a);
	const vb = mps(b);
	const f = span > 0 ? clamp01(t / span) : 0;
	return Math.sqrt(va * va + (vb * vb - va * va) * f);
}

/**
 * Manual timeline: interpolate sparse {u, kmh} control points into a per-sample
 * speed profile, then integrate from `startOffset`. With `trackLengthM`, 1x is
 * real time.
 */
export function createManualTimeline(sampler: PathSampler, opts: ManualProfileOptions): LapTimeline {
	const N = opts.samples ?? 2048;
	const startOffset = opts.startOffset ?? 0;
	const total = sampler.total;

	// A 0 km/h point would take forever to leave; two points at one u would step the speed.
	const pts = opts.speedPoints
		.map((p) => ({ u: wrap01(p.u), kmh: Math.max(MIN_KMH, p.kmh) }))
		.sort((a, b) => a.u - b.u)
		.filter((p, i, all) => i === 0 || p.u !== all[i - 1].u);

	const speed = new Array<number>(N);
	for (let i = 0; i < N; i++) speed[i] = sampleManualSpeed(pts, i / N);

	const sampleM = opts.trackLengthM && opts.trackLengthM > 0 ? opts.trackLengthM / N : undefined;
	return buildTimeline(speed, total, startOffset, sampleM);
}
