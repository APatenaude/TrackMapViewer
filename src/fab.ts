const MARGIN = 16;
const FAB_SIZE = 56; // keep in sync with .fab in style.css
const MINI_SIZE = 44; // keep in sync with .fab-mini in style.css
const STACK_GAP = 12; // vertical gap between stacked buttons

// Keep in sync with the desktop side-panel width in style.css.
const PANEL_WIDTH = 288;

const ICON_ATTRS =
	'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" aria-hidden="true"';
const MENU_ICON = `<svg ${ICON_ATTRS}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
const CLOSE_ICON = `<svg ${ICON_ATTRS}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

export interface FabResult {
	el: HTMLElement;
	/** Offset the FAB clear of the drawer while it's open; restore on close. */
	setPanelOpen: (open: boolean) => void;
	/** Register a satellite button (e.g. the draw FAB) that stacks beneath the
	 *  main FAB and follows its panel offset. */
	addSatellite: (el: HTMLElement) => void;
}

/**
 * Floating action button, fixed at the top-right corner. Toggles the options
 * drawer.
 */
export function initFab(onTap: () => void): FabResult {
	const fab = document.createElement("button");
	fab.className = "fab";
	fab.setAttribute("data-i18n-aria", "openLayersPanel");
	fab.innerHTML = MENU_ICON;

	let panelOpen = false;
	const satellites: HTMLElement[] = [];

	// Place the FAB at the top-right (shifted left of the open desktop drawer),
	// then stack satellites directly beneath it, centered under the 56px FAB.
	function position(): void {
		const desktop = window.matchMedia("(min-width: 768px)").matches;
		const right = panelOpen && desktop ? PANEL_WIDTH + MARGIN + 8 : MARGIN;
		// Add the iOS safe-area insets so viewport-fit=cover doesn't tuck the
		// buttons under the status bar / notch (env() is 0 on desktop).
		fab.style.top = `calc(env(safe-area-inset-top, 0px) + ${MARGIN}px)`;
		fab.style.right = `calc(env(safe-area-inset-right, 0px) + ${right}px)`;

		const satRight = right + (FAB_SIZE - MINI_SIZE) / 2;
		let satTop = MARGIN + FAB_SIZE + STACK_GAP;
		for (const sat of satellites) {
			sat.style.top = `calc(env(safe-area-inset-top, 0px) + ${satTop}px)`;
			sat.style.right = `calc(env(safe-area-inset-right, 0px) + ${satRight}px)`;
			satTop += MINI_SIZE + STACK_GAP;
		}
	}

	fab.addEventListener("click", onTap);

	function setPanelOpen(open: boolean): void {
		panelOpen = open;
		fab.innerHTML = open ? CLOSE_ICON : MENU_ICON;
		position();
	}

	function addSatellite(el: HTMLElement): void {
		satellites.push(el);
		document.body.appendChild(el);
		position();
	}

	// Recompute on viewport changes: crossing the 768px breakpoint or rotating
	// while the panel is open changes the drawer offset.
	window.addEventListener("resize", position);
	window.addEventListener("orientationchange", position);

	document.body.appendChild(fab);
	position();
	return { el: fab, setPanelOpen, addSatellite };
}
