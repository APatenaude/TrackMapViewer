import OpenSeadragon from "openseadragon";

const RAD2DEG = 180 / Math.PI;
// Twist is damped (< 1:1) with a dead-zone so a pinch-zoom doesn't spin the map.
const TOUCH_SENSITIVITY = 0.6;
const TOUCH_ENGAGE_DEG = 8;
// Right-drag: degrees of rotation per px of horizontal travel (flip sign to reverse).
const MOUSE_ROTATE_DEG_PER_PX = 0.4;

export interface RotateController {
	/** Enable/disable the rotation gestures (driven by the compass long-press lock). */
	setLocked: (locked: boolean) => void;
}

/** setRotation with OSD's undocumented `immediately` flag (true = snap, no spring). */
export function setViewportRotation(viewport: OpenSeadragon.Viewport, degrees: number, immediately = true): void {
	(viewport.setRotation as (d: number, i?: boolean) => void)(degrees, immediately);
}

/**
 * Free-angle map rotation on top of OSD's pinch / pan / zoom.
 *   - Touch:   two-finger twist about the finger midpoint (see rotateAbout). OSD still
 *              pinch-zooms + pans; damped + dead-zoned so zoom alone doesn't rotate.
 *   - Desktop: right-drag - horizontal travel rotates about the viewport centre (Maps style).
 *
 * Capture-phase observers on viewer.container; touch never preventDefaults, so OSD's
 * gestures and draw.ts still work. `onChange` fires when a gesture settles (for share links).
 */
export function initRotate(viewer: OpenSeadragon.Viewer, onChange: (rotation: number) => void): RotateController {
	const container = viewer.container;
	const touches = new Map<number, { x: number; y: number }>();
	let twistAngle: number | null = null; // baseline angle between the two fingers (rad)
	let twistDist = 0; // baseline distance between the two fingers (client px)
	let twistEngaged = false; // past the dead-zone for this gesture?
	let twistAccum = 0; // rotation-dominant twist accumulated before engaging (deg)
	let mouseId: number | null = null; // active right-drag pointer
	let mousePrevX = 0; // cursor X (client px) at the last move - for the horizontal delta
	let locked = false;

	// Rotate about the viewport centre (right-drag has no gesture point to pin).
	function rotateView(deltaDeg: number): void {
		const vp = viewer.viewport;
		setViewportRotation(vp, vp.getRotation() + deltaDeg);
	}

	// Rotate about the gesture point, not the centre: read the world point under a fixed
	// pixel before/after rotating, then panBy the difference to cancel the drift.
	function rotateAbout(deltaDeg: number, clientX: number, clientY: number): void {
		const vp = viewer.viewport;
		const r = container.getBoundingClientRect();
		const anchor = new OpenSeadragon.Point(clientX - r.left, clientY - r.top); // element px
		const before = vp.pointFromPixel(anchor, true);
		setViewportRotation(vp, vp.getRotation() + deltaDeg);
		const after = vp.pointFromPixel(anchor, true);
		vp.panBy(before.minus(after), true);
	}

	// Angle (rad) of the two active touch points relative to each other.
	function pairAngle(): number {
		const [a, b] = [...touches.values()];
		return Math.atan2(b.y - a.y, b.x - a.x);
	}
	// Midpoint (client px) of the two active touch points - the twist pivot.
	function pairCentroid(): { x: number; y: number } {
		const [a, b] = [...touches.values()];
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	}
	// Distance between the two touch points - twist (tangential) vs pinch (radial).
	function pairDist(): number {
		const [a, b] = [...touches.values()];
		return Math.hypot(b.x - a.x, b.y - a.y);
	}
	// Shortest signed rotation from→to, in degrees (handles the ±π wrap).
	function deltaDeg(from: number, to: number): number {
		return Math.atan2(Math.sin(to - from), Math.cos(to - from)) * RAD2DEG;
	}
	function startTwist(): void {
		const two = touches.size === 2;
		twistAngle = two ? pairAngle() : null;
		twistDist = two ? pairDist() : 0;
		twistEngaged = false;
		twistAccum = 0;
	}
	function onNavigator(e: PointerEvent): boolean {
		return !!(e.target as HTMLElement)?.closest?.(".navigator");
	}

	function onDown(e: PointerEvent): void {
		if (locked || onNavigator(e)) return;
		if (e.pointerType === "mouse") {
			if (e.button !== 2) return; // right button only
			mouseId = e.pointerId;
			mousePrevX = e.clientX;
			container.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
		touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		startTwist();
	}

	function onMove(e: PointerEvent): void {
		if (e.pointerId === mouseId) {
			const dx = e.clientX - mousePrevX;
			mousePrevX = e.clientX;
			if (dx) rotateView(dx * MOUSE_ROTATE_DEG_PER_PX);
			e.preventDefault();
			return;
		}
		if (!touches.has(e.pointerId)) return;
		touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (touches.size !== 2 || twistAngle === null) return;
		const a = pairAngle();
		const dist = pairDist();
		const d = deltaDeg(twistAngle, a);
		if (!twistEngaged) {
			// Twist vs pinch: only count rotation-dominant frames (tangential > radial)
			// toward the dead-zone, so a pure pinch-zoom never engages rotation.
			const tangential = Math.abs(d / RAD2DEG) * (dist / 2);
			const radial = Math.abs(dist - twistDist) / 2;
			twistAngle = a;
			twistDist = dist;
			if (tangential > radial) twistAccum += d;
			if (Math.abs(twistAccum) >= TOUCH_ENGAGE_DEG) twistEngaged = true;
			return;
		}
		twistAngle = a;
		twistDist = dist;
		const c = pairCentroid();
		rotateAbout(d * TOUCH_SENSITIVITY, c.x, c.y);
	}

	function endMouse(): void {
		if (mouseId === null) return;
		try {
			container.releasePointerCapture(mouseId);
		} catch {
			/* already released */
		}
		mouseId = null;
		onChange(viewer.viewport.getRotation());
	}

	function onUp(e: PointerEvent): void {
		if (e.pointerId === mouseId) {
			endMouse();
			return;
		}
		if (touches.delete(e.pointerId)) {
			startTwist(); // re-baseline (or stop) for the remaining fingers
			if (touches.size < 2) onChange(viewer.viewport.getRotation());
		}
	}

	// Capture phase so we see pointers even when draw.ts stops propagation. We never
	// stop propagation for touch, so OSD's gestures and drawing still work.
	container.addEventListener("pointerdown", onDown, true);
	container.addEventListener("pointermove", onMove, true);
	container.addEventListener("pointerup", onUp, true);
	container.addEventListener("pointercancel", onUp, true);
	// Suppress the menu only while rotation is live (right-drag); allow it when off/locked.
	container.addEventListener("contextmenu", (e) => {
		if (!locked) e.preventDefault();
	});

	return {
		setLocked(v: boolean): void {
			locked = v;
			if (v) {
				// Drop any in-progress gesture so it can't resume on unlock.
				touches.clear();
				twistAngle = null;
				endMouse();
			}
		},
	};
}
