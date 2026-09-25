import OpenSeadragon from "openseadragon";
import type { FabResult } from "./fab.js";
import { t } from "./i18n.js";
import { createCarElement, positionCar } from "./replayCar.js";
import type { PathSampler } from "./replayPath.js";
import { createManualTimeline, createProfileTimeline, type LapTimeline } from "./replayTimeline.js";
import { getViewportRotation, setViewportRotation } from "./rotate.js";
import type { RacingLine, TrackDoc } from "./trackDoc.js";
import { lineTrace } from "./trackRender.js";

const SPEEDS = [0.25, 0.5, 0.75, 1] as const;
const DEFAULT_SPEED_INDEX = 3; // 1x
const SCRUB_MAX = 1000; // integer resolution of the range input
// Curvature auto-profile (fallback when no node of the line has a speed).
const PROFILE_OPTS = { minSpeed: 0.15, maxSpeed: 1, smoothing: 15 };
// Heading half-windows: short for the car sprite, long for the camera so kinks in the drawn line don't twitch the map.
const CAR_HEADING_M = 3;
const CAM_HEADING_M = 20;
const ASSUMED_TRACK_M = 4000; // scale guess when the track has no metersPerPixel
const GLIDE_TAU_S = 0.18;
const ROTATE_TAU_S = 0.4; // heading-up easing in
const EDGE_PX = 32; // while playing, the car stays at least this far inside the visible area
const BAR_GAP_PX = 8;

// Replay: a fast-forward (double triangle) inside a counter-clockwise loop.
const REPLAY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26" aria-hidden="true"><path d="M2.5 12a9.5 9.5 0 1 0 9.5-9.5 10.3 10.3 0 0 0-7.1 2.9L2.5 7.7"/><path d="M2.5 2.5v5.2h5.2"/><path d="M6.7 7.7 12 12 6.7 16.3Z" fill="currentColor" stroke="none"/><path d="M12 7.7 17.3 12 12 16.3Z" fill="currentColor" stroke="none"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const FOLLOW_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
const ORIENT_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>`;

export interface ReplayApi {
	/** Show/hide the replay FAB and enable/disable the tool (Options checkbox). */
	setEnabled: (on: boolean) => void;
	/** Drive another racing line (the one selected in Options). */
	setLine: (line: RacingLine | undefined) => void;
}

/** Car screen spot as fractions of the visible map area (above the replay bar). */
interface Anchor {
	fx: number;
	fy: number;
}

// OSD 4 viewport internals the camera needs (@types/openseadragon is 3.x).
interface SpringInternals {
	shiftBy(delta: number): void;
	current: { value: number };
}
interface ViewportInternals {
	centerSpringX: SpringInternals;
	centerSpringY: SpringInternals;
	zoomPoint: OpenSeadragon.Point | null;
	update(): boolean;
}

const normalizeDeg = (d: number): number => (((d % 360) + 540) % 360) - 180;

/**
 * Lap replay: a car marker drives the racing line in real time, with a bottom
 * playback bar (play/pause, scrubber, rate, camera toggles). The car lives in the
 * overlay SVG so it pans, zooms and rotates with the map. Nothing persists.
 *
 * Camera, Follow mode: every frame the view moves by the car's own travel, so the
 * car keeps whatever screen spot and zoom the user leaves it at (drag it, pinch,
 * wheel), but can't be pushed out of view while playing. Paused, the map is free.
 * Fixed leaves the camera alone. Heading-up rotates the map about the car so it points up.
 * Speed and lap time are never shown (authoring data only).
 */
export function initReplay(
	viewer: OpenSeadragon.Viewer,
	svgEl: SVGSVGElement,
	fab: FabResult,
	closePanel: () => void,
	track: TrackDoc,
	initialLine: RacingLine | undefined,
	isStroking: () => boolean,
	setRotationPivot: (pivot: (() => OpenSeadragon.Point | null) | null) => void,
): ReplayApi {
	const rc = track.replay ?? {};
	const viewSpanM = rc.viewSpanM ?? 170;
	const lookAhead = Math.min(0.4, Math.max(0, rc.lookAhead ?? 0.25));
	const vp = viewer.viewport;
	const vpi = vp as unknown as ViewportInternals;

	// Engine (rebuilt when the line changes).
	let line = initialLine;
	let sampler: PathSampler | null = null;
	let timeline: LapTimeline | null = null;
	let car: SVGGElement | null = null;
	let pxPerM = 1;

	// Runtime state.
	let enabled = false;
	let active = false;
	let playing = false;
	let progress = 0; // normalized time in [0,1)
	let speedIndex = DEFAULT_SPEED_INDEX;
	let userScrubbing = false;
	let lastTs = performance.now();
	let prevDist = 0; // where the car was drawn last frame
	let dirty = false; // redraw the car even if it didn't move

	// Camera state.
	let follow = rc.follow !== false;
	let headingUp = rc.followOrient === true;
	const anchor: Anchor = { fx: 0.5, fy: 0.5 }; // framing Follow returns to
	let followZoom: number | null = null; // zoom to return to when Follow comes back on
	let glide = false; // easing the car toward its anchor
	let snap = false; // next frame jumps instead of easing (activation, scrub)
	let rotOffset = 0; // heading-up: decaying gap between the shown and the true heading (deg)
	let trackZoomPoint = false; // our zoom animation should stay centred on the moving car
	let selfRotating = false;
	let strokeHold: OpenSeadragon.Point | null = null; // car's screen spot when a draw stroke began
	let visibleW = 1;
	let visibleH = 1;

	// Car FAB satellite (stacks under draw/compass).
	const btn = document.createElement("button");
	btn.className = "fab-mini replay-fab";
	btn.setAttribute("data-i18n-aria", "replay");
	btn.setAttribute("aria-pressed", "false");
	btn.hidden = true;
	btn.innerHTML = REPLAY_ICON;
	btn.addEventListener("click", () => setActive(!active));
	fab.addSatellite(btn);

	// Playback bar (a sibling of #viewer, so its events never reach OSD).
	const bar = document.createElement("div");
	bar.className = "replay-bar";
	bar.hidden = true;
	bar.innerHTML = `
		<div class="replay-row">
			<button class="replay-btn replay-speed" data-i18n-aria="replaySpeed">1x</button>
			<button class="replay-btn replay-play" data-i18n-aria="replayPlay">${PLAY_ICON}</button>
			<label class="replay-ctl">
				<button class="replay-btn replay-toggle replay-follow" data-i18n-aria="replayFollow">${FOLLOW_ICON}</button>
				<span class="replay-label" data-i18n="replayFollowLabel" aria-hidden="true"></span>
			</label>
			<label class="replay-ctl">
				<button class="replay-btn replay-toggle replay-orient" data-i18n-aria="replayOrient">${ORIENT_ICON}</button>
				<span class="replay-label" data-i18n="replayOrientLabel" aria-hidden="true"></span>
			</label>
		</div>
		<input class="replay-scrubber" type="range" min="0" max="${SCRUB_MAX}" value="0" step="1" data-i18n-aria="replayScrub" />
	`;
	document.body.appendChild(bar);

	const playBtn = bar.querySelector<HTMLButtonElement>(".replay-play")!;
	const scrubber = bar.querySelector<HTMLInputElement>(".replay-scrubber")!;
	const followBtn = bar.querySelector<HTMLButtonElement>(".replay-follow")!;
	const orientBtn = bar.querySelector<HTMLButtonElement>(".replay-orient")!;
	const speedBtn = bar.querySelector<HTMLButtonElement>(".replay-speed")!;
	speedBtn.textContent = `${SPEEDS[speedIndex]}x`;
	syncToggles();

	function syncToggles(): void {
		followBtn.classList.toggle("active", follow);
		followBtn.setAttribute("aria-pressed", String(follow));
		orientBtn.classList.toggle("active", headingUp);
		orientBtn.setAttribute("aria-pressed", String(headingUp));
		orientBtn.disabled = !follow;
	}

	function buildEngine(): boolean {
		if (sampler && timeline) return true;
		if (!line || line.nodes.length < 2 || viewer.world.getItemCount() === 0) return false;
		const trace = lineTrace(line);
		sampler = trace.sampler;
		const trackM = track.metersPerPixel ? sampler.total * track.metersPerPixel : undefined;
		pxPerM = sampler.total / (trackM ?? ASSUMED_TRACK_M);
		// Nodes with a speed become the timeline's control points; the first node is the lap start.
		const pts = line.nodes.flatMap((n, i) =>
			n.kmh !== undefined && Number.isFinite(n.kmh) ? [{ u: trace.nodeDist[i] / sampler!.total, kmh: n.kmh }] : [],
		);
		timeline =
			pts.length > 0
				? createManualTimeline(sampler, { trackLengthM: trackM, speedPoints: pts })
				: createProfileTimeline(sampler, PROFILE_OPTS);
		return true;
	}

	function carViewportPoint(dist: number): OpenSeadragon.Point {
		const p = sampler!.pointAt(dist);
		return vp.imageToViewportCoordinates(new OpenSeadragon.Point(p.x, p.y));
	}

	function carPixel(): OpenSeadragon.Point {
		return vp.pixelFromPoint(carViewportPoint(prevDist), true);
	}

	// The map area the car can use: the container minus the replay bar at its bottom.
	function measureVisible(): void {
		const size = vp.getContainerSize();
		visibleW = size.x;
		visibleH = size.y;
		if (!bar.hidden) {
			const barTop = bar.getBoundingClientRect().top - viewer.container.getBoundingClientRect().top;
			visibleH = Math.max(80, Math.min(size.y, barTop - BAR_GAP_PX));
		}
	}

	function isVisible(p: OpenSeadragon.Point): boolean {
		return p.x >= EDGE_PX && p.x <= visibleW - EDGE_PX && p.y >= EDGE_PX && p.y <= visibleH - EDGE_PX;
	}

	function clampToVisible(p: OpenSeadragon.Point): OpenSeadragon.Point {
		const clamp = (v: number, size: number): number =>
			Math.min(Math.max(v, EDGE_PX), Math.max(EDGE_PX, size - EDGE_PX));
		return new OpenSeadragon.Point(clamp(p.x, visibleW), clamp(p.y, visibleH));
	}

	// Centred; with heading-up, lower down so more of the track ahead shows.
	function recenterAnchor(): void {
		anchor.fx = 0.5;
		anchor.fy = headingUp ? 0.5 + lookAhead : 0.5;
	}

	// Remember a screen spot (default: the car's) as the framing, if it's on screen.
	function saveAnchor(p = carPixel()): void {
		if (!isVisible(p)) return;
		anchor.fx = p.x / visibleW;
		anchor.fy = p.y / visibleH;
	}

	// OSD zoom that fits viewSpanM meters across the visible area's short side.
	function spanZoom(): number {
		return vp.imageToViewportZoom(Math.min(visibleW, visibleH) / (viewSpanM * pxPerM));
	}

	// Zoom about the car; the per-frame hook keeps the zoom point on the car while it moves.
	function zoomOnCar(target: number): void {
		// Clamped here: our own zoomTo skips OSD's scroll-zoom constraints.
		const zoom = Math.min(vp.getMaxZoom(), Math.max(vp.getMinZoom(), target));
		if (Math.abs(vp.getZoom() / zoom - 1) < 0.01) return;
		vp.zoomTo(zoom, carViewportPoint(prevDist));
		trackZoomPoint = true;
	}

	function headingTarget(dist: number): number {
		return -90 - sampler!.headingDeg(dist, CAM_HEADING_M * pxPerM);
	}

	function rotateTo(deg: number, immediately: boolean): void {
		selfRotating = true;
		setViewportRotation(vp, deg, immediately);
		selfRotating = false;
	}

	// Move the view so the car sits where it was drawn last frame (as the user may since
	// have dragged/zoomed it), easing toward its anchor during a glide. Returns true if the view moved.
	function updateCamera(dist: number, dt: number): boolean {
		// Where last frame's car is now, after this frame's user input and OSD animation.
		let p = carPixel();
		let moved = false;

		if (headingUp) {
			rotOffset = snap ? 0 : rotOffset * Math.exp(-dt / ROTATE_TAU_S);
			if (Math.abs(rotOffset) < 0.1) rotOffset = 0;
			const deg = normalizeDeg(headingTarget(dist) + rotOffset);
			if (deg !== getViewportRotation(vp)) {
				rotateTo(deg, true);
				moved = true;
			}
		}

		if (snap && !isVisible(p)) glide = true;
		if (glide) {
			const dx = anchor.fx * visibleW - p.x;
			const dy = anchor.fy * visibleH - p.y;
			const k = snap || Math.hypot(dx, dy) < 0.5 ? 1 : 1 - Math.exp(-dt / GLIDE_TAU_S);
			if (k === 1) glide = false;
			p = new OpenSeadragon.Point(p.x + dx * k, p.y + dy * k);
		} else if (playing) {
			// A drag or pinch can move the car on screen but never push it out of view.
			p = clampToVisible(p);
		}

		// Shift start/current/target together so a pan the user or OSD has in flight
		// (mouse drag easing, touch flick) carries on instead of being cancelled.
		const shown = vp.pointFromPixel(p, true);
		const car = carViewportPoint(dist);
		const dx = car.x - shown.x;
		const dy = car.y - shown.y;
		if (dx !== 0 || dy !== 0) {
			for (const [spring, d] of [
				[vpi.centerSpringX, dx],
				[vpi.centerSpringY, dy],
			] as const) {
				spring.shiftBy(d);
				spring.current.value += d;
			}
			moved = true;
		}
		return moved;
	}

	// One replay frame, run inside OSD's own frame (after its springs update, before it
	// draws), so the car and the camera never lag the tiles by a frame. True = redraw.
	function step(): boolean {
		const now = performance.now();
		let dt = (now - lastTs) / 1000;
		lastTs = now;
		if (!active || !sampler || !timeline || !car) return false;
		if (dt > 0.25) dt = 1 / 60; // back from a hidden tab: don't jump the car

		if (playing && !userScrubbing) {
			progress += ((dt * 1000) / timeline.lapMs) * SPEEDS[speedIndex];
			progress -= Math.floor(progress); // wrap/loop into [0,1)
		}
		const dist = timeline.distanceAt(progress);
		let changed = false;
		if (dist !== prevDist || dirty) {
			positionCar(car, sampler, dist, CAR_HEADING_M * pxPerM);
			changed = true;
		}
		// A stroke in progress needs the map still under the pen; afterwards the car glides back.
		if (follow && isStroking()) {
			strokeHold ??= carPixel();
		} else if (follow) {
			if (strokeHold) {
				saveAnchor(strokeHold);
				strokeHold = null;
				glide = true;
			}
			changed = updateCamera(dist, dt) || changed;
		}
		prevDist = dist;
		dirty = false;
		snap = false;
		if (!userScrubbing) {
			const v = String(Math.round(progress * SCRUB_MAX));
			if (scrubber.value !== v) scrubber.value = v;
		}
		return changed;
	}

	function setPlaying(on: boolean): void {
		if (on && !buildEngine()) return;
		playing = on;
		playBtn.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
		playBtn.setAttribute("data-i18n-aria", on ? "replayPause" : "replayPlay");
		playBtn.setAttribute("aria-label", t(on ? "replayPause" : "replayPlay"));
		// Looked away while paused: bring the car back into view.
		if (on && follow && !isVisible(carPixel())) glide = true;
	}

	function setFollow(on: boolean): void {
		if (on === follow) return;
		follow = on;
		syncToggles();
		if (!active) return;
		if (on) {
			recenterAnchor();
			glide = true;
			if (headingUp) rotOffset = normalizeDeg(getViewportRotation(vp) - headingTarget(prevDist));
			zoomOnCar(followZoom ?? spanZoom());
		} else {
			glide = false;
			trackZoomPoint = false;
			followZoom = vp.getZoom();
		}
	}

	// Off leaves the map and car where they are; on eases into the heading and re-centres the car.
	function setHeadingUp(on: boolean): void {
		if (on === headingUp) return;
		headingUp = on;
		syncToggles();
		rotOffset = 0;
		if (on && active && follow) {
			rotOffset = normalizeDeg(getViewportRotation(vp) - headingTarget(prevDist));
			recenterAnchor();
			glide = true;
		}
	}

	// Show the bar + spawn the car (paused), or tear both down (the view stays where it is).
	function setActive(on: boolean): void {
		if (on && !enabled) return;
		if (on) {
			closePanel();
			if (!buildEngine()) return; // not ready yet - leave inactive
			if (!car) car = createCarElement();
			svgEl.appendChild(car); // last child = drawn on top of the layers
			bar.hidden = false;
			measureVisible();
			active = true;
			prevDist = timeline!.distanceAt(progress);
			dirty = true;
			follow = rc.follow !== false; // every opening starts in the configured mode
			syncToggles();
			if (follow) {
				recenterAnchor();
				glide = true;
				snap = true;
				zoomOnCar(followZoom ?? spanZoom());
			}
			viewer.forceRedraw();
		} else {
			setPlaying(false);
			bar.hidden = true;
			active = false;
			glide = false;
			trackZoomPoint = false;
			strokeHold = null;
			if (car?.parentNode) car.parentNode.removeChild(car);
		}
		btn.classList.toggle("active", active);
		btn.setAttribute("aria-pressed", String(active));
	}

	playBtn.addEventListener("click", () => setPlaying(!playing));

	speedBtn.addEventListener("click", () => {
		speedIndex = (speedIndex + 1) % SPEEDS.length;
		speedBtn.textContent = `${SPEEDS[speedIndex]}x`; // rate change only, no positional jump
	});

	followBtn.addEventListener("click", () => setFollow(!follow));
	orientBtn.addEventListener("click", () => setHeadingUp(!headingUp));

	// Scrubbing: drive progress from the slider, reposition immediately (paused or playing).
	scrubber.addEventListener("pointerdown", () => {
		userScrubbing = true;
	});
	const endScrub = (): void => {
		userScrubbing = false;
	};
	scrubber.addEventListener("pointerup", endScrub);
	scrubber.addEventListener("pointercancel", endScrub);
	scrubber.addEventListener("input", () => {
		progress = Number(scrubber.value) / SCRUB_MAX;
		snap = true;
		dirty = true;
		viewer.forceRedraw();
	});

	function aimZoomPoint(): boolean {
		if (!trackZoomPoint) return false;
		// OSD's zoom spring can settle a rounding error short of its target and then never clears zoomPoint.
		const settled = Math.abs(vp.getZoom(true) / vp.getZoom() - 1) < 1e-9;
		if (vpi.zoomPoint && sampler && !settled) vpi.zoomPoint = carViewportPoint(prevDist);
		else trackZoomPoint = false;
		return false;
	}

	// A throw inside OSD's update would stop its render loop for good: drop the replay instead.
	function guarded(fn: () => boolean): boolean {
		try {
			return fn();
		} catch (err) {
			console.error("replay:", err);
			active = false;
			setTimeout(() => setActive(false), 0);
			return false;
		}
	}

	// Run the replay frame inside OSD's frame (see step).
	const osdUpdate = vpi.update.bind(vp);
	vpi.update = (): boolean => {
		guarded(aimZoomPoint);
		const changed = osdUpdate();
		return guarded(step) || changed;
	};

	// Following while playing: the wheel zooms about the car, not the cursor, so it stays framed.
	viewer.addHandler("canvas-scroll", (e) => {
		if (!active || !follow || !playing || !sampler) return;
		e.preventDefaultAction = true;
		const perScroll = (viewer as unknown as { zoomPerScroll: number }).zoomPerScroll;
		zoomOnCar(vp.getZoom() * Math.pow(perScroll, e.scroll));
	});

	// Someone else rotated the map (compass tap, twist): heading-up hands the rotation over.
	viewer.addHandler("rotate", () => {
		if (selfRotating || !active || !follow || !headingUp) return;
		setHeadingUp(false);
	});

	// Following a moving car, a manual twist/right-drag turns the map about the car instead of
	// the screen centre (which would swing the car off its spot). Paused, rotation stays free.
	setRotationPivot(() => {
		if (!active || !follow || !playing || !sampler) return null;
		const p = carPixel();
		return isVisible(p) ? p : null;
	});

	viewer.addHandler("resize", () => {
		if (!active) return;
		measureVisible();
		if (follow) glide = true;
	});

	return {
		setEnabled(on: boolean): void {
			enabled = on;
			btn.hidden = !on;
			fab.reposition();
			if (!on) setActive(false); // hiding the tool tears down the bar + car
		},
		setLine(next: RacingLine | undefined): void {
			if (next === line) return;
			line = next;
			sampler = null;
			timeline = null;
			if (!active) return;
			// Same lap position on the new line; the camera eases over to it.
			if (!buildEngine()) {
				setActive(false);
				return;
			}
			prevDist = timeline!.distanceAt(progress);
			dirty = true;
			if (follow) glide = true;
			viewer.forceRedraw();
		},
	};
}
