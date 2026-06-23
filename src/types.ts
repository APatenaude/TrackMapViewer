export type Lang = "en" | "fr";

/** A string that may be plain (single language) or localized per Lang. */
export type LocalizedString = string | Partial<Record<Lang, string>>;

/** Platform/browser the install instructions are tailored to (see platform.ts detectInstallScenario). */
export type InstallScenario =
	| "ios-safari"
	| "ios-other"
	| "android-chromium"
	| "android-samsung"
	| "android-firefox"
	| "desktop-chromium"
	| "macos-safari"
	| "desktop-firefox"
	| "fallback";

/** One platform's install walkthrough. Steps may embed {share}/{add}/{install}/{menu} glyph placeholders. */
export interface InstallGuide {
	title: string;
	sub: string;
	steps: string[];
	note?: string;
}

export interface LayerConfig {
	id: string;
	label: LocalizedString;
	defaultOn: boolean;
	defaultOpacity: number;
	/** Keep this layer's markers screen-upright under rotation (billboarding; one <g> per marker). */
	upright?: boolean;
}

export interface AnalyticsConfig {
	scriptUrl: string;
	websiteId: string;
}

export interface AppConfig {
	imageWidth: number;
	imageHeight: number; // What the install button should do now; recomputed on demand for late-firing prompts.
	/** Image pixels per SVG user unit. Maps the SVG coordinate space onto the
	 *  background pixel space. Defaults to 1 when omitted. */
	svgScale?: number;
	/** Path to the vector overlay SVG. Defaults to '/track.svg'. */
	svgPath?: string;
	/** Path to the DZI tile source. Defaults to '/tiles/track.dzi'. */
	tileSource?: string;
	title: LocalizedString;
	/** Track name appended to the tab title, e.g. "Track Map - Tremblant". */
	trackName?: string;
	/** Bearing of true north in the image (deg clockwise from image-up). Aims the compass needle only. */
	northOffset?: number;
	layers: LayerConfig[];
	analytics?: AnalyticsConfig;
}

export interface LayerState {
	visible: boolean;
	opacity: number;
}

export interface PersistedState {
	/** Pan/zoom/rotation. In-memory only (feeds share links), never persisted - see state.ts. */
	view: { x: number; y: number; zoom: number; rotation: number } | null;
	layers: Record<string, LayerState>;
	lang: Lang;
	minimap: boolean;
	/** Whether the draw tool / its FAB is available (Options checkbox). */
	drawingEnabled: boolean;
	/** Whether map rotation / the compass FAB is available (Options checkbox). */
	rotationEnabled: boolean;
}
