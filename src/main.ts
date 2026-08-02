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
import type { AppConfig } from "./types.js";
import { initViewer } from "./viewer.js";

async function init(): Promise<void> {
	// Only some contexts need the drawer to clear the OS bottom strip (see usesBottomSafeArea
	// and body.safe-area-bottom in style.css); default is a plain 12px gap.
	if (usesBottomSafeArea()) document.body.classList.add("safe-area-bottom");

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
	const { viewer, svgEl, setRotationLocked } = initViewer(
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

	let togglePanel = (): void => {};
	const fab = initFab(() => togglePanel());
	const layers = initLayers(cfg, svgEl, state, () => saveState(state), {
		onOpenChange: (open) => fab.setPanelOpen(open),
	});
	togglePanel = layers.togglePanel;

	initShare();

	// Draw / compass / replay tools (mini-FAB satellites) + PWA install button (drawer header).
	const drawApi = initDraw(viewer, svgEl, fab, layers.closePanel);
	const compassApi = initCompass(viewer, fab, { northOffset: cfg.northOffset ?? 0, setRotationLocked });
	const replayApi = initReplay(viewer, svgEl, fab, layers.closePanel, cfg.replay);
	initInstall(document.querySelector<HTMLButtonElement>(".install-btn")!);

	// The tools are always available (their toggles were removed).
	drawApi.setEnabled(true);
	compassApi.setEnabled(true);
	replayApi.setEnabled(true);

	// Apply UI text now and on every language change (covers panel, modal, FAB, title).
	registerI18n(() => {
		const base = pick(cfg.title);
		document.title = cfg.trackName ? `${base} - ${cfg.trackName}` : base;
		translateTree(document.body);
	});
}

init().catch(console.error);
