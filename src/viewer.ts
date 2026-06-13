import OpenSeadragon from "openseadragon";
import type { AppConfig, PersistedState } from "./types.js";

export interface ViewerResult {
	viewer: OpenSeadragon.Viewer;
	svgEl: SVGSVGElement;
	/** Show/hide the navigator (minimap). */
	setMinimapVisible: (visible: boolean) => void;
}

export function initViewer(
	container: HTMLElement,
	cfg: AppConfig,
	svgDoc: Document,
	state: PersistedState,
	onViewChange: (x: number, y: number, zoom: number) => void,
): ViewerResult {
	// Build the SVG overlay element
	const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svgEl.setAttribute("viewBox", `0 0 ${cfg.imageWidth} ${cfg.imageHeight}`);
	svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
	svgEl.style.width = "100%";
	svgEl.style.height = "100%";
	svgEl.style.pointerEvents = "none";

	// Preserve <defs> and <style> from the source SVG (e.g. class-based fill-rule
	// like `.st0`). Only adopted nodes render, so these must come along too.
	for (const node of Array.from(svgDoc.querySelectorAll("svg > defs, svg > style"))) {
		svgEl.appendChild(document.adoptNode(node));
	}

	// The source SVG may use its own coordinate units; scale it into image-pixel
	// space via the configurable svgScale (image px per SVG user unit).
	const scale = cfg.svgScale ?? 1;
	const scaleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
	if (scale !== 1) scaleGroup.setAttribute("transform", `scale(${scale})`);

	// Adopt all <g> elements from the parsed SVG document into the overlay
	const sourceGroups = Array.from(svgDoc.querySelectorAll("svg > g"));
	for (const g of sourceGroups) {
		g.classList.add("layer-group");
		scaleGroup.appendChild(document.adoptNode(g));
	}
	svgEl.appendChild(scaleGroup);

	const viewer = new OpenSeadragon.Viewer({
		element: container,
		tileSources: cfg.tileSource ?? "/tiles/track.dzi",
		showNavigator: true,
		navigatorPosition: "TOP_RIGHT",
		navigatorAutoFade: false,
		navigatorSizeRatio: 0.1, // initial size; sizeNavigator() takes over responsively
		// Allow zooming in well past native pixels (default ~1.1 capped desktop too low)
		maxZoomPixelRatio: 2.5,
		animationTime: 0.4,
		springStiffness: 7,
		gestureSettingsTouch: {
			pinchToZoom: true,
			flickEnabled: true,
			// Tame the post-release glide: require a faster flick to trigger
			// momentum (default 120) and carry far less of it (default 0.25).
			flickMinSpeed: 300,
			flickMomentum: 0.1,
			dblClickToZoom: false,
			clickToZoom: false,
		} as OpenSeadragon.GestureSettings,
		gestureSettingsMouse: {
			scrollToZoom: true,
			clickToZoom: false,
			dblClickToZoom: false,
		} as OpenSeadragon.GestureSettings,
		// Allow panning the image partly off-screen (so a corner can be centered)
		// instead of snapping back to fill the viewport.
		visibilityRatio: 0.5,
		constrainDuringPan: false,
		minZoomImageRatio: 0.5,
		showRotationControl: false,
		showZoomControl: false,
		showHomeControl: false,
		showFullPageControl: false,
	});

	viewer.addHandler("open", () => {
		// Place SVG overlay to cover the entire image in viewport coordinates
		const rect = viewer.viewport.imageToViewportRectangle(
			new OpenSeadragon.Rect(0, 0, cfg.imageWidth, cfg.imageHeight),
		);
		// OSD types want an HTMLElement, but it accepts any Element at runtime.
		viewer.addOverlay({ element: svgEl as unknown as HTMLElement, location: rect });

		// Restore saved view or go home
		if (state.view) {
			viewer.viewport.panTo(new OpenSeadragon.Point(state.view.x, state.view.y), true);
			viewer.viewport.zoomTo(state.view.zoom, undefined, true);
		} else {
			viewer.viewport.goHome(true);
		}

		// Reset view on minimap double-click / double-tap. OSD's navigator captures
		// the pointer (a second MouseTracker or DOM dblclick on it never fires), so
		// detect the double-tap ourselves in the capture phase.
		const navEl = getNav()?.element ?? null;
		if (navEl) {
			let lastTap = 0;
			// Swallow events so the reset tap doesn't also pan. Single taps pass through,
			// so the navigator's normal click-to-move still works.
			const swallow = (ev: Event): void => {
				ev.stopPropagation();
				ev.preventDefault();
			};
			navEl.addEventListener(
				"pointerdown",
				(e: PointerEvent) => {
					const now = performance.now();
					if (now - lastTap < 400) {
						// Second tap → reset only. Block this tap's full gesture (OSD pans on
						// pointerup/click too), then stop blocking so the next tap navigates.
						lastTap = 0;
						swallow(e);
						navEl.addEventListener("pointerup", swallow, true);
						navEl.addEventListener("click", swallow, true);
						setTimeout(() => {
							navEl.removeEventListener("pointerup", swallow, true);
							navEl.removeEventListener("click", swallow, true);
						}, 500);
						viewer.viewport.goHome();
					} else {
						lastTap = now;
					}
				},
				true, // capture: run before OSD's own pointer handling
			);
		}

		// Size the minimap responsively, then apply persisted visibility.
		sizeNavigator();
		setMinimapVisible(state.minimap);
	});

	viewer.addHandler("animation-finish", () => {
		const center = viewer.viewport.getCenter();
		onViewChange(center.x, center.y, viewer.viewport.getZoom());
	});

	// OSD's navigator element has class `navigator` (NOT `openseadragon-navigator`),
	// so reach it via the API rather than a class query.
	interface Nav {
		element: HTMLElement;
		updateSize?: () => void;
	}
	interface Ctrl {
		element: HTMLElement;
		setVisible: (v: boolean) => void;
	}
	function getNav(): Nav | undefined {
		return (viewer as unknown as { navigator?: Nav }).navigator;
	}

	// Size the navigator to a fraction of the smaller viewport edge (vmin), keeping
	// the image aspect — so it rescales on resize and landscape↔portrait. CSS can't
	// do this alone because OSD sizes the navigator's canvas in JS via updateSize().
	function sizeNavigator(): void {
		const nav = getNav();
		if (!nav?.element) return;
		const vmin = Math.min(window.innerWidth, window.innerHeight);
		const major = Math.max(110, Math.min(vmin * 0.35, 240)); // longer edge, px
		const aspect = cfg.imageWidth / cfg.imageHeight;
		const w = aspect >= 1 ? major : Math.round(major * aspect);
		const h = aspect >= 1 ? Math.round(major / aspect) : major;
		nav.element.style.width = `${w}px`;
		nav.element.style.height = `${h}px`;
		nav.updateSize?.();
	}

	// Toggle the navigator via its Control's setVisible (hides the wrapper cleanly).
	function setMinimapVisible(visible: boolean): void {
		const navEl = getNav()?.element;
		if (!navEl) return;
		const controls = (viewer as unknown as { controls?: Ctrl[] }).controls ?? [];
		const ctrl = controls.find((c) => c.element === navEl);
		if (ctrl) ctrl.setVisible(visible);
		else if (navEl.parentElement) navEl.parentElement.style.display = visible ? "" : "none";
	}

	const onResize = (): void => {
		requestAnimationFrame(sizeNavigator);
	};
	window.addEventListener("resize", onResize);
	window.addEventListener("orientationchange", onResize);

	return { viewer, svgEl, setMinimapVisible };
}
