import type { AnalyticsConfig, AppConfig } from "./types.js";

declare global {
	interface Window {
		umami?: {
			track: (event: string, data?: Record<string, unknown>) => void;
		};
	}
}

/**
 * Optional private analytics override: the public image ships no `analytics`, so the
 * owner's deploy mounts a small `/analytics.json` ({ scriptUrl, websiteId }) to enable
 * Umami without committing their details. Returns null (stays off) if absent, non-JSON
 * (SPA fallback), malformed, or offline. Never throws.
 */
export async function loadAnalyticsOverride(): Promise<AnalyticsConfig | null> {
	try {
		const res = await fetch("/analytics.json");
		if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
		const data = (await res.json()) as Partial<AnalyticsConfig>;
		if (typeof data.scriptUrl === "string" && typeof data.websiteId === "string") {
			return { scriptUrl: data.scriptUrl, websiteId: data.websiteId };
		}
		return null;
	} catch {
		return null;
	}
}

/** Inject the Umami tracker if `cfg.analytics` is set; no-op otherwise (fully opt-in). */
export function initAnalytics(cfg: AppConfig): void {
	const a = cfg.analytics;
	if (!a) return;

	const script = document.createElement("script");
	script.defer = true;
	script.src = a.scriptUrl;
	script.setAttribute("data-website-id", a.websiteId);
	document.head.appendChild(script);
}

/** Record a custom event. No-ops if the tracker isn't loaded - safe to call unconditionally. */
export function track(event: string, data?: Record<string, unknown>): void {
	window.umami?.track?.(event, data);
}
