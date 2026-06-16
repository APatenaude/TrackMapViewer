import type { AppConfig, Lang, PersistedState } from "./types.js";

const STATE_KEY = "trackmap.state";

function detectBrowserLang(): Lang {
	return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function defaultState(cfg: AppConfig): PersistedState {
	const layers: PersistedState["layers"] = {};
	for (const l of cfg.layers) {
		layers[l.id] = { visible: l.defaultOn, opacity: l.defaultOpacity };
	}
	return { view: null, layers, lang: detectBrowserLang(), minimap: true, drawingEnabled: true, rotationEnabled: true };
}

export function loadState(cfg: AppConfig): PersistedState {
	const def = defaultState(cfg);
	try {
		const raw = localStorage.getItem(STATE_KEY);
		if (!raw) return def;
		const stored = JSON.parse(raw) as Partial<PersistedState>;
		// Merge layers: use stored values where present, fall back to defaults for new layers
		const layers = { ...def.layers };
		if (stored.layers) {
			for (const [id, s] of Object.entries(stored.layers)) {
				if (id in layers) layers[id] = s;
			}
		}
		return {
			// View is never restored from storage - a reload always resets it.
			view: null,
			layers,
			lang: (stored.lang as Lang) ?? def.lang,
			minimap: stored.minimap ?? def.minimap,
			drawingEnabled: stored.drawingEnabled ?? def.drawingEnabled,
			rotationEnabled: stored.rotationEnabled ?? def.rotationEnabled,
		};
	} catch {
		return def;
	}
}

export function saveState(state: PersistedState): void {
	// Drop `view` - pan/zoom/rotation must not survive a reload (memory-only, for share links).
	const { view: _view, ...rest } = state;
	localStorage.setItem(STATE_KEY, JSON.stringify(rest));
}
