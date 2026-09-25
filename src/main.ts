import { initAnalytics, loadAnalyticsOverride } from "./analytics.js";
import { initCompass } from "./compass.js";
import { initDraw } from "./draw.js";
import { initFab } from "./fab.js";
import { initI18n, pick, registerI18n, translateTree } from "./i18n.js";
import { initInstall, setupInstallCapture } from "./install.js";
import { applyAllLayerStates, initLayers } from "./layers.js";
import { usesBottomSafeArea } from "./platform.js";
import { initReplay } from "./replay.js";
import { initShare } from "./share.js";
import { decodeShareState } from "./shareState.js";
import { loadState, saveState } from "./state.js";
import "./style.css";
import "./theme.css";
import { readTrackDoc, type RacingLine, type TrackDoc, type TrackIndexEntry } from "./trackDoc.js";
import type { AppConfig, PersistedState } from "./types.js";
import { initViewer } from "./viewer.js";

// Share links and QR codes from before tracks had their own URLs (/?s=...) were all Tremblant.
const LEGACY_TRACK = "tremblant";

/** The track this URL asks for. A bare / redirects in place to /<slug> so later share links carry it. */
function pickTrack(tracks: TrackIndexEntry[], cfg: AppConfig, state: PersistedState): TrackIndexEntry {
	const find = (slug: string | undefined): TrackIndexEntry | undefined => tracks.find((t) => t.slug === slug);
	const fallback = find(cfg.defaultTrack) ?? tracks[0];
	let segment = location.pathname.split("/").filter(Boolean)[0] ?? "";
	try {
		segment = decodeURIComponent(segment).toLowerCase();
	} catch {
		segment = ""; // a malformed escape: treat as the bare URL
	}
	if (segment === "index.html") segment = "";
	if (segment) {
		// Keep the URL: an unknown name may be a track this (cached) list doesn't know yet.
		const hit = find(segment);
		if (!hit) console.warn(`track "${segment}" not found, showing ${fallback.slug}`);
		return hit ?? fallback;
	}
	const legacy = new URLSearchParams(location.search).has("s") ? find(LEGACY_TRACK) : undefined;
	const entry = legacy ?? find(state.lastTrack) ?? fallback;
	history.replaceState(null, "", `/${entry.slug}${location.search}${location.hash}`);
	return entry;
}

async function init(): Promise<void> {
	// Only some contexts need the drawer to clear the OS bottom strip (see usesBottomSafeArea
	// and body.safe-area-bottom in style.css); default is a plain 12px gap.
	if (usesBottomSafeArea()) document.body.classList.add("safe-area-bottom");

	// Capture the PWA install prompt first - it can fire before config resolves.
	setupInstallCapture();

	// The single-track version cached tiles here; tracks now use the track-tiles cache.
	globalThis.caches?.delete("tiles-cache").catch(() => undefined);

	const cfg: AppConfig = await fetch("/config.json").then((r) => r.json());

	// Owner's private Umami details (mounted /analytics.json; absent in the public image). See analytics.ts.
	const analyticsOverride = await loadAnalyticsOverride();
	if (analyticsOverride) cfg.analytics = analyticsOverride;

	initAnalytics(cfg);

	const state = loadState(cfg);
	initI18n(state.lang);

	const tracks: TrackIndexEntry[] = await fetch("/tracks/index.json").then((r) => r.json());
	if (tracks.length === 0) throw new Error("no tracks in /tracks/index.json");
	const entry = pickTrack(tracks, cfg, state);
	const doc = readTrackDoc(await fetch(entry.doc).then((r) => r.json()));
	state.lastTrack = doc.slug;

	// A shared link (?s=…) overrides settings + (v2) the view, then is stripped from the URL.
	const shared = decodeShareState(location.search);
	if (shared) {
		for (const [id, s] of Object.entries(shared.layers)) {
			if (state.layers[id]) state.layers[id] = { visible: s.visible, opacity: s.opacity };
		}
		if (shared.minimap !== undefined) state.minimap = shared.minimap;
		if (shared.drawing !== undefined) state.drawingEnabled = shared.drawing;
		if (shared.rotation !== undefined) state.rotationEnabled = shared.rotation;
		if (shared.line && doc.lines.some((l) => l.id === shared.line)) state.lines[doc.slug] = shared.line;
		// The viewer restores state.view on "open"; the view itself never persists.
		if (shared.view) state.view = shared.view;
		history.replaceState(null, "", location.origin + location.pathname);
	}
	// The saved line may have been removed from the track since.
	const lineOf = (id: string | undefined): RacingLine | undefined => doc.lines.find((l) => l.id === id) ?? doc.lines[0];
	let line = lineOf(state.lines[doc.slug]);
	saveState(state);

	const container = document.getElementById("viewer")!;
	// View lives in memory only (feeds share links, never saved) - see state.ts saveState.
	const { viewer, svgEl, setRotationLocked, setRotationPivot, setLine } = initViewer(
		container,
		cfg,
		doc,
		entry.tiles,
		line?.id,
		state,
		(x, y, zoom, rotation) => {
			state.view = { x, y, zoom, rotation };
		},
	);

	// Apply initial layer visibility before OSD fires "open"
	applyAllLayerStates(cfg, svgEl, state);

	let togglePanel = (): void => {};
	const fab = initFab(() => togglePanel());
	let onLineChange = (_id: string): void => {};
	const layers = initLayers(cfg, svgEl, state, () => saveState(state), {
		onOpenChange: (open) => fab.setPanelOpen(open),
		tracks: tracks.map((t) => ({ id: t.slug, name: t.name })),
		currentTrack: doc.slug,
		lines: doc.lines.map((l) => ({ id: l.id, name: l.name })),
		currentLine: line?.id,
		onLineChange: (id) => onLineChange(id),
		shareLine: () => (line && line !== doc.lines[0] ? line.id : undefined),
	});
	togglePanel = layers.togglePanel;

	initShare();

	// Draw / compass / replay tools (mini-FAB satellites) + PWA install button (drawer header).
	const drawApi = initDraw(viewer, svgEl, fab, layers.closePanel);
	const compassApi = initCompass(viewer, fab, { northOffset: doc.northOffset ?? 0, setRotationLocked });
	const replayApi = initReplay(viewer, svgEl, fab, layers.closePanel, doc, line, drawApi.isStroking, setRotationPivot);
	initInstall(document.querySelector<HTMLButtonElement>(".install-btn")!);

	onLineChange = (id) => {
		line = lineOf(id);
		if (!line) return;
		state.lines[doc.slug] = line.id;
		saveState(state);
		setLine(line.id);
		replayApi.setLine(line);
	};

	// The tools are always available (their toggles were removed); replay needs a line to drive.
	drawApi.setEnabled(true);
	compassApi.setEnabled(true);
	replayApi.setEnabled(doc.lines.length > 0);
	warmOfflineCache(entry, doc);

	// Apply UI text now and on every language change (covers panel, modal, FAB, title).
	registerI18n(() => {
		document.title = `${pick(cfg.title)} - ${pick(doc.name)}`;
		translateTree(document.body);
	});
}

/**
 * On a first visit the service worker only takes over after this page fetched its track, so
 * nothing of it was cached: fetch it again through the worker (list, document, and the
 * overview tiles the opening view uses), or the track won't open offline next time.
 */
function warmOfflineCache(entry: TrackIndexEntry, doc: TrackDoc): void {
	const sw = navigator.serviceWorker;
	if (!sw || sw.controller) return;
	sw.addEventListener(
		"controllerchange",
		() => {
			const urls = ["/tracks/index.json", entry.doc, entry.tiles];
			// Deep Zoom levels halve the image each step; warm those up to 2048 px on the long side.
			const base = entry.tiles.replace(/\.dzi$/, "_files");
			const maxLevel = Math.ceil(Math.log2(Math.max(doc.image.width, doc.image.height)));
			for (let level = 0; level <= maxLevel; level++) {
				const scale = 2 ** (maxLevel - level);
				const w = Math.ceil(doc.image.width / scale);
				const h = Math.ceil(doc.image.height / scale);
				if (Math.max(w, h) > 2048) break;
				for (let col = 0; col < Math.ceil(w / 256); col++) {
					for (let row = 0; row < Math.ceil(h / 256); row++) urls.push(`${base}/${level}/${col}_${row}.jpg`);
				}
			}
			for (const url of urls) fetch(url).catch(() => undefined);
		},
		{ once: true },
	);
}

init().catch((err) => {
	console.error(err);
	// A new deploy's data read by the old cached app can fail; the updated worker takes over shortly.
	navigator.serviceWorker?.addEventListener("controllerchange", () => location.reload(), { once: true });
});
