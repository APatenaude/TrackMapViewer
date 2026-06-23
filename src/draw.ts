import OpenSeadragon from "openseadragon";
import type { FabResult } from "./fab.js";
import { t } from "./i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_SCREEN_STEP = 2; // px between recorded points

const ICON_ATTRS = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true"`;
const PEN_ICON = `<svg ${ICON_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const CLEAR_ICON = `<svg ${ICON_ATTRS}><path d="m7 21-4.3-4.3a1.4 1.4 0 0 1 0-2l9.6-9.6a1.4 1.4 0 0 1 2 0l5.6 5.6a1.4 1.4 0 0 1 0 2L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`;

interface Stroke {
	group: SVGGElement;
	paths: SVGPathElement[]; // casing + ink, share one `d`
	d: string;
	count: number;
	lastX: number; // last recorded screen position
	lastY: number;
}

const r = (n: number): number => Math.round(n * 10) / 10;

/**
 * Temporary freehand drawing over the map. Toggled by a mini-FAB satellite.
 * Strokes live in an SVG <g> inside the existing overlay, so they pan/zoom with
 * the image. Toggling off clears everything - nothing is persisted.
 */
export interface DrawApi {
	/** Show/hide the draw FAB and enable/disable the tool (Options checkbox). */
	setEnabled: (on: boolean) => void;
}

export function initDraw(
	viewer: OpenSeadragon.Viewer,
	svgEl: SVGSVGElement,
	fab: FabResult,
	closePanel: () => void,
): DrawApi {
	// Stroke layer on top of the track groups, in image-pixel coords (matches windowToImageCoordinates).
	const drawGroup = document.createElementNS(SVG_NS, "g");
	drawGroup.setAttribute("id", "draw-layer");
	svgEl.appendChild(drawGroup);

	const container = viewer.container;
	const activeTouches = new Set<number>();
	let drawingId: number | null = null;
	let current: Stroke | null = null;
	let active = false;
	// Middle-mouse-button drag pans the map while in draw mode (left-drag draws).
	let midPanId: number | null = null;
	let lastMidX = 0;
	let lastMidY = 0;

	function toImage(e: { pageX: number; pageY: number }): OpenSeadragon.Point {
		return viewer.viewport.windowToImageCoordinates(new OpenSeadragon.Point(e.pageX, e.pageY));
	}

	function beginStroke(e: PointerEvent): void {
		// Close the drawer so it can't cover the canvas (and mouse events never reach its outside-close handler).
		closePanel();
		drawingId = e.pointerId;
		const p = toImage(e);
		const d = `M ${r(p.x)} ${r(p.y)}`;
		const group = document.createElementNS(SVG_NS, "g");
		group.setAttribute("class", "draw-stroke");
		const paths = (["draw-casing", "draw-ink"] as const).map((cls) => {
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("class", cls);
			path.setAttribute("d", d);
			group.appendChild(path);
			return path;
		});
		drawGroup.appendChild(group);
		current = { group, paths, d, count: 1, lastX: e.clientX, lastY: e.clientY };
	}

	function extendStroke(e: PointerEvent): void {
		if (!current) return;
		if (Math.hypot(e.clientX - current.lastX, e.clientY - current.lastY) < MIN_SCREEN_STEP) return;
		const p = toImage(e);
		current.d += ` L ${r(p.x)} ${r(p.y)}`;
		current.count++;
		current.lastX = e.clientX;
		current.lastY = e.clientY;
		for (const path of current.paths) path.setAttribute("d", current.d);
	}

	// Keep a finished stroke; drop a tap (a single point with no line).
	function endStroke(): void {
		if (current && current.count < 2) current.group.remove();
		current = null;
		drawingId = null;
	}

	// Abandon the in-progress stroke (e.g. a second finger joined - let OSD pinch).
	function cancelStroke(): void {
		if (current) current.group.remove();
		current = null;
		drawingId = null;
	}

	function onDown(e: PointerEvent): void {
		if (viewer.world.getItemCount() === 0) return; // image not open yet - coords would be wrong
		if ((e.target as HTMLElement).closest(".navigator")) return; // minimap stays usable
		if (e.pointerType === "mouse") {
			// Mouse needs explicit capture, else a release off-window misses pointerup and the gesture sticks.
			if (e.button === 1) {
				// Middle button → pan the map (left button is busy drawing).
				container.setPointerCapture(e.pointerId);
				midPanId = e.pointerId;
				lastMidX = e.clientX;
				lastMidY = e.clientY;
				e.stopPropagation();
				e.preventDefault();
				return;
			}
			if (e.button !== 0) return; // right-click → ignored
			container.setPointerCapture(e.pointerId);
			beginStroke(e);
			e.stopPropagation();
			e.preventDefault();
			return;
		}
		// touch / pen
		activeTouches.add(e.pointerId);
		if (activeTouches.size >= 2) {
			// Second finger: drop the scribble, let OSD pinch-zoom/pan.
			cancelStroke();
			return;
		}
		// First finger: draw, but don't stop propagation - OSD must keep tracking it for a possible pinch.
		beginStroke(e);
	}

	function onMove(e: PointerEvent): void {
		if (e.pointerId === midPanId) {
			const d = viewer.viewport.deltaPointsFromPixels(
				new OpenSeadragon.Point(lastMidX - e.clientX, lastMidY - e.clientY),
			);
			viewer.viewport.panBy(d);
			lastMidX = e.clientX;
			lastMidY = e.clientY;
			e.stopPropagation();
			e.preventDefault();
			return;
		}
		if (e.pointerId !== drawingId || !current) return;
		for (const ev of e.getCoalescedEvents?.() ?? [e]) extendStroke(ev);
		// Swallow the move so OSD never pans under the drawing pointer.
		e.stopPropagation();
		e.preventDefault();
	}

	function onUp(e: PointerEvent): void {
		activeTouches.delete(e.pointerId);
		if (e.pointerId === midPanId) {
			midPanId = null;
			e.stopPropagation();
			e.preventDefault();
			return;
		}
		if (e.pointerId !== drawingId) return;
		const wasMouse = e.pointerType === "mouse";
		endStroke();
		// Mouse: swallow the up (OSD never saw the down). Touch: let it pass so OSD releases its pointer.
		if (wasMouse) {
			e.stopPropagation();
			e.preventDefault();
		}
	}

	// Suppress the Windows middle-click autoscroll (only the mousedown default action stops it).
	function onMouseDown(e: MouseEvent): void {
		if (e.button === 1) e.preventDefault();
	}

	function attach(): void {
		container.addEventListener("pointerdown", onDown, true);
		container.addEventListener("pointermove", onMove, true);
		container.addEventListener("pointerup", onUp, true);
		container.addEventListener("pointercancel", onUp, true);
		container.addEventListener("mousedown", onMouseDown, true);
	}

	function detach(): void {
		container.removeEventListener("pointerdown", onDown, true);
		container.removeEventListener("pointermove", onMove, true);
		container.removeEventListener("pointerup", onUp, true);
		container.removeEventListener("pointercancel", onUp, true);
		container.removeEventListener("mousedown", onMouseDown, true);
		activeTouches.clear();
		midPanId = null;
	}

	function setActive(on: boolean): void {
		active = on;
		btn.classList.toggle("active", on);
		btn.setAttribute("aria-pressed", String(on));
		btn.innerHTML = on ? CLEAR_ICON : PEN_ICON;
		// Swap data-i18n-aria too, so the label survives a language change.
		btn.setAttribute("data-i18n-aria", on ? "clearDrawing" : "drawMode");
		btn.setAttribute("aria-label", t(on ? "clearDrawing" : "drawMode"));
		if (on) {
			attach();
		} else {
			detach();
			cancelStroke();
			drawGroup.replaceChildren();
		}
	}

	const btn = document.createElement("button");
	btn.className = "fab-mini draw-fab";
	btn.setAttribute("data-i18n-aria", "drawMode");
	btn.setAttribute("aria-pressed", "false");
	btn.innerHTML = PEN_ICON;
	btn.addEventListener("click", () => setActive(!active));

	fab.addSatellite(btn);

	return {
		setEnabled(on: boolean): void {
			if (!on && active) setActive(false); // exit draw mode + clear strokes
			btn.hidden = !on;
			fab.reposition();
		},
	};
}
