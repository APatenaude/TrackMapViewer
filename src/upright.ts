import type OpenSeadragon from "openseadragon";
import type { AppConfig } from "./types.js";

interface Billboard {
	el: SVGGraphicsElement;
	base: string; // the marker's original transform attribute
	px: number; // pivot (its own centre) in the parent's coordinate space
	py: number;
}

/**
 * Keep `upright: true` layers readable under rotation: the overlay rotates +R with
 * the map, so counter-rotating each direct-child marker by −R about its own centre
 * nets zero rotation for the glyph while its anchor still rides the map.
 *
 * Assumes the other SVG transforms are uniform scale/translate (angle-preserving).
 * Best for one-<g>-per-marker layers (corner numbers). Call once the overlay is in
 * the DOM (OSD "open"), so getBBox() works.
 */
export function initUpright(viewer: OpenSeadragon.Viewer, svgEl: SVGSVGElement, cfg: AppConfig): void {
	const ids = cfg.layers.filter((l) => l.upright).map((l) => l.id);
	if (ids.length === 0) return;

	const items: Billboard[] = [];
	for (const id of ids) {
		const group = svgEl.querySelector<SVGGraphicsElement>(`#${CSS.escape(id)}`);
		if (!group) continue;
		for (const child of Array.from(group.children)) {
			if (!(child instanceof SVGGraphicsElement)) continue;
			const bbox = child.getBBox();
			const cx = bbox.x + bbox.width / 2;
			const cy = bbox.y + bbox.height / 2;
			// Marker centre in parent space (where the rotate() we prepend applies).
			const m = child.transform.baseVal.consolidate()?.matrix;
			const p = m ? new DOMPoint(cx, cy).matrixTransform(m) : { x: cx, y: cy };
			items.push({ el: child, base: child.getAttribute("transform") ?? "", px: p.x, py: p.y });
		}
	}
	if (items.length === 0) return;

	let last = Number.NaN;
	const update = (): void => {
		const r = viewer.viewport.getRotation();
		if (r === last) return; // rotation unchanged (pan/zoom frames) - skip
		last = r;
		for (const it of items) {
			it.el.setAttribute("transform", `rotate(${-r} ${it.px} ${it.py})${it.base ? ` ${it.base}` : ""}`);
		}
	};
	update();
	viewer.addHandler("update-viewport", update);
}
