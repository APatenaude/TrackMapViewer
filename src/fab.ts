import type { FabCorner, PersistedState } from "./types.js";

const DRAG_THRESHOLD = 8;
const MARGIN = 16;

const ICON_ATTRS =
	'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"';
// Hamburger (drawer closed)
const MENU_ICON = `<svg ${ICON_ATTRS}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
// X (drawer open)
const CLOSE_ICON = `<svg ${ICON_ATTRS}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

function snapToCorner(fab: HTMLElement, corner: FabCorner): void {
	fab.style.top = "";
	fab.style.right = "";
	fab.style.bottom = "";
	fab.style.left = "";
	switch (corner) {
		case "tl":
			fab.style.top = `${MARGIN}px`;
			fab.style.left = `${MARGIN}px`;
			break;
		case "tr":
			fab.style.top = `${MARGIN}px`;
			fab.style.right = `${MARGIN}px`;
			break;
		case "bl":
			fab.style.bottom = `${MARGIN}px`;
			fab.style.left = `${MARGIN}px`;
			break;
		case "br":
			fab.style.bottom = `${MARGIN}px`;
			fab.style.right = `${MARGIN}px`;
			break;
	}
}

function nearestCorner(clientX: number, clientY: number): FabCorner {
	const cx = window.innerWidth / 2;
	const cy = window.innerHeight / 2;
	return `${clientY < cy ? "t" : "b"}${clientX < cx ? "l" : "r"}` as FabCorner;
}

export interface FabResult {
	el: HTMLElement;
	/** Offset the FAB clear of the drawer while it's open; restore on close. */
	setPanelOpen: (open: boolean) => void;
}

// Keep in sync with the desktop side-panel width in style.css.
const PANEL_WIDTH = 288;

export function initFab(state: PersistedState, onTap: () => void, onStateChange: () => void): FabResult {
	const fab = document.createElement("button");
	fab.className = "fab";
	fab.setAttribute("data-i18n-aria", "openLayersPanel");
	fab.innerHTML = MENU_ICON;

	// Apply saved corner immediately (no transition on initial placement)
	fab.style.transition = "none";
	snapToCorner(fab, state.fabCorner);
	// Re-enable transition after layout (rAF ensures the no-transition placement is painted first)
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			fab.style.transition = "";
		});
	});

	let isDragging = false;
	let startX = 0;
	let startY = 0;
	let dragOffsetX = 0;
	let dragOffsetY = 0;

	fab.addEventListener("pointerdown", (e) => {
		e.stopPropagation();
		fab.setPointerCapture(e.pointerId);
		startX = e.clientX;
		startY = e.clientY;
		isDragging = false;

		// Store offset from fab center to pointer
		const rect = fab.getBoundingClientRect();
		dragOffsetX = e.clientX - (rect.left + rect.width / 2);
		dragOffsetY = e.clientY - (rect.top + rect.height / 2);
	});

	fab.addEventListener("pointermove", (e) => {
		if (!fab.hasPointerCapture(e.pointerId)) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
			isDragging = true;
			fab.style.transition = "none";
			// Switch to absolute positioning during drag
			fab.style.top = "";
			fab.style.right = "";
			fab.style.bottom = "";
			fab.style.left = "";
		}
		if (isDragging) {
			const x = e.clientX - dragOffsetX - fab.offsetWidth / 2;
			const y = e.clientY - dragOffsetY - fab.offsetHeight / 2;
			fab.style.left = `${Math.max(0, Math.min(window.innerWidth - fab.offsetWidth, x))}px`;
			fab.style.top = `${Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, y))}px`;
		}
	});

	fab.addEventListener("pointerup", (e) => {
		e.stopPropagation();
		if (isDragging) {
			state.fabCorner = nearestCorner(e.clientX, e.clientY);
			fab.style.transition = "";
			positionFab(); // snap to the new corner, re-applying the open offset if open
			onStateChange();
		} else {
			onTap();
		}
		isDragging = false;
	});

	// Prevent context menu on long-press (mobile)
	fab.addEventListener("contextmenu", (e) => e.preventDefault());

	let panelOpen = false;

	// When the drawer is open, nudge the FAB along its current edge just enough to
	// clear the panel (and its ✕) — only when its corner is on the drawer's side.
	function applyOpenOffset(): void {
		const desktop = window.matchMedia("(min-width: 768px)").matches;
		if (desktop) {
			// Desktop drawer slides in from the left.
			if (state.fabCorner === "tl" || state.fabCorner === "bl") {
				fab.style.left = `${PANEL_WIDTH + MARGIN + 8}px`;
			}
		} else {
			// Mobile drawer is a bottom sheet — lift the FAB above it.
			if (state.fabCorner === "bl" || state.fabCorner === "br") {
				const panel = document.getElementById("panel");
				const h = panel ? panel.offsetHeight : 0;
				fab.style.bottom = `${h + MARGIN}px`;
			}
		}
	}

	// Snap to the current corner, then apply the drawer-open offset if the drawer
	// is open (so dragging the FAB while open keeps it clear of the panel).
	function positionFab(): void {
		snapToCorner(fab, state.fabCorner);
		if (panelOpen) applyOpenOffset();
	}

	function setPanelOpen(open: boolean): void {
		panelOpen = open;
		fab.innerHTML = open ? CLOSE_ICON : MENU_ICON;
		positionFab();
	}

	document.body.appendChild(fab);
	return { el: fab, setPanelOpen };
}
