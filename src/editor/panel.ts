import { MARKER_ICONS } from "../markerIcons.js";
import { createManualTimeline } from "../replayTimeline.js";
import { SLUG_MAX, trackDocProblems, type Marker, type TrackDoc } from "../trackDoc.js";
import { lineTrace } from "../trackRender.js";
import type { EditCanvas } from "./canvas.js";
import { markerPosition, type Interaction, type MarkerTemplate, type ToolId } from "./interaction.js";
import {
	addLine,
	deleteLine,
	duplicateLine,
	duplicateMarker,
	lineById,
	MIN_LINE_NODES,
	pathNodes,
	renameLine,
	reverseLine,
	setArrows,
	setAuto,
	setKmh,
	setLapStart,
	setTrack,
	updateMarker,
} from "./ops.js";
import { anchorLine } from "./anchors.js";
import type { ChangeKind, EditorStore } from "./store.js";

export interface PanelHost {
	store: EditorStore;
	interaction: Interaction;
	canvas: EditCanvas;
	/** A track that was never saved: its URL name can still change. */
	isNew: () => boolean;
	status: () => string;
	save: () => void;
	preview: () => void;
	close: () => void;
}

const esc = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const REF_MPP = 0.1869;
const DEFAULT_CORNER_M = 35;
const DEFAULT_LABEL_M = 12;

const TOOLS: { id: ToolId; label: string; key: string; icon: string }[] = [
	{ id: "select", label: "Select", key: "V", icon: "M5 3l14 8-6 2 4 7-3 1-4-7-5 4z" },
	{ id: "points", label: "Line points", key: "P", icon: "M4 18c4-10 12-10 16-6M4 18h0M20 12h0" },
	{ id: "braking", label: "Braking zone", key: "B", icon: "M4 17l16-10" },
	{ id: "passing", label: "Passing zone", key: "G", icon: "M4 16c5-6 11-6 16 0M14 10l3 3-3 3" },
	{
		id: "marker",
		label: "Marker",
		key: "M",
		icon: "M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
	},
];

// ---------------------------------------------------------------- toolbar (on the map)

export function buildToolbar(host: PanelHost, mapRoot: HTMLElement): () => void {
	const bar = document.createElement("div");
	bar.className = "ed-toolbar";
	bar.innerHTML = TOOLS.map(
		(t) =>
			`<button class="ed-tool" data-tool="${t.id}" title="${t.label} (${t.key})"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg><span>${t.label}</span></button>`,
	).join("");
	const palette = document.createElement("div");
	palette.className = "ed-palette";
	palette.hidden = true;
	palette.innerHTML = paletteHtml();
	const hint = document.createElement("div");
	hint.className = "ed-hint";
	mapRoot.append(bar, palette, hint);

	bar.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
		if (!btn) return;
		const tool = btn.dataset.tool as ToolId;
		if (tool === "marker") {
			palette.hidden = !palette.hidden;
			return;
		}
		palette.hidden = true;
		host.interaction.setTool(tool);
	});
	palette.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
		if (!btn) return;
		const t: MarkerTemplate = { kind: btn.dataset.kind as Marker["kind"], icon: btn.dataset.icon || undefined };
		palette.hidden = true;
		host.interaction.setTool("marker", t);
	});
	hint.addEventListener("click", (e) => {
		const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]")?.dataset.act;
		if (act === "done") host.interaction.finish();
		if (act === "cancel") host.interaction.cancel();
	});

	return () => {
		const it = host.interaction;
		for (const b of bar.querySelectorAll<HTMLButtonElement>("[data-tool]"))
			b.classList.toggle("active", b.dataset.tool === it.tool);
		const needsDone = (it.tool === "passing" && it.passingDraft.length > 0) || (it.tool === "points" && it.drawingLine);
		const canCancel = it.pendingFrom !== null || it.passingDraft.length > 0 || it.tool !== "select";
		const what = it.tool === "marker" && it.markerTemplate ? ` <b>${esc(templateLabel(it.markerTemplate))}</b>.` : "";
		hint.innerHTML = `<span>${esc(it.hint())}${what}</span>${needsDone ? `<button data-act="done">Done</button>` : ""}${canCancel ? `<button data-act="cancel">${it.tool === "select" ? "Clear" : "Stop"} (Esc)</button>` : ""}`;
	};
}

function paletteHtml(): string {
	const btn = (kind: string, label: string, svg: string, icon = ""): string =>
		`<button data-kind="${kind}" data-icon="${icon}" title="${esc(label)}"><svg viewBox="-45 -45 90 90" width="36" height="36">${svg}</svg><span>${esc(label)}</span></button>`;
	const corner = `<circle r="34" fill="#000" stroke="#fff" stroke-width="6"/><text text-anchor="middle" dominant-baseline="central" fill="#fff" font-weight="bold" font-size="38" font-family="Arial">1</text>`;
	const label = `<text text-anchor="middle" dominant-baseline="central" font-weight="bold" font-size="30" font-family="Arial" stroke="#fff" stroke-width="6" paint-order="stroke">Aa</text>`;
	const groups: [string, string][] = [
		["apex", "Apex"],
		["car", "Car"],
		["crest", "Crest"],
		["reference", "References"],
	];
	let html = `<div class="ed-pal-group"><h4>Corners</h4>${btn("corner", "Corner number", corner)}${btn("label", "Name label", label)}</div>`;
	for (const [kind, title] of groups) {
		const icons = MARKER_ICONS.filter((i) => i.kind === kind);
		if (!icons.length) continue;
		html += `<div class="ed-pal-group"><h4>${title}</h4>${icons.map((i) => btn(kind, i.label.en, i.svg, i.id)).join("")}</div>`;
	}
	return html;
}

function templateLabel(t: MarkerTemplate): string {
	if (t.kind === "corner") return "corner number";
	if (t.kind === "label") return "name label";
	return MARKER_ICONS.find((i) => i.id === t.icon)?.label.en ?? t.kind;
}

// ---------------------------------------------------------------- side panel

export function buildPanel(host: PanelHost, root: HTMLElement): (kind?: ChangeKind) => void {
	const { store } = host;
	root.innerHTML = `
		<div class="ed-head">
			<button class="ed-icon" data-act="close" title="All tracks">&#8592;</button>
			<div class="ed-title"></div>
			<button class="ed-icon" data-act="undo" title="Undo (Ctrl+Z)">&#8630;</button>
			<button class="ed-icon" data-act="redo" title="Redo (Ctrl+Y)">&#8631;</button>
		</div>
		<div class="ed-actions">
			<button data-act="preview" title="Open this draft in the viewer">Preview</button>
			<button class="primary" data-act="save" title="Save (Ctrl+S)">Save</button>
		</div>
		<div class="ed-status"></div>
		<section class="ed-sec" data-sec="selection"></section>
		<section class="ed-sec" data-sec="lines"></section>
		<section class="ed-sec" data-sec="track"></section>
		<section class="ed-sec" data-sec="check"></section>
	`;
	const sec = (name: string): HTMLElement => root.querySelector<HTMLElement>(`[data-sec="${name}"]`)!;

	root.addEventListener("click", (e) => onAction(host, (e.target as HTMLElement).closest<HTMLElement>("[data-act]")));
	root.addEventListener("change", (e) => onChange(host, e.target as HTMLInputElement));

	return (kind) => {
		const doc = store.doc;
		root.querySelector(".ed-title")!.textContent =
			doc.name && typeof doc.name === "object" ? (doc.name.en ?? doc.slug) : String(doc.name ?? doc.slug);
		root.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled = !store.canUndo;
		root.querySelector<HTMLButtonElement>('[data-act="redo"]')!.disabled = !store.canRedo;
		root.querySelector(".ed-status")!.textContent = host.status();
		// Mid-drag only the selection's numbers change; the rest can wait for the commit.
		if (kind === "preview") return;
		for (const [name, fn] of [
			["selection", selectionHtml],
			["lines", linesHtml],
			["track", trackHtml],
			["check", checkHtml],
		] as const) {
			const el = sec(name);
			// Don't rebuild a section under the caret.
			if (el.contains(document.activeElement) && kind !== "doc") continue;
			el.innerHTML = fn(host, doc);
		}
	};
}

function selectionHtml(host: PanelHost, doc: TrackDoc): string {
	const sel = host.store.selection;
	const h = `<h3>Selected</h3>`;
	if (!sel) return `${h}<p class="ed-muted">Nothing. Click a point, zone or marker on the map.</p>`;
	if (sel.type === "node") {
		const nodes = pathNodes(doc, sel.path);
		const i = nodes?.findIndex((n) => n.id === sel.node) ?? -1;
		const n = nodes?.[i];
		if (!nodes || !n) return h;
		const auto = !n.in && !n.out;
		const owner = sel.path.kind === "line" ? lineName(doc, sel.path.id) : "passing zone";
		const speed =
			sel.path.kind === "line"
				? `<label class="ed-field">Speed <input type="number" min="5" max="400" step="1" data-field="kmh" value="${n.kmh ?? ""}" placeholder="none" /> km/h</label>`
				: "";
		return `${h}<p>Point ${i + 1} of ${nodes.length} on <b>${esc(owner)}</b>${sel.path.kind === "line" && i === 0 ? " (lap start)" : ""}</p>
			${speed}
			<p class="ed-muted">Curve: ${auto ? "automatic (smooth)" : "custom handles"}. Drag the handles to shape it; hold Alt for a sharp corner.</p>
			<div class="ed-row">
				${auto ? "" : `<button data-act="node-auto">Make automatic</button>`}
				${sel.path.kind === "line" && i > 0 ? `<button data-act="node-start">Lap starts here</button>` : ""}
				<button class="danger" data-act="delete">Delete point</button>
			</div>`;
	}
	if (sel.type === "line") {
		return `${h}<p>Line <b>${esc(lineName(doc, sel.line))}</b>. Its points show on the map; drag them or use Line points to add more.</p>`;
	}
	if (sel.type === "zone") {
		const z = doc.zones.find((x) => x.id === sel.zone);
		if (!z) return h;
		if (z.kind === "braking") {
			return `${h}<p>Braking zone on <b>${esc(lineName(doc, z.line))}</b>, ${Math.round(brakingLength(doc, z.line, z.from, z.to))} m. Drag its square ends along the line.</p>
				<div class="ed-row"><button class="danger" data-act="delete">Delete zone</button></div>`;
		}
		return `${h}<p>Passing zone, ${z.nodes.length} points${z.arrows?.length ? `, ${z.arrows.length} arrow(s)` : ""}. Drag its points to reshape it.</p>
			<div class="ed-row">
				<button data-act="arrow-add">Add arrow</button>
				${z.arrows?.length ? `<button data-act="arrow-clear">Remove arrows</button>` : ""}
				<button class="danger" data-act="delete">Delete zone</button>
			</div>`;
	}
	const m = doc.markers.find((x) => x.id === sel.marker);
	if (!m) return h;
	const mpp = doc.metersPerPixel ?? REF_MPP;
	const kindLabel =
		m.kind === "corner"
			? "Corner number"
			: m.kind === "label"
				? "Name label"
				: (MARKER_ICONS.find((i) => i.id === m.icon)?.label.en ?? (m.svg ? `${m.kind} (imported art)` : m.kind));
	const text =
		m.kind === "corner" || m.kind === "label"
			? `<label class="ed-field">Text <input data-field="m-text" value="${esc(m.text ?? "")}" /></label>`
			: "";
	const size =
		m.kind === "corner" || m.kind === "label"
			? `<label class="ed-field">Size <input type="number" min="1" step="0.5" data-field="m-size-m" value="${round1((m.size ?? (m.kind === "corner" ? DEFAULT_CORNER_M : DEFAULT_LABEL_M) / mpp) * mpp)}" /> m</label>`
			: `<label class="ed-field">Size <input type="number" min="0.2" max="10" step="0.1" data-field="m-size-x" value="${m.size ?? 1}" /> &times;</label>`;
	const rotation =
		m.kind === "car" && m.line
			? `<p class="ed-muted">Sits on the line and points along it.</p>`
			: `<label class="ed-field">Rotation <input type="number" step="5" data-field="m-rot" value="${m.rotation ?? 0}" /> &deg;</label>`;
	const lineBound =
		m.kind === "corner" || m.kind === "label"
			? ""
			: `<label class="ed-check"><input type="checkbox" data-field="m-line" ${m.line ? "checked" : ""} /> Only with the line <b>${esc(lineName(doc, m.line ?? host.store.activeLine ?? ""))}</b></label>`;
	const icons = MARKER_ICONS.filter((i) => i.kind === m.kind);
	const iconPicker =
		icons.length > 1 || (icons.length === 1 && m.icon !== icons[0].id)
			? `<label class="ed-field">Icon <select data-field="m-icon">${m.icon ? "" : `<option value="" selected disabled>${m.svg ? "Imported art" : "Default"}</option>`}${icons
					.map((i) => `<option value="${i.id}" ${i.id === m.icon ? "selected" : ""}>${esc(i.label.en)}</option>`)
					.join("")}</select></label>`
			: "";
	return `${h}<p><b>${esc(kindLabel)}</b></p>${iconPicker}${text}${size}${rotation}${lineBound}
		<div class="ed-row"><button data-act="m-dup">Duplicate</button><button class="danger" data-act="delete">Delete</button></div>`;
}

function linesHtml(host: PanelHost, doc: TrackDoc): string {
	const active = host.store.activeLine;
	const rows = doc.lines
		.map(
			(l) =>
				`<label class="ed-line${l.id === active ? " active" : ""}"><input type="radio" name="ed-line" data-field="active-line" value="${esc(l.id)}" ${l.id === active ? "checked" : ""} /> ${esc(lineName(doc, l.id))} <span class="ed-muted">${l.nodes.length} pts</span></label>`,
		)
		.join("");
	const line = lineById(doc, active);
	const stats = line ? lineStats(doc, line.id) : "";
	const name = line && typeof line.name === "object" ? line.name : { en: String(line?.name ?? ""), fr: "" };
	return `<h3>Lines</h3>${rows || `<p class="ed-muted">No line yet.</p>`}
		${
			line
				? `<div class="ed-grid2"><label class="ed-field">Name <input data-field="line-en" value="${esc(name.en ?? "")}" /></label><label class="ed-field">Nom <input data-field="line-fr" value="${esc(name.fr ?? "")}" /></label></div>
		<p class="ed-muted">${stats}</p>`
				: ""
		}
		<div class="ed-row">
			<button data-act="line-new">New line</button>
			${line ? `<button data-act="line-dup" title="Copies its speeds, braking zones, apexes and cars">Duplicate</button><button data-act="line-rev">Reverse</button><button class="danger" data-act="line-del">Delete</button>` : ""}
		</div>`;
}

function trackHtml(host: PanelHost, doc: TrackDoc): string {
	const name = typeof doc.name === "object" ? doc.name : { en: String(doc.name ?? ""), fr: "" };
	const line = lineById(doc, host.store.activeLine);
	const lenPx = line && line.nodes.length >= 2 ? lineTrace(line).sampler.total : 0;
	const lapM = lenPx && doc.metersPerPixel ? Math.round(lenPx * doc.metersPerPixel) : "";
	return `<h3>Track</h3>
		<div class="ed-grid2"><label class="ed-field">Name <input data-field="t-en" value="${esc(name.en ?? "")}" /></label><label class="ed-field">Nom <input data-field="t-fr" value="${esc(name.fr ?? "")}" /></label></div>
		<label class="ed-field">Web address /<input data-field="t-slug" maxlength="${SLUG_MAX}" value="${esc(doc.slug)}" ${host.isNew() ? "" : "disabled"} /></label>
		${host.isNew() ? `<p class="ed-muted">Lowercase letters, digits and dashes. Can't change after the first save (links and QR codes use it).</p>` : ""}
		<label class="ed-field">Lap length <input type="number" min="100" step="1" data-field="t-lap" value="${lapM}" ${lenPx ? "" : "disabled"} placeholder="meters" /> m</label>
		<p class="ed-muted">${lenPx ? `Measured along ${esc(lineName(doc, line!.id))}: sets the map scale${doc.metersPerPixel ? ` (${doc.metersPerPixel.toFixed(4)} m per pixel)` : ""}.` : "Draw a line first."}</p>
		<label class="ed-field">North <input type="number" step="1" data-field="t-north" value="${doc.northOffset ?? 0}" /> &deg; <span class="ed-muted">clockwise from the top of the photo</span></label>
		<label class="ed-check"><input type="checkbox" data-field="t-unlisted" ${doc.unlisted ? "checked" : ""} /> Link only</label>
		<p class="ed-muted">Hidden from the track list; its web address and QR code still open it.</p>`;
}

function checkHtml(host: PanelHost, doc: TrackDoc): string {
	const items = checks(host, doc);
	if (!items.length) return `<h3>Check</h3><p class="ed-ok">All good.</p>`;
	return `<h3>Check</h3><ul class="ed-checks">${items.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join("")}</ul>`;
}

/** What Save would refuse (errors) or what the owner probably wants to fix (notes). */
export function checks(host: PanelHost, doc: TrackDoc): { level: "error" | "note"; text: string }[] {
	const out: { level: "error" | "note"; text: string }[] = [];
	const name = typeof doc.name === "object" ? doc.name.en : doc.name;
	if (!name) out.push({ level: "error", text: "Give the track a name." });
	if (!doc.slug) out.push({ level: "error", text: "Choose a web address for the track." });
	for (const p of trackDocProblems(doc)) {
		if (doc.slug || !p.startsWith("slug ")) out.push({ level: "error", text: p });
	}
	for (const l of doc.lines) {
		if (l.nodes.length < MIN_LINE_NODES)
			out.push({ level: "error", text: `${lineName(doc, l.id)} needs at least ${MIN_LINE_NODES} points.` });
	}
	if (!doc.lines.length)
		out.push({ level: "note", text: "No racing line yet: New line, then click its points in driving order." });
	if (!doc.metersPerPixel)
		out.push({ level: "note", text: "Set the lap length (Track) so lines and the replay are to scale." });
	for (const id of host.canvas.skipped)
		out.push({
			level: "error",
			text: `Braking zone ${id} no longer fits its line: drag its ends back onto it or delete it.`,
		});
	for (const l of doc.lines) {
		if (l.nodes.length >= MIN_LINE_NODES && !l.nodes.some((n) => n.kmh !== undefined)) {
			out.push({
				level: "note",
				text: `${lineName(doc, l.id)} has no speeds: the replay uses a rough automatic profile.`,
			});
		}
	}
	return out;
}

// ---------------------------------------------------------------- actions

function onAction(host: PanelHost, el: HTMLElement | null): void {
	if (!el) return;
	const { store, interaction } = host;
	const doc = store.base;
	const sel = store.selection;
	const active = store.activeLine;
	switch (el.dataset.act) {
		case "close":
			return host.close();
		case "undo":
			return store.undo();
		case "redo":
			return store.redo();
		case "save":
			return host.save();
		case "preview":
			return host.preview();
		case "delete":
			return interaction.deleteSelection();
		case "node-auto":
			if (sel?.type === "node") {
				const next = setAuto(doc, sel.path, sel.node);
				store.commit(sel.path.kind === "line" ? anchorLine(doc, sel.path.id)(next) : next);
			}
			return;
		case "node-start":
			if (sel?.type === "node" && sel.path.kind === "line") store.commit(setLapStart(doc, sel.path.id, sel.node));
			return;
		case "arrow-add":
			if (sel?.type === "zone") {
				const z = doc.zones.find((x) => x.id === sel.zone);
				if (z?.kind === "passing") {
					const count = (z.arrows?.length ?? 0) + 1;
					const evenly = Array.from({ length: count }, (_, i) => Math.round(((i + 1) / (count + 1)) * 100) / 100);
					store.commit(setArrows(doc, z.id, evenly));
				}
			}
			return;
		case "arrow-clear":
			if (sel?.type === "zone") store.commit(setArrows(doc, sel.zone, []));
			return;
		case "m-dup":
			if (sel?.type === "marker") {
				const { doc: next, markerId } = duplicateMarker(doc, sel.marker, 40, 40);
				if (markerId) {
					store.commit(next);
					store.select({ type: "marker", marker: markerId });
				}
			}
			return;
		case "line-new": {
			const { doc: next, lineId } = addLine(doc, {
				en: doc.lines.length ? `Line ${doc.lines.length + 1}` : "Driving line",
				fr: doc.lines.length ? `Ligne ${doc.lines.length + 1}` : "Ligne de conduite",
			});
			store.commit(next);
			store.setActiveLine(lineId);
			store.select({ type: "line", line: lineId });
			interaction.startDrawing();
			return;
		}
		case "line-dup": {
			const line = lineById(doc, active);
			if (!line) return;
			const n = typeof line.name === "object" ? line.name : { en: String(line.name) };
			const { doc: next, lineId } = duplicateLine(doc, line.id, {
				en: `${n.en ?? "Line"} (copy)`,
				fr: `${n.fr ?? n.en ?? "Ligne"} (copie)`,
			});
			if (!lineId) return;
			store.commit(next);
			store.setActiveLine(lineId);
			return;
		}
		case "line-rev":
			if (active && confirm("Drive this line the other way? Its braking zones flip with it."))
				store.commit(reverseLine(doc, active));
			return;
		case "line-del":
			if (active && confirm(`Delete "${lineName(doc, active)}" with its speeds, braking zones, apexes and cars?`)) {
				store.commit(deleteLine(doc, active));
			}
			return;
	}
}

function onChange(host: PanelHost, input: HTMLInputElement): void {
	const { store } = host;
	const doc = store.base;
	const sel = store.selection;
	const v = input.value.trim();
	const num = v === "" ? undefined : Number(v);
	// type=number still accepts typed text like 1e400: put the last good value back.
	if (input.type === "number" && num !== undefined && !Number.isFinite(num)) {
		input.value = input.defaultValue;
		return;
	}
	switch (input.dataset.field) {
		case "kmh":
			if (sel?.type === "node" && sel.path.kind === "line") {
				const kmh =
					num === undefined || !Number.isFinite(num) ? undefined : Math.round(Math.min(400, Math.max(5, num)));
				store.commit(setKmh(doc, sel.path.id, sel.node, kmh));
			}
			return;
		case "active-line":
			store.setActiveLine(input.value);
			return;
		case "line-en":
		case "line-fr": {
			const line = lineById(doc, store.activeLine);
			if (!line) return;
			const n = typeof line.name === "object" ? line.name : { en: String(line.name) };
			store.commit(renameLine(doc, line.id, { ...n, [input.dataset.field === "line-en" ? "en" : "fr"]: v }));
			return;
		}
		case "t-en":
		case "t-fr": {
			const n = typeof doc.name === "object" ? doc.name : { en: String(doc.name ?? "") };
			store.commit(setTrack(doc, { name: { ...n, [input.dataset.field === "t-en" ? "en" : "fr"]: v } }));
			return;
		}
		case "t-slug":
			store.commit(
				setTrack(doc, {
					slug: v
						.toLowerCase()
						.replace(/[^a-z0-9-]+/g, "-")
						.replace(/^-+/, "")
						.slice(0, SLUG_MAX),
				}),
			);
			return;
		case "t-north":
			store.commit(
				setTrack(doc, {
					northOffset: num !== undefined && Number.isFinite(num) ? ((num % 360) + 360) % 360 : undefined,
				}),
			);
			return;
		case "t-unlisted":
			store.commit(setTrack(doc, { unlisted: input.checked || undefined }));
			return;
		case "t-lap": {
			const line = lineById(doc, store.activeLine);
			if (!line || line.nodes.length < 2 || num === undefined || !(num > 0)) return;
			const mpp = Math.round((num / lineTrace(line).sampler.total) * 1e6) / 1e6;
			store.commit(setTrack(doc, { metersPerPixel: mpp }));
			return;
		}
		case "m-text":
			if (sel?.type === "marker") store.commit(updateMarker(doc, sel.marker, { text: v }));
			return;
		case "m-icon":
			if (sel?.type === "marker") {
				// Imported art's size is relative to its own scale, not the built-in icons'.
				const imported = doc.markers.find((x) => x.id === sel.marker)?.svg !== undefined;
				store.commit(
					updateMarker(doc, sel.marker, { icon: v, svg: undefined, ...(imported ? { size: undefined } : {}) }),
				);
			}
			return;
		case "m-size-m":
			if (sel?.type === "marker" && num !== undefined && num > 0) {
				store.commit(updateMarker(doc, sel.marker, { size: round1(num / (doc.metersPerPixel ?? REF_MPP)) }));
			}
			return;
		case "m-size-x":
			if (sel?.type === "marker" && (num === undefined || num > 0))
				store.commit(updateMarker(doc, sel.marker, { size: num && num !== 1 ? num : undefined }));
			return;
		case "m-rot":
			if (sel?.type === "marker")
				store.commit(updateMarker(doc, sel.marker, { rotation: num ? ((num % 360) + 360) % 360 : undefined }));
			return;
		case "m-line":
			if (sel?.type === "marker")
				store.commit(updateMarker(doc, sel.marker, { line: input.checked ? store.activeLine : undefined }));
			return;
	}
}

// ---------------------------------------------------------------- helpers

const round1 = (v: number): number => Math.round(v * 10) / 10;

function lineName(doc: TrackDoc, id: string): string {
	const l = lineById(doc, id);
	if (!l) return id;
	return typeof l.name === "object" ? (l.name.en ?? l.name.fr ?? id) : String(l.name || id);
}

function brakingLength(doc: TrackDoc, lineId: string, from: [number, number], to: [number, number]): number {
	const line = lineById(doc, lineId);
	if (!line || line.nodes.length < 2) return 0;
	const s = lineTrace(line).sampler;
	const a = s.project({ x: from[0], y: from[1] });
	const b = s.project({ x: to[0], y: to[1] });
	return ((((b - a) % s.total) + s.total) % s.total) * (doc.metersPerPixel ?? REF_MPP);
}

/** Length, lap time (authoring only: never shown to students) and speed coverage of a line. */
function lineStats(doc: TrackDoc, lineId: string): string {
	const line = lineById(doc, lineId);
	if (!line || line.nodes.length < 2) return "Draw at least 3 points.";
	const trace = lineTrace(line);
	const total = trace.sampler.total;
	const mpp = doc.metersPerPixel;
	const withSpeed = line.nodes.filter((n) => n.kmh !== undefined).length;
	let lap = "";
	if (mpp && withSpeed) {
		const pts = line.nodes.flatMap((n, i) =>
			n.kmh !== undefined ? [{ u: trace.nodeDist[i] / total, kmh: n.kmh }] : [],
		);
		const t = createManualTimeline(trace.sampler, { trackLengthM: total * mpp, speedPoints: pts }).lapMs / 1000;
		lap = `, lap ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
	}
	return `${mpp ? `${Math.round(total * mpp)} m` : `${Math.round(total)} px`}${lap}, speeds on ${withSpeed} of ${line.nodes.length} points.`;
}

/** Zoom the map to the selection (used by keyboard "F"). */
export function focusSelection(host: PanelHost): void {
	const doc = host.store.doc;
	const sel = host.store.selection;
	if (!sel) return;
	if (sel.type === "node") {
		const n = pathNodes(doc, sel.path)?.find((x) => x.id === sel.node);
		if (n) host.canvas.focus(n, 800);
	} else if (sel.type === "marker") {
		const m = doc.markers.find((x) => x.id === sel.marker);
		if (m) host.canvas.focus(markerPosition(doc, m), 800);
	} else if (sel.type === "zone") {
		const z = doc.zones.find((x) => x.id === sel.zone);
		if (z?.kind === "braking") host.canvas.focus({ x: z.from[0], y: z.from[1] }, 1200);
		else if (z?.kind === "passing") host.canvas.focus(z.nodes[Math.floor(z.nodes.length / 2)], 1500);
	}
}
