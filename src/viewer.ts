import OpenSeadragon from "openseadragon";
import { initRotate, setViewportRotation } from "./rotate.js";
import { initUpright } from "./upright.js";
import type { AppConfig, PersistedState } from "./types.js";

export interface ViewerResult {
	viewer: OpenSeadragon.Viewer;
	svgEl: SVGSVGElement;
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
		showNavigator: false,
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

	return { viewer, svgEl, setRotationLocked: rotate.setLocked };
}
