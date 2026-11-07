import OpenSeadragon from "openseadragon";
import { initRotate, setViewportRotation, type RotateController } from "./rotate.js";
import type { TrackDoc } from "./trackDoc.js";
import { createLayerGroups, renderTrack } from "./trackRender.js";
import { initUpright, type UprightController } from "./upright.js";
import type { AppConfig, PersistedState } from "./types.js";

export interface ViewerResult {
	viewer: OpenSeadragon.Viewer;
	svgEl: SVGSVGElement;
	/** Enable/disable the rotation gestures (compass long-press lock). */
	setRotationLocked: (locked: boolean) => void;
	/** Rotation gestures pivot on this container pixel when it returns one (see rotate.ts setPivot). */
	setRotationPivot: RotateController["setPivot"];
	/** Redraw the overlay for another racing line of the track. */
	setLine: (lineId: string) => void;
}

export function initViewer(
	container: HTMLElement,
	cfg: AppConfig,
	doc: TrackDoc,
	tileSource: TileSource,
	lineId: string | undefined,
	state: PersistedState,
	onViewChange: (x: number, y: number, zoom: number, rotation: number) => void,
): ViewerResult {
	const { width, height } = doc.image;
	const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
	svgEl.style.width = "100%";
	svgEl.style.height = "100%";
	svgEl.style.pointerEvents = "none";

	// The groups stay for the page's life (layer toggles hold them); a line switch refills them.
	const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
	svgEl.appendChild(defs);
	const groups = createLayerGroups();
	for (const g of groups.values()) svgEl.appendChild(g);
	renderTrack(doc, lineId, groups, defs);

	let upright: UprightController | null = null;

	const viewer = createOsd(container, tileSource);

	const setRotation = (degrees: number, immediately = true): void => {
		setViewportRotation(viewer.viewport, degrees, immediately);
	};

	viewer.addHandler("open", () => {
		// Overlay covers the whole image, in viewport coords.
		const rect = viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(0, 0, width, height));
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
		upright = initUpright(viewer, svgEl, cfg);
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

	return {
		viewer,
		svgEl,
		setRotationLocked: rotate.setLocked,
		setRotationPivot: rotate.setPivot,
		setLine(id: string): void {
			renderTrack(doc, id, groups, defs);
			upright?.refresh();
		},
	};
}

/** Tile source: a DZI URL, or a single local image (`{ type: "image", url }`) before it is tiled. */
export type TileSource = string | { type: "image"; url: string };

/** The map viewer with the app's gesture and zoom settings (shared with the editor). */
export function createOsd(container: HTMLElement, tileSource: TileSource): OpenSeadragon.Viewer {
	return new OpenSeadragon.Viewer({
		element: container,
		tileSources: tileSource as OpenSeadragon.Options["tileSources"],
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
}
