// Platform / browser detection for deciding whether (and how) the app can be
// installed as a PWA. Pure functions, no DOM mutation. Each is documented by
// the signal it relies on; prefer definitive signals (the beforeinstallprompt
// event, lived in install.ts) over UA sniffing wherever possible.

const ua = navigator.userAgent;

/** Already running as an installed PWA (standalone display, or iOS home-screen). */
export function isStandalone(): boolean {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * Inside an embedded webview / iframe — e.g. an in-app browser
 * where PWA install is impossible and `beforeinstallprompt`
 * never fires. Three independent signals so it holds regardless of frame
 * structure: nested frame, ancestor origins, or an Electron user agent.
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
 * Real Safari on iOS — the one browser there that can "Add to Home Screen".
 * Excludes the WebKit-wrapped third-party browsers (Chrome=CriOS, Firefox=FxiOS,
 * Edge=EdgiOS, Opera=OPiOS, …) which all report an Apple vendor but can't
 * reliably install.
 */
export function isIosSafari(): boolean {
	return (
		isIos() &&
		// `navigator.standalone` exists (as a boolean) only in real Mobile Safari;
		// it's absent in WKWebView in-app browsers (Line, etc.) that otherwise leak
		// a "Safari" token. This is the reliable discriminator.
		"standalone" in navigator &&
		/safari/i.test(ua) &&
		!/crios|fxios|edgios|opios|mercury/i.test(ua)
	);
}
