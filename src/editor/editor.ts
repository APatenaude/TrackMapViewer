import { readTrackDoc, TRACK_SCHEMA, type TrackDoc, type TrackIndexEntry } from "../trackDoc.js";
import type { TileSource } from "../viewer.js";
import { EditCanvas } from "./canvas.js";
import { deleteDraft, listDrafts, putDraft, type Draft } from "./drafts.js";
import "./editor.css";
import { Interaction } from "./interaction.js";
import { buildPanel, buildToolbar, checks, focusSelection, type PanelHost } from "./panel.js";
import { loadPhoto } from "./photo.js";
import { canDirectSave, downloadZip, saveDirect } from "./save.js";
import { serializeTrackDoc } from "./serialize.js";
import { EditorStore } from "./store.js";

/*
 * Track editor (/admin): pick a track, a draft or a new photo, then edit it on the map.
 * Work is autosaved as a draft in this browser; Save writes it into the repo (dev server
 * on this machine) or downloads a zip.
 */

const AUTOSAVE_MS = 800;

export async function startEditor(): Promise<void> {
	document.title = "Track editor";
	document.body.className = "editor";
	document.body.replaceChildren();
	const tracks: TrackIndexEntry[] = await fetch("/tracks/index.json", { cache: "no-store" })
		.then((r) => r.json())
		.catch(() => []);
	await showOpenScreen(tracks);
}

// ---------------------------------------------------------------- open screen

async function showOpenScreen(tracks: TrackIndexEntry[]): Promise<void> {
	const drafts = await listDrafts().catch((): Draft[] => []);
	const draftFor = new Map(drafts.map((d) => [d.id, d]));
	const newDrafts = drafts.filter((d) => d.id.startsWith("new-"));
	const name = (n: unknown, fallback: string): string =>
		(n && typeof n === "object" ? ((n as { en?: string }).en ?? (n as { fr?: string }).fr) : (n as string)) || fallback;
	const when = (t: number): string => new Date(t).toLocaleString();

	const root = document.createElement("div");
	root.className = "ed-open";
	root.innerHTML = `
		<h1>Track editor</h1>
		<section>
			<h2>Tracks</h2>
			${
				tracks
					.map(
						(t) =>
							`<button class="ed-open-item" data-open="${t.slug}"><b>${escHtml(name(t.name, t.slug))}</b> <span>/${t.slug}${t.unlisted ? " (link only)" : ""}</span>${
								draftFor.has(t.slug) ? `<em>unsaved changes from ${when(draftFor.get(t.slug)!.updated)}</em>` : ""
							}</button>`,
					)
					.join("") || `<p>No tracks yet.</p>`
			}
		</section>
		${
			newDrafts.length
				? `<section><h2>New tracks not saved yet</h2>${newDrafts
						.map(
							(d) =>
								`<div class="ed-open-row"><button class="ed-open-item" data-draft="${d.id}"><b>${escHtml(name(d.doc.name, "Untitled track"))}</b><em>${when(d.updated)}</em></button><button class="danger" data-discard="${d.id}">Discard</button></div>`,
						)
						.join("")}</section>`
				: ""
		}
		<section>
			<h2>New track</h2>
			<label class="ed-file">Choose a photo of the track&hellip;<input type="file" accept="image/*" /></label>
			<p class="ed-muted">An aerial or satellite image of the whole circuit. You'll draw the racing line on it, then set the lap length for the scale.</p>
		</section>
		<p class="ed-muted">Edits are kept as a draft in this browser until you Save. Under <code>npm run dev</code> on this computer, Save writes straight into the repo's <code>tracks/</code> folder; anywhere else it downloads a zip to unzip at the repo root.</p>
	`;
	document.body.appendChild(root);

	root.addEventListener("click", async (e) => {
		const t = e.target as HTMLElement;
		const open = t.closest<HTMLElement>("[data-open]")?.dataset.open;
		const draftId = t.closest<HTMLElement>("[data-draft]")?.dataset.draft;
		const discard = t.closest<HTMLElement>("[data-discard]")?.dataset.discard;
		if (discard && confirm("Discard this unsaved track?")) {
			await deleteDraft(discard);
			location.reload();
		} else if (open) {
			const entry = tracks.find((x) => x.slug === open)!;
			root.remove();
			await openTrack(entry, tracks, draftFor.get(open));
		} else if (draftId) {
			const d = draftFor.get(draftId)!;
			if (!d.photo) return alert("This draft has no photo; discard it and start again.");
			root.remove();
			startSession({ doc: d.doc, tiles: imageSource(d.photo), draftId: d.id, photo: d.photo, isNew: true, tracks });
		}
	});
	root.querySelector<HTMLInputElement>('input[type="file"]')!.addEventListener("change", async (e) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			const photo = await loadPhoto(file);
			const doc: TrackDoc = {
				schema: TRACK_SCHEMA,
				slug: "",
				name: { en: "", fr: "" },
				image: { width: photo.width, height: photo.height },
				lines: [],
				zones: [],
				markers: [],
			};
			root.remove();
			startSession({
				doc,
				tiles: imageSource(photo.blob),
				draftId: `new-${Date.now()}`,
				photo: photo.blob,
				isNew: true,
				tracks,
			});
		} catch (err) {
			alert(`Couldn't open that photo: ${(err as Error).message}`);
		}
	});
}

async function openTrack(entry: TrackIndexEntry, tracks: TrackIndexEntry[], draft?: Draft): Promise<void> {
	const deployed = readTrackDoc(await fetch(entry.doc, { cache: "no-store" }).then((r) => r.json()));
	const deployedText = serializeTrackDoc(deployed);
	let doc = deployed;
	if (draft) {
		// Saved (and now deployed) since: the draft has nothing left to keep.
		if (serializeTrackDoc(draft.doc) === deployedText) {
			await deleteDraft(draft.id);
		} else {
			const changedSince = draft.base !== undefined && draft.base !== deployedText;
			const keep = confirm(
				`You have unsaved changes to this track (${new Date(draft.updated).toLocaleString()}).` +
					(changedSince ? " The saved track has changed since then." : "") +
					"\n\nOK: continue with those changes.\nCancel: discard them and open the saved track.",
			);
			if (keep) doc = draft.doc;
			else await deleteDraft(draft.id);
		}
	}
	startSession({ doc, tiles: entry.tiles, draftId: entry.slug, isNew: false, tracks, base: deployedText });
}

const imageSource = (blob: Blob): TileSource => ({ type: "image", url: URL.createObjectURL(blob) });

// ---------------------------------------------------------------- session

interface SessionOptions {
	doc: TrackDoc;
	tiles: TileSource;
	draftId: string;
	/** A new track's photo (saved alongside the first save). */
	photo?: Blob;
	isNew: boolean;
	tracks: TrackIndexEntry[];
	/** The deployed track.json text this edit started from. */
	base?: string;
}

function startSession(opts: SessionOptions): void {
	let { draftId, isNew } = opts;
	let savedText = opts.base;
	let lastDraftSave = 0;
	let message = "";

	document.body.innerHTML = `<div class="ed-app"><div class="ed-map"><div class="ed-viewer"></div></div><aside class="ed-panel"></aside></div>`;
	const mapEl = document.querySelector<HTMLElement>(".ed-map")!;
	const store = new EditorStore(opts.doc);
	const canvas = new EditCanvas(
		document.querySelector<HTMLElement>(".ed-viewer")!,
		opts.tiles,
		opts.doc.image.width,
		opts.doc.image.height,
	);
	const interaction = new Interaction(canvas, store);

	const unsaved = (): boolean => savedText === undefined || serializeTrackDoc(store.base) !== savedText;
	const host: PanelHost = {
		store,
		interaction,
		canvas,
		isNew: () => isNew,
		status: () => {
			if (message) return message;
			if (!unsaved()) return "All changes saved.";
			return lastDraftSave
				? `Not saved yet (draft kept in this browser, ${new Date(lastDraftSave).toLocaleTimeString()}).`
				: "Not saved yet.";
		},
		save: () => void save(),
		preview: () => void preview(),
		close: () => {
			void flushDraft().then(() => (location.href = "/admin"));
		},
	};
	const refreshPanel = buildPanel(host, document.querySelector<HTMLElement>(".ed-panel")!);
	const refreshToolbar = buildToolbar(host, mapEl);
	interaction.onChange = () => refreshToolbar();

	store.subscribe((kind) => {
		if (kind === "preview") canvas.render(store.doc, store.activeLine, interaction.dragOnly);
		else canvas.render(store.doc, store.activeLine);
		if (kind === "doc") {
			message = "";
			scheduleDraft();
		}
		refreshPanel(kind);
		refreshToolbar();
	});

	// ------------------------------------------------ drafts

	let draftTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleDraft(): void {
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = setTimeout(() => void flushDraft(), AUTOSAVE_MS);
	}
	async function flushDraft(): Promise<void> {
		if (draftTimer) {
			clearTimeout(draftTimer);
			draftTimer = null;
		}
		// Undone back to the saved track: drop the draft so reopening doesn't offer stale changes.
		if (!unsaved() && !isNew) {
			await deleteDraft(draftId).catch(() => undefined);
			return;
		}
		await putDraft({ id: draftId, doc: store.base, base: savedText, photo: opts.photo, updated: Date.now() }).catch(
			() => undefined,
		);
		lastDraftSave = Date.now();
		refreshPanel("selection");
	}
	addEventListener("pagehide", () => void flushDraft());

	// ------------------------------------------------ save / preview

	async function save(): Promise<void> {
		const doc = store.base;
		const errors = checks(host, doc).filter((c) => c.level === "error");
		if (isNew && opts.tracks.some((t) => t.slug === doc.slug))
			errors.push({ level: "error", text: `The web address /${doc.slug} is already used by another track.` });
		if (errors.length) {
			alert(`Fix these first:\n\n- ${errors.map((e) => e.text).join("\n- ")}`);
			return;
		}
		const json = serializeTrackDoc(doc);
		message = "Saving...";
		refreshPanel("selection");
		const photo = isNew ? opts.photo : undefined;
		const direct = await canDirectSave();
		const res = direct ? await saveDirect(doc.slug, json, isNew, photo) : await downloadZip(doc.slug, json, photo);
		message = res.ok || res.saved ? res.message : `Not saved: ${res.message}`;
		if (res.problems?.length) alert(`Not saved:\n\n- ${res.problems.join("\n- ")}`);
		if (res.ok || res.saved) {
			savedText = json;
			if (direct) {
				await deleteDraft(draftId).catch(() => undefined);
				if (isNew) {
					draftId = doc.slug;
					isNew = false;
					opts.photo = undefined;
				}
			} else {
				// A zipped new track isn't in the list yet: only its draft (with the photo) can reopen it.
				await flushDraft();
			}
		}
		refreshPanel("doc");
	}

	async function preview(): Promise<void> {
		// The viewer reads the draft from IndexedDB, so write it first.
		await putDraft({ id: draftId, doc: store.base, base: savedText, photo: opts.photo, updated: Date.now() });
		lastDraftSave = Date.now();
		window.open(`/${store.base.slug || "preview"}?draft=${encodeURIComponent(draftId)}`, "_blank");
	}

	// ------------------------------------------------ keyboard

	addEventListener("keydown", (e) => {
		const field =
			e.target instanceof HTMLElement
				? e.target.closest("input:not([type=radio], [type=checkbox]), textarea, select, [contenteditable]")
				: null;
		if (field) {
			if (e.key === "Escape") (field as HTMLElement).blur();
			return;
		}
		const k = e.key.toLowerCase();
		if (e.ctrlKey || e.metaKey) {
			if (k === "z") store[e.shiftKey ? "redo" : "undo"]();
			else if (k === "y") store.redo();
			else if (k === "s") void save();
			else return;
			e.preventDefault();
			return;
		}
		const tools: Record<string, Parameters<Interaction["setTool"]>[0]> = {
			v: "select",
			p: "points",
			b: "braking",
			g: "passing",
		};
		if (k === "escape") interaction.cancel();
		else if (k === "delete" || k === "backspace") interaction.deleteSelection();
		else if (k === "enter") interaction.finish();
		else if (k === "f") focusSelection(host);
		else if (k === "m") mapEl.querySelector<HTMLElement>('[data-tool="marker"]')?.click();
		else if (tools[k]) interaction.setTool(tools[k]);
		else return;
		e.preventDefault();
	});

	void canvas.ready.then(() => {
		canvas.render(store.doc, store.activeLine);
		refreshPanel("doc");
		refreshToolbar();
		if (isNew && !store.doc.lines.length) {
			message = "New track: name it under Track, then New line to draw the racing line.";
			refreshPanel("doc");
		}
	});
	refreshPanel("doc");
	refreshToolbar();
}

function escHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
