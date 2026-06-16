import OpenSeadragon from "openseadragon";
import { initRotate, setViewportRotation } from "./rotate.js";
import { initUpright } from "./upright.js";
import type { AppConfig, PersistedState } from "./types.js";

export interface ViewerResult {
	viewer: OpenSeadragon.Viewer;
	svgEl: SVGSVGElement;
	/** Show/hide the navigator (minimap). */
	setMinimapVisible: (visible: boolean) => void;
	/** Enable/disable the rotation gestures (compass long-press lock). */
	setRotationLocked: (locked: boolean) => void;
}

export function initViewer(
	container: HTMLElement,
	cfg: AppConfig,
	svgDoc: Document,
	state: PersistedState,
	onViewChange: (x: number, y: number, zoom: number, rotation: number) => void,
): ViewerResult {
	const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svgEl.setAttribute("viewBox", `0 0 ${cfg.imageWidth} ${cfg.imageHeight}`);
	svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
	svgEl.style.width = "100%";
	svgEl.style.height = "100%";
	svgEl.style.pointerEvents = "none";

	// Carry over <defs>/<style> too (e.g. .st0 fill rules) - only adopted nodes render.
	for (const node of Array.from(svgDoc.querySelectorAll("svg > defs, svg > style"))) {
		svgEl.appendChild(document.adoptNode(node));
	}

	// Scale the source SVG into image-pixel space (svgScale = image px per SVG unit).
	const scale = cfg.svgScale ?? 1;
	const scaleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
	if (scale !== 1) scaleGroup.setAttribute("transform", `scale(${scale})`);

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
		navigatorPosition: "TOP_LEFT",
		navigatorAutoFade: false,
		navigatorSizeRatio: 0.1, // initial size; sizeNavigator() takes over responsively
		maxZoomPixelRatio: 2.5, // zoom past native pixels (OSD's ~1.1 default is too low on desktop)
		animationTime: 0.4,
		springStiffness: 7,
		gestureSettingsTouch: {
			pinchToZoom: true,
			flickEnabled: true,
			// Tame the post-release glide: harder to trigger (default 120), carries less (default 0.25).
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
		// Let the image pan partly off-screen (to center a corner) instead of snapping back.
		visibilityRatio: 0.5,
		constrainDuringPan: false,
		minZoomImageRatio: 0.5,
		showRotationControl: false,
		showZoomControl: false,
		showHomeControl: false,
		showFullPageControl: false,
	});

	const setRotation = (degrees: number, immediately = true): void => {
		setViewportRotation(viewer.viewport, degrees, immediately);
	};

	viewer.addHandler("open", () => {
		// Overlay covers the whole image, in viewport coords.
		const rect = viewer.viewport.imageToViewportRectangle(
			new OpenSeadragon.Rect(0, 0, cfg.imageWidth, cfg.imageHeight),
		);
		// EXACT mode rotates the overlay (+ draw strokes) with the map.
		// (Cast: OSD's type wants HTMLElement but accepts any Element.)
		viewer.addOverlay({
			element: svgEl as unknown as HTMLElement,
			location: rect,
			rotationMode: OpenSeadragon.OverlayRotationMode.EXACT,
		});

		// Restore a shared view (incl. rotation), else fit home. localStorage never restores the view.
		if (state.view) {
			viewer.viewport.panTo(new OpenSeadragon.Point(state.view.x, state.view.y), true);
			viewer.viewport.zoomTo(state.view.zoom, undefined, true);
			setRotation(state.view.rotation ?? 0, true);
		} else {
			viewer.viewport.goHome(true);
		}

		// Detect the minimap double-tap ourselves (capture phase) - OSD's navigator eats dblclick.
		const navEl = getNav()?.element ?? null;
		if (navEl) {
			let lastTap = 0;
			// Swallow the reset tap so it doesn't also pan; single taps pass through.
			const swallow = (ev: Event): void => {
				ev.stopPropagation();
				ev.preventDefault();
			};
			navEl.addEventListener(
				"pointerdown",
				(e: PointerEvent) => {
					const now = performance.now();
					if (now - lastTap < 400) {
						// Second tap = reset. Block this gesture (OSD also pans on up/click), release for the next.
						lastTap = 0;
						swallow(e);
						navEl.addEventListener("pointerup", swallow, true);
						navEl.addEventListener("click", swallow, true);
						setTimeout(() => {
							navEl.removeEventListener("pointerup", swallow, true);
							navEl.removeEventListener("click", swallow, true);
						}, 500);
						// Straighten before goHome - goHome fits at the current rotation.
						setRotation(0, true);
						viewer.viewport.goHome();
					} else {
						lastTap = now;
					}
				},
				true, // capture: run before OSD's own pointer handling
			);
		}

		sizeNavigator();
		setMinimapVisible(state.minimap);

		// Billboard upright: true layers (e.g. corner numbers) to stay screen-upright when rotated.
		initUpright(viewer, svgEl, cfg);
	});

	viewer.addHandler("animation-finish", () => {
		const center = viewer.viewport.getCenter();
		onViewChange(center.x, center.y, viewer.viewport.getZoom(), viewer.viewport.getRotation());
	});

	// Free-angle rotation (two-finger twist / right-drag); report the settled angle for share links.
	const rotate = initRotate(viewer, (rotation) => {
		const center = viewer.viewport.getCenter();
		onViewChange(center.x, center.y, viewer.viewport.getZoom(), rotation);
	});

	// OSD's navigator has class "navigator"; reach it via the API, not a class query.
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

	// Size the navigator in JS (OSD drives its canvas via updateSize) to a vmin fraction, keeping aspect.
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

	// Hide via the Control's setVisible (cleaner than display:none on the element).
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

	return { viewer, svgEl, setMinimapVisible, setRotationLocked: rotate.setLocked };
}
