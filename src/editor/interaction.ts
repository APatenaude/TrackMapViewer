import { flattenLine, nodeHandles } from "../lineGeometry.js";
import type { Point } from "../replayPath.js";
import type { LineNode, Marker, MarkerKind, RacingLine, TrackDoc, Vec } from "../trackDoc.js";
import { lineTrace, type LayerGroupId } from "../trackRender.js";
import { anchorLine, anchorOf } from "./anchors.js";
import type { EditCanvas } from "./canvas.js";
import {
	addBraking,
	addMarker,
	addNode,
	addPassing,
	deleteMarker,
	deleteNode,
	deleteZone,
	insertNode,
	isClosed,
	isSmoothNode,
	lineById,
	MIN_LINE_NODES,
	moveNode,
	pathNodes,
	setBrakingEnd,
	setHandle,
	updateMarker,
	type PathRef,
} from "./ops.js";
import type { EditorStore } from "./store.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export type ToolId = "select" | "points" | "braking" | "passing" | "marker";

/** What the marker tool places. */
export interface MarkerTemplate {
	kind: MarkerKind;
	icon?: string;
	text?: string;
}

type Hit =
	| { type: "handle"; path: PathRef; node: string; which: "in" | "out" }
	| { type: "node"; path: PathRef; node: string }
	| { type: "zoneEnd"; zone: string; end: "from" | "to" }
	| { type: "marker"; marker: string }
	| { type: "zone"; zone: string }
	| { type: "line"; line: string; at: Point };

interface Drag {
	/** Groups to redraw while dragging. */
	only: ReadonlySet<LayerGroupId>;
	update(img: Point, alt: boolean): void;
}

const TAP_SLOP_PX = 5;
const TAP_MS = 600;
// Show every node only when they are this far apart on screen; else just the selection's.
const NODE_SPACING_PX = 14;
const LABEL_SPACING_PX = 34;

const MARKER_LAYER: Record<MarkerKind, LayerGroupId> = {
	corner: "corner_numbers",
	label: "corner_numbers",
	apex: "apex",
	reference: "references",
	crest: "compression_crest",
	car: "cars",
};

const TOOL_HINTS: Record<ToolId, string> = {
	select: "Click a point, zone or marker to select it. Drag grips to move them; drag the map to pan.",
	points: "Click on the line to add a point there. With a point selected, click beside it to add the next one.",
	braking: "Click on the line where braking starts, then where it ends.",
	passing: "Click to draw the passing zone beside the track, then Done (or Enter).",
	marker: "Click on the map to place the marker. Esc to stop.",
};

/**
 * Pointer handling and tools on top of the editor canvas. Listens in the capture phase
 * on the viewer container (like draw.ts): a pointerdown on a grip starts a drag and keeps
 * OSD from panning; anything else is left to OSD (pan, pinch, wheel), and a short press
 * without movement counts as a tap for the current tool.
 */
export class Interaction {
	tool: ToolId = "select";
	markerTemplate: MarkerTemplate | null = null;
	/** Braking tool: the start already clicked. */
	pendingFrom: Vec | null = null;
	/** Passing tool: points placed so far. */
	passingDraft: Point[] = [];
	/** Points tool: a new line being drawn (append on every click). */
	drawingLine = false;
	onChange: () => void = () => {};
	private touch = false;
	private pointers = new Set<number>();
	private down: { id: number; s: Point; time: number; hit: Hit | null; moved: boolean; mouse: boolean } | null = null;
	private drag: Drag | null = null;

	constructor(
		private readonly canvas: EditCanvas,
		private readonly store: EditorStore,
	) {
		const c = canvas.container;
		c.addEventListener("pointerdown", (e) => this.onDown(e), true);
		c.addEventListener("pointermove", (e) => this.onMove(e), true);
		window.addEventListener("pointerup", (e) => this.onUp(e), true);
		window.addEventListener("pointercancel", (e) => this.onUp(e, true), true);
		// Alt-tab mid-drag can swallow the pointerup: drop the drag instead of leaving it stuck.
		window.addEventListener("blur", () => {
			this.abortDrag();
			this.pointers.clear();
		});
		canvas.drawScreen = (layer) => this.drawScreen(layer);
	}

	/** Groups to redraw while a drag is in progress (undefined = redraw everything). */
	get dragOnly(): ReadonlySet<LayerGroupId> | undefined {
		return this.drag?.only;
	}

	hint(): string {
		if (this.tool === "points" && this.drawingLine)
			return "Click to place the new line's points in driving order. Done (or Enter) when the loop is complete.";
		if (this.tool === "braking" && this.pendingFrom) return "Now click where braking ends.";
		return TOOL_HINTS[this.tool];
	}

	setTool(tool: ToolId, template?: MarkerTemplate): void {
		this.tool = tool;
		this.markerTemplate = tool === "marker" ? (template ?? this.markerTemplate) : null;
		this.pendingFrom = null;
		if (tool !== "passing") this.passingDraft = [];
		if (tool !== "points") this.drawingLine = false;
		this.canvas.container.style.cursor = tool === "select" ? "" : "crosshair";
		this.onChange();
		this.canvas.requestScreen();
	}

	/** Start drawing a new line (after addLine made it active). */
	startDrawing(): void {
		this.setTool("points");
		this.drawingLine = true;
		this.onChange();
	}

	/** Finish the tool's current action (Done button / Enter). */
	finish(): void {
		if (this.tool === "passing" && this.passingDraft.length >= 2) {
			const nodes: LineNode[] = this.passingDraft.map((p, i) => ({ id: `p${i + 1}`, x: r1(p.x), y: r1(p.y) }));
			const { doc, zoneId } = addPassing(this.store.base, nodes);
			this.store.commit(doc);
			this.store.select({ type: "zone", zone: zoneId });
			this.passingDraft = [];
		}
		this.drawingLine = false;
		this.setTool("select");
	}

	/** Drop a drag in progress without committing it. */
	private abortDrag(): void {
		if (this.drag) {
			this.drag = null;
			this.store.cancelPreview();
		}
		this.down = null;
	}

	/** Escape: drop the half-done action, else leave the tool. */
	cancel(): void {
		this.abortDrag();
		if (this.pendingFrom || this.passingDraft.length) {
			this.pendingFrom = null;
			this.passingDraft = [];
			this.onChange();
			this.canvas.requestScreen();
			return;
		}
		if (this.tool !== "select") this.setTool("select");
		else this.store.select(null);
	}

	deleteSelection(): void {
		const sel = this.store.selection;
		const doc = this.store.base;
		if (!sel) return;
		if (sel.type === "node") {
			const node = pathNodes(doc, sel.path)?.find((n) => n.id === sel.node);
			if (node?.kmh !== undefined && !confirm(`This point has a speed (${node.kmh} km/h). Delete it anyway?`)) return;
			const next = deleteNode(doc, sel.path, sel.node);
			if (next === doc) {
				alert(
					sel.path.kind === "line"
						? `A line needs at least ${MIN_LINE_NODES} points.`
						: "A passing zone needs at least 2 points.",
				);
				return;
			}
			this.store.commit(sel.path.kind === "line" ? anchorLine(doc, sel.path.id)(next) : next);
			this.store.select(null);
		} else if (sel.type === "zone") {
			this.store.commit(deleteZone(doc, sel.zone));
		} else if (sel.type === "marker") {
			this.store.commit(deleteMarker(doc, sel.marker));
		}
	}

	// ------------------------------------------------------------ pointer

	private onDown(e: PointerEvent): void {
		// OSD keeps focus in a panel field, whose change would then land on the newly clicked selection.
		const field = document.activeElement;
		if (field instanceof HTMLElement && field.closest(".ed-panel")) field.blur();
		this.touch = e.pointerType !== "mouse";
		if (e.pointerType === "mouse" && e.button !== 0) return;
		this.pointers.add(e.pointerId);
		if (this.pointers.size > 1) {
			// A second finger: let OSD pinch.
			this.abortDrag();
			return;
		}
		const s = this.canvas.local(e);
		const hit = this.hitTest(s);
		const mouse = e.pointerType === "mouse";
		this.down = { id: e.pointerId, s, time: performance.now(), hit, moved: false, mouse };
		this.drag = hit ? this.startDrag(hit, s) : null;
		if (this.drag && mouse) {
			this.canvas.container.setPointerCapture(e.pointerId);
			e.stopPropagation();
			e.preventDefault();
		}
	}

	private onMove(e: PointerEvent): void {
		if (!this.down || e.pointerId !== this.down.id) {
			if (e.pointerType === "mouse" && !this.drag) this.updateCursor(this.canvas.local(e));
			return;
		}
		const s = this.canvas.local(e);
		if (Math.hypot(s.x - this.down.s.x, s.y - this.down.s.y) > TAP_SLOP_PX) this.down.moved = true;
		if (!this.drag) return;
		// Swallow the move so OSD never pans under a grip being dragged.
		e.stopPropagation();
		e.preventDefault();
		if (this.down.moved) this.drag.update(this.canvas.toImage(s.x, s.y), e.altKey);
	}

	private onUp(e: PointerEvent, cancelled = false): void {
		this.pointers.delete(e.pointerId);
		const down = this.down;
		if (!down || e.pointerId !== down.id) return;
		this.down = null;
		const drag = this.drag;
		this.drag = null;
		if (drag) {
			if (down.mouse) {
				e.stopPropagation();
				e.preventDefault();
			}
			if (down.moved && !cancelled) {
				this.store.commit(this.store.doc);
				return;
			}
			this.store.cancelPreview();
		}
		if (!cancelled && !down.moved && performance.now() - down.time < TAP_MS) {
			const s = this.canvas.local(e);
			this.tap(down.hit, this.canvas.toImage(s.x, s.y));
		}
	}

	private updateCursor(s: Point): void {
		if (this.tool !== "select") return;
		const hit = this.hitTest(s);
		const grab = hit && hit.type !== "line" && hit.type !== "zone";
		this.canvas.container.style.cursor = grab ? "grab" : hit ? "pointer" : "";
	}

	// ------------------------------------------------------------ taps

	private tap(hit: Hit | null, img: Point): void {
		const store = this.store;
		const doc = store.base;
		const active = lineById(doc, store.activeLine);
		const onPhoto = img.x >= 0 && img.y >= 0 && img.x <= doc.image.width && img.y <= doc.image.height;
		if (this.tool !== "select" && !onPhoto) return;
		switch (this.tool) {
			case "select":
				store.select(selectionOf(hit));
				return;
			case "points": {
				if (this.drawingLine && active) {
					const last = active.nodes[active.nodes.length - 1]?.id;
					const { doc: next, nodeId } = addNode(doc, { kind: "line", id: active.id }, last, r1(img.x), r1(img.y));
					store.commit(next);
					store.select({ type: "node", path: { kind: "line", id: active.id }, node: nodeId });
					return;
				}
				if (hit?.type === "line" && active) {
					const a = anchorOf(active, hit.at);
					if (!a) return;
					const seg = active.nodes.findIndex((n) => n.id === a.from);
					const reanchor = anchorLine(doc, active.id);
					const { doc: next, nodeId } = insertNode(doc, { kind: "line", id: active.id }, seg, a.t);
					if (!nodeId) return;
					store.commit(reanchor(next));
					store.select({ type: "node", path: { kind: "line", id: active.id }, node: nodeId });
					return;
				}
				if (hit?.type === "node" || hit?.type === "handle") {
					store.select(selectionOf(hit));
					return;
				}
				// Beside the selected node: the next point after it.
				const sel = store.selection;
				if (sel?.type === "node") {
					const reanchor = sel.path.kind === "line" ? anchorLine(doc, sel.path.id) : (d: TrackDoc) => d;
					const { doc: next, nodeId } = addNode(doc, sel.path, sel.node, r1(img.x), r1(img.y));
					store.commit(reanchor(next));
					store.select({ type: "node", path: sel.path, node: nodeId });
				}
				return;
			}
			case "braking": {
				if (!active || active.nodes.length < 2) return;
				const s = lineTrace(active).sampler;
				const near = this.distanceToLine(active, img) * this.canvas.scale();
				if (near > (this.touch ? 30 : 16)) return;
				const on = s.pointAt(s.project(img));
				const p: Vec = [r1(on.x), r1(on.y)];
				if (!this.pendingFrom) {
					this.pendingFrom = p;
					this.onChange();
					this.canvas.requestScreen();
					return;
				}
				// Order the two clicks along travel (the shorter way round).
				const da = s.project({ x: this.pendingFrom[0], y: this.pendingFrom[1] });
				const db = s.project(on);
				const forward = (((db - da) % s.total) + s.total) % s.total;
				const [from, to] = forward <= s.total / 2 ? [this.pendingFrom, p] : [p, this.pendingFrom];
				this.pendingFrom = null;
				const { doc: next, zoneId } = addBraking(doc, active.id, from, to);
				store.commit(next);
				store.select({ type: "zone", zone: zoneId });
				this.onChange();
				return;
			}
			case "passing":
				this.passingDraft.push(img);
				this.onChange();
				this.canvas.requestScreen();
				return;
			case "marker": {
				const t = this.markerTemplate;
				if (!t) return;
				const onLine = (t.kind === "car" || t.kind === "apex") && active ? active.id : undefined;
				let at = img;
				if (t.kind === "car" && active && active.nodes.length >= 2) {
					const s = lineTrace(active).sampler;
					at = s.pointAt(s.project(img));
				}
				const m: Omit<Marker, "id"> = {
					kind: t.kind,
					x: r1(at.x),
					y: r1(at.y),
					...(t.icon ? { icon: t.icon } : {}),
					...(t.kind === "corner" ? { text: t.text ?? nextCornerNumber(doc) } : {}),
					...(t.kind === "label" ? { text: t.text ?? "Name" } : {}),
					...(onLine ? { line: onLine } : {}),
				};
				const { doc: next, markerId } = addMarker(doc, m);
				store.commit(next);
				store.select({ type: "marker", marker: markerId });
				return;
			}
		}
	}

	// ------------------------------------------------------------ drags

	private startDrag(hit: Hit, s: Point): Drag | null {
		const store = this.store;
		const base = store.base;
		const start = this.canvas.toImage(s.x, s.y);
		if (hit.type === "node" || hit.type === "handle") {
			const nodes = pathNodes(base, hit.path);
			const i = nodes?.findIndex((n) => n.id === hit.node) ?? -1;
			if (!nodes || i < 0) return null;
			store.select({ type: "node", path: hit.path, node: hit.node });
			const reanchor = hit.path.kind === "line" ? anchorLine(base, hit.path.id) : (d: TrackDoc) => d;
			const only: ReadonlySet<LayerGroupId> =
				hit.path.kind === "line" ? new Set(["racing_line", "braking", "cars"]) : new Set(["passing_zones"]);
			const node = nodes[i];
			if (hit.type === "node") {
				// Relative to where it was grabbed, so the node doesn't jump under the pointer.
				const dx = node.x - start.x;
				const dy = node.y - start.y;
				return {
					only,
					update: (img) => store.preview(reanchor(moveNode(base, hit.path, hit.node, r1(img.x + dx), r1(img.y + dy)))),
				};
			}
			const smooth = isSmoothNode(nodes, i, isClosed(hit.path));
			return {
				only,
				update: (img, alt) => {
					const vec: Vec = [r1(img.x - node.x), r1(img.y - node.y)];
					store.preview(reanchor(setHandle(base, hit.path, hit.node, hit.which, vec, smooth && !alt)));
				},
			};
		}
		if (hit.type === "zoneEnd") {
			const zone = base.zones.find((z) => z.id === hit.zone);
			const line = zone?.kind === "braking" ? lineById(base, zone.line) : undefined;
			if (!line) return null;
			store.select({ type: "zone", zone: hit.zone });
			const s0 = lineTrace(line).sampler;
			return {
				only: new Set(["braking"]),
				update: (img) => {
					const p = s0.pointAt(s0.project(img));
					store.preview(setBrakingEnd(base, hit.zone, hit.end, [r1(p.x), r1(p.y)]));
				},
			};
		}
		if (hit.type === "marker") {
			const m = base.markers.find((x) => x.id === hit.marker);
			if (!m) return null;
			store.select({ type: "marker", marker: m.id });
			const line = m.kind === "car" && m.line ? lineById(base, m.line) : undefined;
			const dx = m.x - start.x;
			const dy = m.y - start.y;
			return {
				only: new Set([MARKER_LAYER[m.kind]]),
				update: (img) => {
					let p = { x: img.x + dx, y: img.y + dy };
					// Cars on a line slide along it.
					if (line && line.nodes.length >= 2) {
						const s0 = lineTrace(line).sampler;
						p = s0.pointAt(s0.project(img));
					}
					store.preview(updateMarker(base, m.id, { x: r1(p.x), y: r1(p.y) }));
				},
			};
		}
		return null;
	}

	// ------------------------------------------------------------ hit testing

	private radius(): number {
		return this.touch ? 20 : 8;
	}

	private hitTest(s: Point): Hit | null {
		const doc = this.store.doc;
		const sel = this.store.selection;
		const R = this.radius();
		const near = (p: Point): number => {
			const q = this.canvas.toScreen(p);
			return Math.hypot(q.x - s.x, q.y - s.y);
		};

		// Handles of the selected node first: they sit on top of everything.
		if (sel?.type === "node") {
			const nodes = pathNodes(doc, sel.path);
			const i = nodes?.findIndex((n) => n.id === sel.node) ?? -1;
			if (nodes && i >= 0) {
				const h = nodeHandles(nodes, i, isClosed(sel.path));
				const n = nodes[i];
				// A short handle can sit within the touch radius of its node: the closer one wins.
				const dn = near(n);
				for (const which of ["in", "out"] as const) {
					const v = h[which];
					if (Math.hypot(v[0], v[1]) < 1e-6) continue;
					const dh = near({ x: n.x + v[0], y: n.y + v[1] });
					if (dh < R && dh < dn) return { type: "handle", path: sel.path, node: n.id, which };
				}
			}
		}

		for (const { path, nodes } of this.editablePaths(doc)) {
			let best: LineNode | null = null;
			let bestD = R;
			for (const n of this.visibleNodes(path, nodes)) {
				const d = near(n);
				// On a tie (coincident nodes) keep the selected one.
				if (d < bestD || (d === bestD && sel?.type === "node" && sel.node === n.id)) {
					best = n;
					bestD = d;
				}
			}
			if (best) return { type: "node", path, node: best.id };
		}

		if (sel?.type === "zone") {
			const z = doc.zones.find((x) => x.id === sel.zone);
			if (z?.kind === "braking") {
				for (const end of ["from", "to"] as const) {
					if (near({ x: z[end][0], y: z[end][1] }) < R + 2) return { type: "zoneEnd", zone: z.id, end };
				}
			}
		}

		const markerHit = this.markerAt(doc, s);
		if (markerHit) return { type: "marker", marker: markerHit };

		const scale = this.canvas.scale();
		const img = this.canvas.toImage(s.x, s.y);
		const active = lineById(doc, this.store.activeLine);
		for (const z of doc.zones) {
			const pts =
				z.kind === "passing"
					? lineTraceOpen(z.nodes)
					: z.line === active?.id && active
						? brakingPoints(active, z.from, z.to)
						: null;
			if (pts && distanceToPolyline(pts, img) * scale < R) return { type: "zone", zone: z.id };
		}
		if (active && active.nodes.length >= 2 && this.distanceToLine(active, img) * scale < R) {
			return { type: "line", line: active.id, at: img };
		}
		return null;
	}

	private markerAt(doc: TrackDoc, s: Point): string | null {
		const scale = this.canvas.scale();
		const mpp = doc.metersPerPixel ?? 0.1869;
		let best: string | null = null;
		let bestD = Infinity;
		for (const m of doc.markers) {
			if (m.line && m.line !== this.store.activeLine) continue;
			const at = markerPosition(doc, m);
			const q = this.canvas.toScreen(at);
			const d = Math.hypot(q.x - s.x, q.y - s.y);
			// Roughly the drawn size: corner badges are big, symbols about 12 m across.
			const r = Math.max(this.radius(), ((m.kind === "corner" ? (m.size ?? 35 / mpp) / 2 : 6 / mpp) * scale) | 0);
			if (d < r && d < bestD) {
				best = m.id;
				bestD = d;
			}
		}
		return best;
	}

	private distanceToLine(line: RacingLine, img: Point): number {
		const s = lineTrace(line).sampler;
		const p = s.pointAt(s.project(img));
		return Math.hypot(p.x - img.x, p.y - img.y);
	}

	/** The active line and the selected passing zone: the paths whose nodes can be grabbed. */
	private editablePaths(doc: TrackDoc): { path: PathRef; nodes: LineNode[] }[] {
		const out: { path: PathRef; nodes: LineNode[] }[] = [];
		const sel = this.store.selection;
		const passingId =
			sel?.type === "zone" ? sel.zone : sel?.type === "node" && sel.path.kind === "passing" ? sel.path.id : undefined;
		const pz = doc.zones.find((z) => z.id === passingId && z.kind === "passing");
		if (pz?.kind === "passing") out.push({ path: { kind: "passing", id: pz.id }, nodes: pz.nodes });
		const active = lineById(doc, this.store.activeLine);
		if (active) out.push({ path: { kind: "line", id: active.id }, nodes: active.nodes });
		return out;
	}

	/** All nodes when they're far enough apart on screen, else only the selected one and its neighbours. */
	private visibleNodes(path: PathRef, nodes: LineNode[]): LineNode[] {
		if (this.nodeSpacing(nodes) >= NODE_SPACING_PX || this.tool === "points") return nodes;
		const sel = this.store.selection;
		if (sel?.type !== "node" || sel.path.kind !== path.kind || sel.path.id !== path.id) return [];
		const i = nodes.findIndex((n) => n.id === sel.node);
		if (i < 0) return [];
		const n = nodes.length;
		return [nodes[(i - 1 + n) % n], nodes[i], nodes[(i + 1) % n]];
	}

	private nodeSpacing(nodes: LineNode[]): number {
		if (nodes.length < 2) return Infinity;
		let len = 0;
		for (let i = 1; i < nodes.length; i++) len += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
		return (len / (nodes.length - 1)) * this.canvas.scale();
	}

	// ------------------------------------------------------------ screen layer

	private drawScreen(layer: SVGSVGElement): void {
		layer.replaceChildren();
		const doc = this.store.doc;
		const sel = this.store.selection;
		const toS = (p: Point): Point => this.canvas.toScreen(p);
		const big = this.touch ? 7 : 5;

		const poly = (pts: Point[], cls: string): void => {
			if (pts.length < 2) return;
			const d = pts.map((p, i) => {
				const q = toS(p);
				return `${i ? "L" : "M"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
			});
			layer.appendChild(el("path", { d: d.join(" "), class: cls }));
		};

		// Selection highlights.
		if (sel?.type === "zone") {
			const z = doc.zones.find((x) => x.id === sel.zone);
			if (z?.kind === "braking") {
				const line = lineById(doc, z.line);
				if (line) poly(brakingPoints(line, z.from, z.to) ?? [], "ed-hl");
				for (const end of ["from", "to"] as const) {
					const q = toS({ x: z[end][0], y: z[end][1] });
					layer.appendChild(
						el("rect", { x: q.x - big, y: q.y - big, width: big * 2, height: big * 2, class: "ed-end" }),
					);
				}
			} else if (z?.kind === "passing") {
				poly(lineTraceOpen(z.nodes), "ed-hl");
			}
		}
		if (sel?.type === "marker") {
			const m = doc.markers.find((x) => x.id === sel.marker);
			if (m) {
				const q = toS(markerPosition(doc, m));
				layer.appendChild(el("circle", { cx: q.x, cy: q.y, r: 18, class: "ed-marker-sel" }));
			}
		}
		if (sel?.type === "line") {
			const line = lineById(doc, sel.line);
			if (line && line.nodes.length >= 2) poly(lineTrace(line).flat.points.concat([line.nodes[0]]), "ed-hl");
		}

		// Nodes of the editable paths, speeds, lap start.
		for (const { path, nodes } of this.editablePaths(doc)) {
			const spacing = this.nodeSpacing(nodes);
			const labels = spacing >= LABEL_SPACING_PX;
			for (const n of this.visibleNodes(path, nodes)) {
				const q = toS(n);
				const isSel = sel?.type === "node" && sel.node === n.id && sel.path.id === path.id;
				const isStart = path.kind === "line" && n === nodes[0];
				const cls = `ed-node${isSel ? " sel" : ""}${n.kmh !== undefined ? " speed" : ""}${isStart ? " start" : ""}`;
				layer.appendChild(el("circle", { cx: q.x, cy: q.y, r: isSel ? big + 2 : big, class: cls }));
				if (n.kmh !== undefined && (labels || isSel)) {
					const t = el("text", { x: q.x + 9, y: q.y - 8, class: "ed-label" });
					t.textContent = String(n.kmh);
					layer.appendChild(t);
				}
				if (isStart && (labels || isSel)) {
					const t = el("text", { x: q.x + 9, y: q.y + 16, class: "ed-label start" });
					t.textContent = "Start";
					layer.appendChild(t);
				}
			}
		}

		// Handles of the selected node.
		if (sel?.type === "node") {
			const nodes = pathNodes(doc, sel.path);
			const i = nodes?.findIndex((n) => n.id === sel.node) ?? -1;
			if (nodes && i >= 0) {
				const n = nodes[i];
				const h = nodeHandles(nodes, i, isClosed(sel.path));
				const auto = !n.in && !n.out;
				const q = toS(n);
				for (const which of ["in", "out"] as const) {
					const v = h[which];
					if (Math.hypot(v[0], v[1]) < 1e-6) continue;
					const hq = toS({ x: n.x + v[0], y: n.y + v[1] });
					layer.appendChild(
						el("line", { x1: q.x, y1: q.y, x2: hq.x, y2: hq.y, class: `ed-handle-line${auto ? " auto" : ""}` }),
					);
					layer.appendChild(el("circle", { cx: hq.x, cy: hq.y, r: big - 1, class: `ed-handle${auto ? " auto" : ""}` }));
				}
			}
		}

		// In-progress actions.
		if (this.pendingFrom) {
			const q = toS({ x: this.pendingFrom[0], y: this.pendingFrom[1] });
			layer.appendChild(el("rect", { x: q.x - big, y: q.y - big, width: big * 2, height: big * 2, class: "ed-end" }));
		}
		if (this.passingDraft.length) {
			poly(this.passingDraft, "ed-draft");
			for (const p of this.passingDraft) {
				const q = toS(p);
				layer.appendChild(el("circle", { cx: q.x, cy: q.y, r: big, class: "ed-node" }));
			}
		}
	}
}

// ---------------------------------------------------------------- helpers

const r1 = (v: number): number => Math.round(v * 10) / 10;

function el<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const e = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	return e;
}

function selectionOf(hit: Hit | null): EditorStore["selection"] {
	if (!hit) return null;
	switch (hit.type) {
		case "node":
		case "handle":
			return { type: "node", path: hit.path, node: hit.node };
		case "zoneEnd":
		case "zone":
			return { type: "zone", zone: hit.zone };
		case "marker":
			return { type: "marker", marker: hit.marker };
		case "line":
			return { type: "line", line: hit.line };
	}
}

/** Where a marker is drawn (cars on a line sit on it). */
export function markerPosition(doc: TrackDoc, m: Marker): Point {
	if (m.kind === "car" && m.line) {
		const line = lineById(doc, m.line);
		if (line && line.nodes.length >= 2) {
			const s = lineTrace(line).sampler;
			return s.pointAt(s.project({ x: m.x, y: m.y }));
		}
	}
	return { x: m.x, y: m.y };
}

function brakingPoints(line: RacingLine, from: Vec, to: Vec): Point[] | null {
	if (line.nodes.length < 2) return null;
	const s = lineTrace(line).sampler;
	return s.slice(s.project({ x: from[0], y: from[1] }), s.project({ x: to[0], y: to[1] }));
}

function lineTraceOpen(nodes: LineNode[]): Point[] {
	return nodes.length < 2 ? [] : flattenLine(nodes, false).points;
}

function distanceToPolyline(pts: Point[], p: Point): number {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const vx = b.x - a.x;
		const vy = b.y - a.y;
		const len2 = vx * vx + vy * vy;
		const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
		best = Math.min(best, Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y));
	}
	return best;
}

function nextCornerNumber(doc: TrackDoc): string {
	const nums = doc.markers.filter((m) => m.kind === "corner").map((m) => parseInt(m.text ?? "", 10));
	const max = nums.filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
	return String(max + 1);
}
