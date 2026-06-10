import type { AppConfig, FabCorner, Lang, PersistedState } from "./types.js";

const STATE_KEY = "trackmap.state";

function detectBrowserLang(): Lang {
	return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function defaultState(cfg: AppConfig): PersistedState {
	const layers: PersistedState["layers"] = {};
	for (const l of cfg.layers) {
		layers[l.id] = { visible: l.defaultOn, opacity: l.defaultOpacity };
	}
	return { view: null, layers, fabCorner: "tl", lang: detectBrowserLang(), minimap: true };
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
			view: stored.view ?? null,
			layers,
			fabCorner: (stored.fabCorner as FabCorner) ?? def.fabCorner,
			lang: (stored.lang as Lang) ?? def.lang,
			minimap: stored.minimap ?? def.minimap,
		};
	} catch {
		return def;
	}
}

export function saveState(state: PersistedState): void {
	localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
export function debouncedSaveState(state: PersistedState): void {
	if (_debounceTimer !== null) clearTimeout(_debounceTimer);
	_debounceTimer = setTimeout(() => {
		_debounceTimer = null;
		saveState(state);
	}, 300);
}
