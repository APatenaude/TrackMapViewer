import OpenSeadragon from "openseadragon";
import { linePathD } from "../lineGeometry.js";
import type { Point } from "../replayPath.js";
import type { TrackDoc } from "../trackDoc.js";
import { createLayerGroups, renderTrack, type LayerGroupId } from "../trackRender.js";
import { createOsd, type TileSource } from "../viewer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The editor's map: the track drawn exactly as the viewer draws it (image-pixel overlay),
 * the other lines as faint ghosts, and a screen-space layer on top where the editing grips
 * are drawn at a constant size (redrawn on every pan/zoom frame). Rotation stays at 0.
 */
export class EditCanvas {
	readonly viewer: OpenSeadragon.Viewer;
	readonly container: HTMLElement;
	/** Screen-space layer (container px) for grips, highlights and labels. */
	readonly screen: SVGSVGElement;
	private readonly svgEl: SVGSVGElement;
	private readonly groups = createLayerGroups();
	private readonly defs: SVGDefsElement;
	private readonly ghosts: SVGGElement;
	private gripsQueued = false;
	/** Called to (re)draw the screen layer; set by the interaction layer. */
	drawScreen: (layer: SVGSVGElement) => void = () => {};
	/** Braking zones the last full render couldn't draw. */
	skipped: string[] = [];
	readonly ready: Promise<void>;

	constructor(element: HTMLElement, tileSource: TileSource, width: number, height: number) {
		this.svgEl = document.createElementNS(SVG_NS, "svg");
		this.svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
		this.svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
		this.svgEl.style.cssText = "width:100%;height:100%;pointer-events:none";
		this.ghosts = document.createElementNS(SVG_NS, "g");
		this.ghosts.setAttribute("class", "editor-ghosts");
		this.defs = document.createElementNS(SVG_NS, "defs");
		this.svgEl.append(this.defs, this.ghosts, ...this.groups.values());

		this.viewer = createOsd(element, tileSource);
		this.container = this.viewer.container;
		this.screen = document.createElementNS(SVG_NS, "svg");
		this.screen.setAttribute("class", "editor-screen");
		this.container.appendChild(this.screen);

		this.ready = new Promise((resolve) => {
			this.viewer.addHandler("open", () => {
				const rect = this.viewer.viewport.imageToViewportRectangle(new OpenSeadragon.Rect(0, 0, width, height));
				this.viewer.addOverlay({ element: this.svgEl as unknown as HTMLElement, location: rect });
				this.viewer.viewport.goHome(true);
				resolve();
			});
		});
		this.viewer.addHandler("update-viewport", () => this.requestScreen());
		this.viewer.addHandler("resize", () => this.requestScreen());
	}

	/** Draw the track layers (`only` = just those groups, during a drag) and the ghost lines. */
	render(doc: TrackDoc, activeLine: string | undefined, only?: ReadonlySet<LayerGroupId>): void {
		const res = renderTrack(doc, activeLine, this.groups, this.defs, only);
		if (!only) this.skipped = res.skipped;
		if (!only || only.has("racing_line")) {
			this.ghosts.replaceChildren();
			for (const l of doc.lines) {
				if (l.id === activeLine || l.nodes.length < 2) continue;
				const p = document.createElementNS(SVG_NS, "path");
				p.setAttribute("d", linePathD(l.nodes));
				p.setAttribute("class", "editor-ghost");
				this.ghosts.appendChild(p);
			}
		}
		this.requestScreen();
	}

	requestScreen(): void {
		if (this.gripsQueued) return;
		this.gripsQueued = true;
		requestAnimationFrame(() => {
			this.gripsQueued = false;
			this.drawScreen(this.screen);
		});
	}

	/** Image px -> container px. */
	toScreen(p: Point): Point {
		const q = this.viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(p.x, p.y));
		return { x: q.x, y: q.y };
	}

	/** Container px -> image px. */
	toImage(x: number, y: number): Point {
		const q = this.viewer.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(x, y));
		return { x: q.x, y: q.y };
	}

	/** Container px from a pointer event. */
	local(e: { clientX: number; clientY: number }): Point {
		const r = this.container.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	/** Screen px per image px at the current zoom. */
	scale(): number {
		const a = this.toScreen({ x: 0, y: 0 });
		const b = this.toScreen({ x: 1000, y: 0 });
		return Math.hypot(b.x - a.x, b.y - a.y) / 1000;
	}

	/** Centre the view on an image point, zooming in so about `spanPx` image px fit. */
	focus(p: Point, spanPx = 1500): void {
		const vp = this.viewer.viewport;
		const size = vp.getContainerSize();
		const zoom = vp.imageToViewportZoom(Math.min(size.x, size.y) / spanPx);
		vp.zoomTo(Math.max(vp.getZoom(), zoom));
		vp.panTo(vp.imageToViewportCoordinates(new OpenSeadragon.Point(p.x, p.y)));
	}
}
