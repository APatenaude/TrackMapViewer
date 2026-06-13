import { initAnalytics } from "./analytics.js";
import { initDraw } from "./draw.js";
import { initFab } from "./fab.js";
import { initI18n, pick, registerI18n, translateTree } from "./i18n.js";
import { initInstall, setupInstallCapture } from "./install.js";
import { applyAllLayerStates, initLayers } from "./layers.js";
import { initShare } from "./share.js";
import { decodeShareState } from "./shareState.js";
import { debouncedSaveState, loadState, saveState } from "./state.js";
import "./style.css";
import "./theme.css";
import type { AppConfig } from "./types.js";
import { initViewer } from "./viewer.js";

async function init(): Promise<void> {
	// Capture the PWA install prompt first — it can fire before config resolves.
	setupInstallCapture();

	const cfg: AppConfig = await fetch("/config.json").then((r) => r.json());

	initAnalytics(cfg);

	const svgText = await fetch(cfg.svgPath ?? "/track.svg").then((r) => r.text());
	const svgDoc = new DOMParser().parseFromString(svgText, "image/svg+xml");

	const state = loadState(cfg);
	initI18n(state.lang);

	// A shared link (?s=…) overrides layer/minimap settings, then is stripped from
	// the URL so later local changes aren't re-clobbered on reload.
	const shared = decodeShareState(location.search);
	if (shared) {
		for (const [id, s] of Object.entries(shared.layers)) {
			if (state.layers[id]) state.layers[id] = { visible: s.visible, opacity: s.opacity };
		}
		if (shared.minimap !== undefined) state.minimap = shared.minimap;
		saveState(state);
		history.replaceState(null, "", location.origin + location.pathname);
	}

	const container = document.getElementById("viewer")!;
	const { viewer, svgEl, setMinimapVisible } = initViewer(container, cfg, svgDoc, state, (x, y, zoom) => {
		state.view = { x, y, zoom };
		debouncedSaveState(state);
	});

	// Apply initial layer visibility before OSD fires "open"
	applyAllLayerStates(cfg, svgEl, state);

	// FAB toggles the panel; the panel moves the FAB out of its own way when open.
	let togglePanel = (): void => {};
	const fab = initFab(() => togglePanel());
	const layers = initLayers(cfg, svgEl, state, () => saveState(state), {
		onOpenChange: (open) => fab.setPanelOpen(open),
		setMinimapVisible,
	});
	togglePanel = layers.togglePanel;

	initShare();

	// Draw-mode toggle (mini-FAB satellite) + PWA install button (drawer header).
	initDraw(viewer, svgEl, fab, layers.closePanel);
	initInstall(document.querySelector<HTMLButtonElement>(".install-btn")!);

	// Apply UI text now and on every language change (covers panel, modal, FAB, title).
	registerI18n(() => {
		const base = pick(cfg.title);
		document.title = cfg.trackName ? `${base} - ${cfg.trackName}` : base;
		translateTree(document.body);
	});
}

init().catch(console.error);
