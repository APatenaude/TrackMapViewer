import OpenSeadragon from "openseadragon";
import type { FabResult } from "./fab.js";
import { t } from "./i18n.js";
import { createCarElement, positionCar } from "./replayCar.js";
import { createPathSampler, type PathSampler } from "./replayPath.js";
import {
	createLinearTimeline,
	createManualTimeline,
	createProfileTimeline,
	type LapTimeline,
} from "./replayTimeline.js";
import type { ReplayConfig } from "./types.js";

const PATH_SELECTOR = "#racing_line path";
const BASE_LAP_MS = 120000; // wall-clock for one loop at 1x (a ~2 min lap)
const SPEEDS = [0.25, 0.5, 1] as const;
const DEFAULT_SPEED_INDEX = 2; // 1x
const SCRUB_MAX = 1000; // integer resolution of the range input
// Flip to true for constant-speed motion (overrides the config profile).
const USE_LINEAR = false;
// Curvature auto-profile (fallback when config has no speedPoints).
const PROFILE_OPTS = { minSpeed: 0.15, maxSpeed: 1, smoothing: 15 };
// Show the live path position (u = 0..1) in the bar - set config speedPoints / startOffset by it.
const SHOW_POS = true;

// Replay: a fast-forward (double triangle) inside a counter-clockwise loop.
const REPLAY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26" aria-hidden="true"><path d="M2.5 12a9.5 9.5 0 1 0 9.5-9.5 10.3 10.3 0 0 0-7.1 2.9L2.5 7.7"/><path d="M2.5 2.5v5.2h5.2"/><path d="M6.7 7.7 12 12 6.7 16.3Z" fill="currentColor" stroke="none"/><path d="M12 7.7 17.3 12 12 16.3Z" fill="currentColor" stroke="none"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const ORIENT_ICON = `<svg viewBox="0 0 56 56" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M 7.8086 50.3477 L 48.1914 50.3477 C 53.0663 50.3477 55.5508 47.9102 55.5508 43.0820 L 55.5508 18.5430 C 55.5508 13.7149 53.0663 11.3008 48.1914 11.3008 L 42.7069 11.3008 C 40.8789 11.3008 40.3164 10.9258 39.2617 9.7539 L 37.3633 7.6445 C 36.2149 6.3555 35.0196 5.6523 32.5820 5.6523 L 23.2539 5.6523 C 20.8398 5.6523 19.6445 6.3555 18.4727 7.6445 L 16.5742 9.7539 C 15.5430 10.9023 14.9571 11.3008 13.1289 11.3008 L 7.8086 11.3008 C 2.9336 11.3008 .4492 13.7149 .4492 18.5430 L .4492 43.0820 C .4492 47.9102 2.9336 50.3477 7.8086 50.3477 Z M 7.8789 46.5742 C 5.5586 46.5742 4.2227 45.3320 4.2227 42.8945 L 4.2227 18.7539 C 4.2227 16.3164 5.5586 15.0742 7.8789 15.0742 L 14.0664 15.0742 C 16.1758 15.0742 17.3008 14.6758 18.4727 13.3633 L 20.3242 11.3008 C 21.6602 9.8008 22.3398 9.4258 24.4258 9.4258 L 31.4102 9.4258 C 33.4961 9.4258 34.1758 9.8008 35.5117 11.3008 L 37.3633 13.3633 C 38.5352 14.6758 39.6602 15.0742 41.7696 15.0742 L 48.1213 15.0742 C 50.4416 15.0742 51.7775 16.3164 51.7775 18.7539 L 51.7775 42.8945 C 51.7775 45.3320 50.4416 46.5742 48.1213 46.5742 Z M 28.0117 16.6914 C 25.1992 16.6914 22.3164 17.6992 20.3711 19.3398 C 19.2930 20.1836 19.0117 21.3555 19.8086 22.1992 C 20.6055 23.0430 21.6367 22.9258 22.5039 22.2461 C 24.1445 20.9336 25.8086 20.2773 28.0117 20.2773 C 32.5586 20.2773 36.3320 23.3476 37.3398 27.3555 L 34.7852 27.3555 C 33.7305 27.3555 33.4727 28.3633 34.0820 29.1602 L 37.7617 34.2930 C 38.3711 35.1367 39.4258 35.2071 40.0586 34.2930 L 43.6914 29.1602 C 44.2775 28.3398 44.0428 27.3555 42.9882 27.3555 L 40.7149 27.3555 C 39.6133 21.0508 34.5039 16.6914 28.0117 16.6914 Z M 12.9414 31.4805 L 15.3555 31.4805 C 16.4805 37.7852 21.5898 42.1445 28.0586 42.1445 C 30.8945 42.1445 33.7305 41.1602 35.7227 39.5195 C 36.8008 38.6758 37.0820 37.4805 36.2852 36.6367 C 35.4883 35.7930 34.4571 35.9336 33.5430 36.5898 C 31.9024 37.8789 30.2617 38.5820 28.0586 38.5820 C 23.5352 38.5820 19.7383 35.5117 18.7539 31.4805 L 21.1680 31.4805 C 22.1992 31.4805 22.4805 30.4961 21.8711 29.6758 L 18.1914 24.5664 C 17.5820 23.7227 16.5274 23.6523 15.8945 24.5664 L 12.2617 29.6758 C 11.6758 30.4961 11.9102 31.4805 12.9414 31.4805 Z"/></svg>`;

export interface ReplayApi {
	/** Show/hide the replay FAB and enable/disable the tool (Options checkbox). */
	setEnabled: (on: boolean) => void;
}

/**
 * Lap replay: a car marker drives the racing line, with a bottom playback bar
 * (play/pause, scrubber, speed). The car lives in the overlay SVG so it pans,
 * zooms and rotates with the map. Toggled by a mini-FAB satellite; nothing persists.
 */
export function initReplay(
	viewer: OpenSeadragon.Viewer,
	svgEl: SVGSVGElement,
	fab: FabResult,
	closePanel: () => void,
	cfg: ReplayConfig = {},
): ReplayApi {
	// Follow cam: pan the view to keep the car centred.
	const follow = cfg.follow !== false; // default on
	const initialZoom = cfg.initialZoom ?? cfg.followZoom ?? 5; // zoom applied when replay starts
	// Follow smoothing: 0 = locked to the car (crisper but jitterier), higher = smoother.
	const followEase = Math.min(1, Math.max(0.08, 1 - (cfg.followSmoothing ?? 0.4)));
	// Orient (chase-cam) smoothing - rotation is jerkier, so smooth it harder by default.
	const orientEase = Math.min(1, Math.max(0.05, 1 - (cfg.orientSmoothing ?? 0.7)));
	// Shift the look-at ahead of the car so more of the track ahead is visible.
	const lookAhead = Math.min(0.45, Math.max(0, cfg.lookAhead ?? 0.25));

	// Engine (built once the overlay is attached + measurable).
	let sampler: PathSampler | null = null;
	let timeline: LapTimeline | null = null;
	let car: SVGGElement | null = null;

	// Runtime state.
	let enabled = false;
	let active = false;
	let playing = false;
	let progress = 0; // normalized time in [0,1)
	let speedIndex = DEFAULT_SPEED_INDEX;
	let rafId: number | null = null;
	let lastTs = 0;
	let userScrubbing = false;
	let orient = cfg.followOrient === true; // chase-cam rotation (toggled live from the bar)

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
			<button class="replay-btn replay-orient" data-i18n-aria="replayOrient">${ORIENT_ICON}</button>
		</div>
		<input class="replay-scrubber" type="range" min="0" max="${SCRUB_MAX}" value="0" step="1" data-i18n-aria="replayScrub" />
	`;
	document.body.appendChild(bar);

	const playBtn = bar.querySelector<HTMLButtonElement>(".replay-play")!;
	const scrubber = bar.querySelector<HTMLInputElement>(".replay-scrubber")!;
	const orientBtn = bar.querySelector<HTMLButtonElement>(".replay-orient")!;
	const speedBtn = bar.querySelector<HTMLButtonElement>(".replay-speed")!;
	speedBtn.textContent = `${SPEEDS[speedIndex]}x`;
	orientBtn.classList.toggle("active", orient);

	// Authoring aid: live path position readout above the bar (see SHOW_POS).
	const posEl = document.createElement("div");
	posEl.className = "replay-pos";
	posEl.hidden = true;
	document.body.appendChild(posEl);

	// Build the sampler + timeline once; the path geometry and CTM never change.
	function buildEngine(): boolean {
		if (sampler && timeline) return true;
		if (viewer.world.getItemCount() === 0) return false; // overlay not measurable yet
		const path = svgEl.querySelector<SVGPathElement>(PATH_SELECTOR);
		if (!path) return false;
		try {
			sampler = createPathSampler(path, { reverse: cfg.reverse });
		} catch {
			sampler = null;
			return false;
		}
		const startOffset = cfg.startOffset ?? 0;
		const pts = cfg.speedPoints;
		if (USE_LINEAR) {
			timeline = createLinearTimeline(sampler.total, startOffset);
		} else if (pts && pts.length > 0) {
			timeline = createManualTimeline(sampler, { startOffset, speedPoints: pts });
		} else {
			timeline = createProfileTimeline(sampler, { ...PROFILE_OPTS, startOffset });
		}
		return true;
	}

	// Centre the view on the car. `immediate` snaps (scrub/activate); playback eases
	// toward the car to absorb frame-timing jitter (worse the further you zoom in).
	function followCar(dist: number, immediate: boolean): void {
		if (!sampler) return;
		const p = sampler.pointAt(dist);
		let target = viewer.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(p.x, p.y));
		// Push the look-at point ahead of the car (along its heading) so the car rides
		// toward the back of the view and more of the upcoming track is on screen.
		if (lookAhead > 0) {
			const rad = (sampler.headingDeg(dist) * Math.PI) / 180;
			const cs = viewer.viewport.getContainerSize();
			const spanY = cs.x > 0 ? cs.y / cs.x / viewer.viewport.getZoom(true) : 0; // visible height, viewport units
			const lead = lookAhead * spanY;
			target = new OpenSeadragon.Point(target.x + Math.cos(rad) * lead, target.y + Math.sin(rad) * lead);
		}
		if (immediate || followEase >= 1) {
			viewer.viewport.panTo(target, true);
			return;
		}
		const c = viewer.viewport.getCenter(true);
		const nx = c.x + (target.x - c.x) * followEase;
		const ny = c.y + (target.y - c.y) * followEase;
		viewer.viewport.panTo(new OpenSeadragon.Point(nx, ny), true);
	}

	// Rotate the view so the car's heading points up. If it ends up backwards for this
	// map, flip the sign of the -90 term (or add 180).
	function orientCar(dist: number, immediate: boolean): void {
		if (!sampler) return;
		const target = -90 - sampler.headingDeg(dist);
		const cur = viewer.viewport.getRotation(true);
		let delta = ((((target - cur) % 360) + 540) % 360) - 180; // shortest path -> (-180, 180]
		if (!immediate) delta *= orientEase;
		viewer.viewport.setRotation(cur + delta, true);
	}

	// Zoom to the initial zoom (only when entering replay mode); no-op if already there.
	function snapZoom(): void {
		if (follow && Math.abs(viewer.viewport.getZoom() - initialZoom) > 1e-3) {
			viewer.viewport.zoomTo(initialZoom);
		}
	}

	function render(immediate = false): void {
		if (!sampler || !timeline || !car) return;
		const dist = timeline.distanceAt(progress);
		positionCar(car, sampler, dist);
		if (follow) followCar(dist, immediate);
		if (orient) orientCar(dist, immediate);
		if (SHOW_POS) posEl.textContent = `u ${(dist / sampler.total).toFixed(3)}`;
		if (!userScrubbing) scrubber.value = String(Math.round(progress * SCRUB_MAX));
	}

	function frame(ts: number): void {
		if (!playing) return;
		const dt = Math.min(50, ts - lastTs); // clamp to swallow frame-timing spikes (tab defocus, GC)
		lastTs = ts;
		// Hold progress while the user drags the scrubber; resume from there on release.
		if (!userScrubbing && timeline) {
			progress += (dt / BASE_LAP_MS) * SPEEDS[speedIndex];
			progress -= Math.floor(progress); // wrap/loop into [0,1)
		}
		render();
		rafId = requestAnimationFrame(frame);
	}

	function startLoop(): void {
		if (rafId !== null) return;
		lastTs = performance.now();
		rafId = requestAnimationFrame(frame);
	}

	function stopLoop(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function setPlaying(on: boolean): void {
		if (on && !buildEngine()) return;
		playing = on;
		playBtn.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
		playBtn.setAttribute("data-i18n-aria", on ? "replayPause" : "replayPlay");
		playBtn.setAttribute("aria-label", t(on ? "replayPause" : "replayPlay"));
		if (on) {
			startLoop(); // resume keeps the current zoom; the loop re-centres
		} else {
			stopLoop();
		}
	}

	// Show the bar + spawn the car (paused), or tear both down.
	function setActive(on: boolean): void {
		if (on && !enabled) return;
		if (on) {
			closePanel();
			if (!buildEngine()) return; // not ready yet - leave inactive
			if (!car) car = createCarElement();
			svgEl.appendChild(car); // last child = drawn on top of the layers
			bar.hidden = false;
			posEl.hidden = !SHOW_POS;
			active = true;
			snapZoom(); // only entering replay mode zooms in
			render(true); // snap-centre on the car
		} else {
			setPlaying(false);
			bar.hidden = true;
			posEl.hidden = true;
			active = false;
			if (orient) viewer.viewport.setRotation(0); // straighten the map on exit
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

	// Toggle chase-cam orientation live.
	orientBtn.addEventListener("click", () => {
		orient = !orient;
		orientBtn.classList.toggle("active", orient);
		if (orient) render(true); // snap to heading-up now
		else viewer.viewport.setRotation(0); // straighten (animated)
	});

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
		if (buildEngine()) render(true); // snap to the scrubbed spot, keep current zoom
	});

	// Dragging (panning) the map pauses playback so you can look around; zooming does not.
	viewer.addHandler("canvas-drag", () => {
		if (playing) setPlaying(false);
	});

	// Build the engine as soon as the tiles open so the first tap is instant.
	viewer.addHandler("open", () => {
		buildEngine();
	});

	return {
		setEnabled(on: boolean): void {
			enabled = on;
			btn.hidden = !on;
			fab.reposition();
			if (!on) setActive(false); // hiding the tool tears down the bar + car
		},
	};
}
