import { initAnalytics, loadAnalyticsOverride } from "./analytics.js";
import { type CompassApi, initCompass } from "./compass.js";
import { type DrawApi, initDraw } from "./draw.js";
import { initFab } from "./fab.js";
import { initI18n, pick, registerI18n, translateTree } from "./i18n.js";
import { initInstall, setupInstallCapture } from "./install.js";
import { applyAllLayerStates, initLayers } from "./layers.js";
import { initShare } from "./share.js";
import { decodeShareState } from "./shareState.js";
import { loadState, saveState } from "./state.js";
import "./style.css";
import "./theme.css";
import type { AppConfig } from "./types.js";
import { initViewer } from "./viewer.js";

async function init(): Promise<void> {
	// Capture the PWA install prompt first - it can fire before config resolves.
	setupInstallCapture();

	const cfg: AppConfig = await fetch("/config.json").then((r) => r.json());

	// Owner's private Umami details (mounted /analytics.json; absent in the public image). See analytics.ts.
	const analyticsOverride = await loadAnalyticsOverride();
	if (analyticsOverride) cfg.analytics = analyticsOverride;

	initAnalytics(cfg);

	const svgText = await fetch(cfg.svgPath ?? "/track.svg").then((r) => r.text());
	const svgDoc = new DOMParser().parseFromString(svgText, "image/svg+xml");

	const state = loadState(cfg);
	initI18n(state.lang);

	// A shared link (?s=…) overrides settings + (v2) the view, then is stripped from the URL.
	const shared = decodeShareState(location.search);
	if (shared) {
		for (const [id, s] of Object.entries(shared.layers)) {
			if (state.layers[id]) state.layers[id] = { visible: s.visible, opacity: s.opacity };
		}
		if (shared.minimap !== undefined) state.minimap = shared.minimap;
		if (shared.drawing !== undefined) state.drawingEnabled = shared.drawing;
		if (shared.rotation !== undefined) state.rotationEnabled = shared.rotation;
		// The viewer restores state.view on "open"; the view itself never persists.
		if (shared.view) state.view = shared.view;
		saveState(state);
		history.replaceState(null, "", location.origin + location.pathname);
	}

	const container = document.getElementById("viewer")!;
	// View lives in memory only (feeds share links, never saved) - see state.ts saveState.
	const { viewer, svgEl, setMinimapVisible, setRotationLocked } = initViewer(
		container,
		cfg,
		svgDoc,
		state,
		(x, y, zoom, rotation) => {
			state.view = { x, y, zoom, rotation };
		},
	);

	// Apply initial layer visibility before OSD fires "open"
	applyAllLayerStates(cfg, svgEl, state);

	// draw/compass are created after the panel, so the Options checkboxes reach them via these mutable handles.
	let togglePanel = (): void => {};
	let drawApi: DrawApi = { setEnabled: () => {} };
	let compassApi: CompassApi = { setEnabled: () => {} };
	const fab = initFab(() => togglePanel());
	const layers = initLayers(cfg, svgEl, state, () => saveState(state), {
		onOpenChange: (open) => fab.setPanelOpen(open),
		setMinimapVisible,
		setDrawingEnabled: (on) => drawApi.setEnabled(on),
		setRotationEnabled: (on) => compassApi.setEnabled(on),
	});
	togglePanel = layers.togglePanel;

	initShare();

	// Draw-mode toggle + compass (mini-FAB satellites) + PWA install button (drawer header).
	drawApi = initDraw(viewer, svgEl, fab, layers.closePanel);
	compassApi = initCompass(viewer, fab, { northOffset: cfg.northOffset ?? 0, setRotationLocked });
	initInstall(document.querySelector<HTMLButtonElement>(".install-btn")!);

	// Apply persisted tool toggles (hides a FAB if its tool is switched off).
	drawApi.setEnabled(state.drawingEnabled);
	compassApi.setEnabled(state.rotationEnabled);

	// Apply UI text now and on every language change (covers panel, modal, FAB, title).
	registerI18n(() => {
		const base = pick(cfg.title);
		document.title = cfg.trackName ? `${base} - ${cfg.trackName}` : base;
		translateTree(document.body);
	});
}

init().catch(console.error);
