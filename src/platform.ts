// PWA install detection. Pure functions, no DOM. Prefer definitive signals (the
// beforeinstallprompt event in install.ts) over UA sniffing where possible.

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
