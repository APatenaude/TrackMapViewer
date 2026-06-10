import type { AppConfig, PersistedState } from "./types.js";

/* ──────────────────────────────────────────────────────────────────────────
 * Shareable state wire format (the `?s=` query param)
 *
 * ⚠️ COMPATIBILITY CONTRACT — READ BEFORE CHANGING ⚠️
 * The `?s=` payload is a PUBLIC, PERSISTED, SHAREABLE wire format: links that
 * people have already copied/QR-saved encode whatever shape this file produced
 * at the time. Those old links will be opened in the future.
 *
 * Therefore:
 *   • ANY change to the payload shape or the meaning of a field MUST bump
 *     SHARE_STATE_VERSION.
 *   • decodeShareState() MUST keep understanding every version it ever emitted
 *     (add a branch per old version), OR — at minimum — safely IGNORE payloads
 *     whose version it doesn't recognize (current behavior) so old/garbled links
 *     fall back to defaults instead of applying wrong settings or throwing.
 *   • Never silently repurpose a field number/key. Add new fields; don't reuse.
 *
 * Payload (v1): { v: 1, layers: { [id]: [visible01, opacityPct] }, minimap: 0|1 }
 *   - visible01:  0 or 1
 *   - opacityPct: integer 0–100
 *   - minimap:    0 or 1
 * Encoded as base64url of the JSON.
 * ────────────────────────────────────────────────────────────────────────── */

export const SHARE_STATE_VERSION = 1;

const PARAM = "s";

/** Decoded, normalized share state. All fields optional — apply what's present. */
export interface SharedState {
	layers: Record<string, { visible: boolean; opacity: number }>;
	minimap?: boolean;
}

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
	const payload = { v: SHARE_STATE_VERSION, layers, minimap: state.minimap ? 1 : 0 };
	return `?${PARAM}=${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decode the `?s=` param from a query string (e.g. location.search).
 * Returns null when absent, malformed, or an unrecognized version — callers
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
		};

		// Unknown/old versions we can't interpret → ignore (fail safe to defaults).
		if (payload.v !== SHARE_STATE_VERSION) return null;

		const layers: SharedState["layers"] = {};
		for (const [id, tuple] of Object.entries(payload.layers ?? {})) {
			if (!Array.isArray(tuple) || tuple.length < 2) continue;
			const [vis, opPct] = tuple;
			layers[id] = {
				visible: vis === 1,
				opacity: Math.min(1, Math.max(0, opPct / 100)),
			};
		}
		return { layers, minimap: payload.minimap === undefined ? undefined : payload.minimap === 1 };
	} catch {
		return null;
	}
}
