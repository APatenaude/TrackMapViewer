// PWA install detection. Pure functions, no DOM. Prefer definitive signals (the
// beforeinstallprompt event in install.ts) over UA sniffing where possible.

import type { InstallScenario } from "./types.js";

const ua = navigator.userAgent;

/** Already running as an installed PWA (standalone display, or iOS home-screen). */
export function isStandalone(): boolean {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * Inside an embedded webview / iframe (in-app browser) where install is impossible.
 * Three signals: nested frame, ancestor origins, or an Electron UA.
 */
export function isEmbedded(): boolean {
	try {
		if (window.self !== window.top) return true;
	} catch {
		// Cross-origin frame access throws → we're embedded.
		return true;
	}
	if (location.ancestorOrigins && location.ancestorOrigins.length > 0) return true;
	return /electron/i.test(ua);
}

/** iOS or iPadOS device (iPadOS 13+ reports a desktop UA but is a touch Mac). */
export function isIos(): boolean {
	return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Real Safari on iOS - the only browser there that can "Add to Home Screen".
 * Excludes WKWebView wrappers (CriOS/FxiOS/EdgiOS/…) that can't reliably install.
 */
export function isIosSafari(): boolean {
	return (
		isIos() &&
		// `navigator.standalone` exists only in real Mobile Safari, not WKWebView in-app
		// browsers that leak a "Safari" token - the reliable discriminator.
		"standalone" in navigator &&
		/safari/i.test(ua) &&
		!/crios|fxios|edgios|opios|mercury/i.test(ua)
	);
}

/**
 * Whether the drawer's bottom gap should add env(safe-area-inset-bottom) to clear the OS
 * bottom strip. Opt-in, because the inset is only right in some contexts:
 *  - iOS Safari in browser mode: yes (translucent URL bar + home indicator).
 *  - iOS standalone PWA: no - it reports the home-indicator inset but it looks too big.
 *  - Android (Chrome/Edge/Samsung/...): yes (gesture nav bar), EXCEPT
 *  - Firefox Android: no - it over-reports, folding its own toolbar into the inset.
 */
export function usesBottomSafeArea(): boolean {
	if (isIos()) return isIosSafari() && !isStandalone();
	if (/android/i.test(ua)) return !/firefox/i.test(ua);
	return false;
}

/**
 * Pick the install walkthrough that matches this browser. Only consulted when the
 * native prompt is unavailable (see install.ts) - it never overrides beforeinstallprompt.
 */
export function detectInstallScenario(): InstallScenario {
	if (isIos()) return isIosSafari() ? "ios-safari" : "ios-other";

	if (/android/i.test(ua)) {
		if (/samsungbrowser/i.test(ua)) return "android-samsung";
		if (/firefox|fxios/i.test(ua)) return "android-firefox";
		return "android-chromium"; // Chrome, Edge, Brave, Opera...
	}

	// Desktop
	if (/firefox/i.test(ua)) return "desktop-firefox";
	if (/macintosh/i.test(ua) && /safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return "macos-safari";
	if (/chrome|chromium|edg|opr/i.test(ua)) return "desktop-chromium";
	return "fallback";
}
