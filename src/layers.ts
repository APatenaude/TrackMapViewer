import { track } from "./analytics.js";
import { getLang, pick, registerI18n, setLang } from "./i18n.js";
import { openShareModal } from "./share.js";
import { encodeShareState } from "./shareState.js";
import type { AppConfig, Lang, PersistedState } from "./types.js";

const INSTALL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>`;

export interface LayersOptions {
	/** Called when the panel opens/closes (e.g. to move the FAB out of the way). */
	onOpenChange?: (open: boolean) => void;
	/** Toggle the minimap (navigator) visibility. */
	setMinimapVisible: (visible: boolean) => void;
}

export interface LayersResult {
	openPanel: () => void;
	closePanel: () => void;
	togglePanel: () => void;
}

export function applyLayerState(group: SVGGElement, visible: boolean, opacity: number): void {
	group.style.opacity = visible ? String(opacity) : "0";
}

export function applyAllLayerStates(cfg: AppConfig, svgEl: SVGSVGElement, state: PersistedState): void {
	for (const layer of cfg.layers) {
		const group = svgEl.querySelector<SVGGElement>(`#${CSS.escape(layer.id)}`);
		if (!group) continue;
		const s = state.layers[layer.id];
		if (s) applyLayerState(group, s.visible, s.opacity);
	}
}

export function initLayers(
	cfg: AppConfig,
	svgEl: SVGSVGElement,
	state: PersistedState,
	onStateChange: () => void,
	opts: LayersOptions,
): LayersResult {
	const panel = document.createElement("div");
	panel.id = "panel";
	panel.className = "panel";
	panel.setAttribute("role", "dialog");
	panel.setAttribute("data-i18n-aria", "layersPanel");

	// Scrim (mobile backdrop)
	const scrim = document.createElement("div");
	scrim.className = "panel-scrim";
	scrim.addEventListener("click", closePanel);

	panel.innerHTML = `
    <div class="panel-header">
      <div class="lang-toggle" role="group" aria-label="Language">
        <button class="lang-btn" data-lang="en">EN</button>
        <button class="lang-btn" data-lang="fr">FR</button>
      </div>
      <button class="icon-btn install-btn" data-i18n-aria="installApp" hidden>${INSTALL_ICON}</button>
      <button class="share-btn panel-share">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M3 11h8V3H3v8zm2-6h4v4H5V5z"/>
          <path d="M3 21h8v-8H3v8zm2-6h4v4H5v-4z"/>
          <path d="M13 3v8h8V3h-8zm6 6h-4V5h4v4z"/>
          <path d="M13 13h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm0-4h2v2h-2zm2 2h2v2h-2zm-2 4h2v2h-2z"/>
        </svg>
        <span data-i18n="share"></span>
      </button>
    </div>
    <div class="panel-body">
      <div class="layer-row minimap-row">
        <label class="toggle-label">
          <input type="checkbox" class="minimap-toggle" />
          <span class="layer-name" data-i18n="minimap"></span>
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn btn-sm all-on" data-i18n="allOn"></button>
        <button class="btn btn-sm all-off" data-i18n="allOff"></button>
      </div>
      <ul class="layer-list"></ul>
    </div>
  `;

	const list = panel.querySelector(".layer-list")!;

	// Build a row per configured layer
	for (const layer of cfg.layers) {
		const group = svgEl.querySelector<SVGGElement>(`#${CSS.escape(layer.id)}`);
		if (!group) {
			console.warn(`[TrackMap] Layer "${layer.id}" not found in SVG — skipping`);
			continue;
		}

		const s = state.layers[layer.id] ?? { visible: layer.defaultOn, opacity: layer.defaultOpacity };
		const opacityPct = Math.round(s.opacity * 100);

		const li = document.createElement("li");
		li.className = "layer-row";
		li.innerHTML = `
      <label class="toggle-label">
        <input type="checkbox" class="layer-toggle" data-id="${layer.id}" ${s.visible ? "checked" : ""} />
        <span class="layer-name" data-id="${layer.id}"></span>
      </label>
      <input type="range" class="opacity-slider" data-id="${layer.id}" min="0" max="100" value="${opacityPct}" />
    `;
		list.appendChild(li);

		li.querySelector<HTMLInputElement>(".layer-toggle")!.addEventListener("change", (e) => {
			const visible = (e.target as HTMLInputElement).checked;
			state.layers[layer.id]!.visible = visible;
			applyLayerState(group, visible, state.layers[layer.id]!.opacity);
			onStateChange();
			track("layer_toggle", { layer: layer.id, visible });
		});

		const slider = li.querySelector<HTMLInputElement>(".opacity-slider")!;
		slider.addEventListener("input", (e) => {
			const opacity = Number((e.target as HTMLInputElement).value) / 100;
			state.layers[layer.id]!.opacity = opacity;
			applyLayerState(group, state.layers[layer.id]!.visible, opacity);
			onStateChange();
		});
		// Fire once when the drag settles, not on every intermediate value.
		slider.addEventListener("change", () => {
			track("opacity_change", { layer: layer.id });
		});
	}

	// All on / off
	panel.querySelector(".all-on")!.addEventListener("click", () => {
		setAllVisible(true);
	});
	panel.querySelector(".all-off")!.addEventListener("click", () => {
		setAllVisible(false);
	});

	function setAllVisible(visible: boolean) {
		for (const layer of cfg.layers) {
			const group = svgEl.querySelector<SVGGElement>(`#${CSS.escape(layer.id)}`);
			if (!group || !state.layers[layer.id]) continue;
			state.layers[layer.id]!.visible = visible;
			// "All on" also resets opacity to 100%.
			if (visible) state.layers[layer.id]!.opacity = 1;
			applyLayerState(group, visible, state.layers[layer.id]!.opacity);
			const toggle = panel.querySelector<HTMLInputElement>(`.layer-toggle[data-id="${layer.id}"]`);
			if (toggle) toggle.checked = visible;
			if (visible) {
				const slider = panel.querySelector<HTMLInputElement>(`.opacity-slider[data-id="${layer.id}"]`);
				if (slider) slider.value = "100";
			}
		}
		onStateChange();
		track("all_layers", { visible });
	}

	// Share — encode the current layer/minimap settings into the link.
	panel.querySelector(".panel-share")!.addEventListener("click", () => {
		const url = location.origin + location.pathname + encodeShareState(cfg, state);
		openShareModal(url).catch(console.error);
	});

	// Minimap toggle
	const minimapToggle = panel.querySelector<HTMLInputElement>(".minimap-toggle")!;
	minimapToggle.checked = state.minimap;
	minimapToggle.addEventListener("change", () => {
		state.minimap = minimapToggle.checked;
		opts.setMinimapVisible(state.minimap);
		onStateChange();
	});

	// Language toggle
	panel.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((btn) => {
		btn.addEventListener("click", () => {
			const lang = btn.dataset.lang as Lang;
			state.lang = lang;
			setLang(lang);
			onStateChange();
		});
	});

	// Re-apply localized layer names + active language button on each switch
	registerI18n(() => {
		for (const layer of cfg.layers) {
			const nameEl = panel.querySelector<HTMLElement>(`.layer-name[data-id="${layer.id}"]`);
			if (nameEl) nameEl.textContent = pick(layer.label);
		}
		panel.querySelectorAll<HTMLButtonElement>(".lang-btn").forEach((b) => {
			const active = b.dataset.lang === getLang();
			b.classList.toggle("active", active);
			b.setAttribute("aria-pressed", String(active));
		});
	});

	// Keep in sync with the .panel transition duration in style.css.
	const CLOSE_MS = 240;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function openPanel() {
		if (hideTimer !== null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		// Take it out of display:none, then force a reflow so the slide-in animates
		// from the closed state rather than snapping straight to open.
		panel.style.display = "";
		void panel.offsetHeight;
		panel.classList.add("open");
		scrim.classList.add("visible");
		opts.onOpenChange?.(true);
	}

	function closePanel() {
		panel.classList.remove("open");
		scrim.classList.remove("visible");
		opts.onOpenChange?.(false);
		// After the slide-out, fully remove the sheet from the render tree. While it
		// lingered at opacity:0 iOS Safari could still sample its white behind the
		// bottom URL bar and stay tinted; display:none forces a re-sample of the map.
		hideTimer = setTimeout(() => {
			panel.style.display = "none";
			hideTimer = null;
		}, CLOSE_MS);
	}

	function togglePanel() {
		if (panel.classList.contains("open")) closePanel();
		else openPanel();
	}

	// Close when clicking/tapping outside the drawer (desktop has no scrim). Ignore
	// the FAB so its toggle tap isn't immediately undone.
	document.addEventListener("pointerdown", (e) => {
		if (!panel.classList.contains("open")) return;
		const t = e.target as HTMLElement;
		if (panel.contains(t) || t.closest(".fab") || t.closest(".fab-mini") || t.closest(".modal-scrim")) return;
		closePanel();
	});

	document.body.appendChild(scrim);
	document.body.appendChild(panel);
	// Start fully hidden (not just transparent) so it can't be sampled while closed.
	panel.style.display = "none";

	return { openPanel, closePanel, togglePanel };
}
