import type { AppConfig } from "./types.js";

declare global {
	interface Window {
		umami?: {
			track: (event: string, data?: Record<string, unknown>) => void;
		};
	}
}

/**
 * Inject the Umami tracker script if analytics is configured.
 * No-op when `cfg.analytics` is absent (e.g. local dev), so analytics is
 * fully opt-in and the app never depends on it.
 */
export function initAnalytics(cfg: AppConfig): void {
	const a = cfg.analytics;
	if (!a) return;

	const script = document.createElement("script");
	script.defer = true;
	script.src = a.scriptUrl;
	script.setAttribute("data-website-id", a.websiteId);
	document.head.appendChild(script);
}

/**
 * Record a custom event. Safe to call unconditionally: if the Umami tracker
 * is unavailable (analytics disabled, offline, blocked, or not yet loaded)
 * this silently no-ops, so callers never need their own guards.
 */
export function track(event: string, data?: Record<string, unknown>): void {
	window.umami?.track?.(event, data);
}
