import type OpenSeadragon from "openseadragon";
import type { FabResult } from "./fab.js";
import { t } from "./i18n.js";

const LONG_PRESS_MS = 450;
const RIM = 20; // px from the button centre to the "N" bubble (button radius is 22)

// Compass FAB: static bezel ring + a needle (rotor) that points to north, plus an
// "N" bubble that rides the rim and a padlock shown when locked.
const COMPASS_MARKUP = `<span class="compass-bezel"></span>
<span class="compass-rotor">
	<svg class="compass-glyph" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
		<path d="M12 4 L8.5 13 L12 11 L15.5 13 Z" fill="currentColor"/>
		<path d="M12 20 L8.5 13 L12 15 L15.5 13 Z" fill="currentColor" opacity="0.3"/>
	</svg>
</span>
<svg class="compass-lock" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<rect x="5" y="11" width="14" height="9" rx="2"/>
	<path d="M8 11V7a4 4 0 0 1 8 0v4"/>
</svg>
<span class="compass-n">N</span>`;

export interface CompassOptions {
	/** Bearing of true north in the image (deg clockwise from image-up). */
	northOffset: number;
	/** Enable/disable the rotation gestures (the long-press lock). */
	setRotationLocked: (locked: boolean) => void;
}

export interface CompassApi {
	/** Show/hide the compass FAB and enable/disable rotation (Options checkbox).
	 *  Disabling locks the gestures and straightens the map back to 0°. */
	setEnabled: (on: boolean) => void;
}

/**
 * Compass FAB satellite (stacks under the draw button).
 *   - Needle tracks the live rotation, pointing to true north.
 *   - Tap  → straighten the map to 0° (animated).
 *   - Hold → toggle a lock that disables the rotation gestures.
 */
export function initCompass(viewer: OpenSeadragon.Viewer, fab: FabResult, opts: CompassOptions): CompassApi {
	const btn = document.createElement("button");
	btn.className = "fab-mini compass-fab";
	btn.setAttribute("data-i18n-aria", "compass");
	btn.innerHTML = COMPASS_MARKUP;
	const rotor = btn.querySelector<HTMLElement>(".compass-rotor")!;
	const bubble = btn.querySelector<HTMLElement>(".compass-n")!;

	// North on screen = image bearing (northOffset) + viewport rotation; needle + N point there.
	let lastDeg = Number.NaN;
	const apply = (deg: number): void => {
		if (deg === lastDeg) return; // update-viewport also fires on pan/zoom - skip those
		lastDeg = deg;
		rotor.style.transform = `rotate(${deg}deg)`;
		bubble.style.transform = `translate(-50%, -50%) rotate(${deg}deg) translateY(-${RIM}px)`;
	};
	apply(opts.northOffset); // baseline before "open"
	viewer.addHandler("update-viewport", () => apply(opts.northOffset + viewer.viewport.getRotation()));

	let locked = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let longPressed = false;

	// Long-press lock: disable gestures + swap to the padlock icon.
	const applyLock = (v: boolean): void => {
		locked = v;
		opts.setRotationLocked(v);
		btn.classList.toggle("locked", v);
		btn.setAttribute("aria-pressed", String(v));
		btn.setAttribute("data-i18n-aria", v ? "compassLocked" : "compass");
		btn.setAttribute("aria-label", t(v ? "compassLocked" : "compass"));
	};

	const clearTimer = (): void => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	// Ripple on lock/unlock - the finger covers the icon, so this is the visible cue.
	const pulse = (): void => {
		btn.classList.remove("pulsing");
		void btn.offsetWidth; // reflow so the animation restarts on every toggle
		btn.classList.add("pulsing");
	};
	btn.addEventListener("animationend", () => btn.classList.remove("pulsing"));

	btn.addEventListener("pointerdown", () => {
		longPressed = false;
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			longPressed = true;
			applyLock(!locked);
			pulse();
			navigator.vibrate?.(20);
		}, LONG_PRESS_MS);
	});
	btn.addEventListener("pointerup", clearTimer);
	btn.addEventListener("pointercancel", clearTimer);
	btn.addEventListener("pointerleave", clearTimer);

	btn.addEventListener("click", () => {
		if (longPressed) {
			longPressed = false; // the press was a lock toggle, not a tap
			return;
		}
		if (viewer.viewport) viewer.viewport.setRotation(0); // animated straighten
	});

	fab.addSatellite(btn);

	return {
		setEnabled(on: boolean): void {
			btn.hidden = !on;
			fab.reposition();
			if (on) {
				applyLock(false); // show: rotation enabled, unlocked
			} else {
				// Hide: lock gestures, straighten, and clear the lock visual for next time.
				opts.setRotationLocked(true);
				if (viewer.viewport) viewer.viewport.setRotation(0);
				locked = false;
				btn.classList.remove("locked");
			}
		},
	};
}
