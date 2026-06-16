import type { AppConfig, PersistedState } from "./types.js";

/* ──────────────────────────────────────────────────────────────────────────
 * Shareable state wire format (the `?s=` query param)
 *
 * ⚠️ COMPATIBILITY CONTRACT - READ BEFORE CHANGING ⚠️
 * The `?s=` payload is a PUBLIC, PERSISTED, SHAREABLE wire format: links that
 * people have already copied/QR-saved encode whatever shape this file produced
 * at the time. Those old links will be opened in the future.
 *
 * Therefore:
 *   • ANY change to the payload shape or the meaning of a field MUST bump
 *     SHARE_STATE_VERSION.
 *   • decodeShareState() MUST keep understanding every version it ever emitted
 *     (add a branch per old version), OR - at minimum - safely IGNORE payloads
 *     whose version it doesn't recognize (current behavior) so old/garbled links
 *     fall back to defaults instead of applying wrong settings or throwing.
 *   • Never silently repurpose a field number/key. Add new fields; don't reuse.
 *
 * Payload (v1): { v: 1, layers: { [id]: [visible01, opacityPct] }, minimap: 0|1 }
 *   - visible01:  0 or 1
 *   - opacityPct: integer 0-100
 *   - minimap:    0 or 1
 * Payload (v2): v1 + `drawing`/`rotation` (0|1 tool toggles) + optional
 *   `view: [x, y, zoom, rotationDeg]` (viewport coords; x/y/zoom fractional,
 *   rotationDeg an integer). `view` is present only when a view exists.
 * Encoded as base64url of the JSON. decodeShareState() understands v1 and v2.
 * ────────────────────────────────────────────────────────────────────────── */

export const SHARE_STATE_VERSION = 2;

const PARAM = "s";

/** Decoded, normalized share state. All fields optional - apply what's present. */
export interface SharedState {
	layers: Record<string, { visible: boolean; opacity: number }>;
	minimap?: boolean;
	drawing?: boolean;
	rotation?: boolean;
	view?: { x: number; y: number; zoom: number; rotation: number };
}

const round = (n: number, dp: number): number => {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
};

function toBase64Url(s: string): string {
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/** Build the `?s=…` query string (including the leading `?`) from current state. */
export function encodeShareState(cfg: AppConfig, state: PersistedState): string {
	const layers: Record<string, [number, number]> = {};
	for (const layer of cfg.layers) {
		const s = state.layers[layer.id];
		if (!s) continue;
		layers[layer.id] = [s.visible ? 1 : 0, Math.round(s.opacity * 100)];
	}
	const payload: {
		v: number;
		layers: Record<string, [number, number]>;
		minimap: number;
		drawing: number;
		rotation: number;
		view?: [number, number, number, number];
	} = {
		v: SHARE_STATE_VERSION,
		layers,
		minimap: state.minimap ? 1 : 0,
		drawing: state.drawingEnabled ? 1 : 0,
		rotation: state.rotationEnabled ? 1 : 0,
	};
	if (state.view) {
		const { x, y, zoom, rotation } = state.view;
		payload.view = [round(x, 4), round(y, 4), round(zoom, 3), Math.round(rotation)];
	}
	return `?${PARAM}=${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decode the `?s=` param from a query string (e.g. location.search).
 * Returns null when absent, malformed, or an unrecognized version - callers
 * should then just use their normal defaults. Never throws.
 */
export function decodeShareState(search: string): SharedState | null {
	const raw = new URLSearchParams(search).get(PARAM);
	if (!raw) return null;
	try {
		const payload = JSON.parse(fromBase64Url(raw)) as {
			v?: number;
			layers?: Record<string, [number, number]>;
			minimap?: number;
			drawing?: number;
			rotation?: number;
			view?: [number, number, number, number];
		};

		// Understand v1 and v2; ignore anything else so old/garbled links fail safe to defaults.
		if (payload.v !== 1 && payload.v !== 2) return null;

		const layers: SharedState["layers"] = {};
		for (const [id, tuple] of Object.entries(payload.layers ?? {})) {
			if (!Array.isArray(tuple) || tuple.length < 2) continue;
			const [vis, opPct] = tuple;
			layers[id] = {
				visible: vis === 1,
				opacity: Math.min(1, Math.max(0, opPct / 100)),
			};
		}

		const result: SharedState = {
			layers,
			minimap: payload.minimap === undefined ? undefined : payload.minimap === 1,
			drawing: payload.drawing === undefined ? undefined : payload.drawing === 1,
			rotation: payload.rotation === undefined ? undefined : payload.rotation === 1,
		};

		// v2 only: the saved pan/zoom/rotation.
		const view = payload.view;
		if (Array.isArray(view) && view.length >= 4 && view.every((n) => typeof n === "number" && isFinite(n))) {
			result.view = { x: view[0], y: view[1], zoom: view[2], rotation: view[3] };
		}
		return result;
	} catch {
		return null;
	}
}
