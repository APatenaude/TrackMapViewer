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
	/** SVG group ids this one toggle controls together. Defaults to [id]; set to merge layers. */
	ids?: string[];
	/** Subset of member ids to billboard (when only some merged groups are markers). */
	uprightIds?: string[];
}

export interface AnalyticsConfig {
	scriptUrl: string;
	websiteId: string;
}

/** A lap-replay speed control point (built from a line's nodes). Never shown in the UI. */
export interface ReplaySpeedPoint {
	/** Position along the line in [0,1], in travel order from the lap start. */
	u: number;
	/** Speed in km/h; between points the car accelerates/brakes at a constant rate. */
	kmh: number;
}

/** App-wide settings (public/config.json). Everything about a track lives in its track.json. */
export interface AppConfig {
	title: LocalizedString;
	/** Layer toggles; ids are the overlay group ids (see trackRender.ts LAYER_GROUP_IDS). */
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
	/** Whether the lap-replay tool / its FAB is available (Options checkbox). */
	replayEnabled: boolean;
	/** Selected racing line per track (slug -> line id). */
	lines: Record<string, string>;
	/** Track opened last: the bare URL (and the installed app's start page) reopens it. */
	lastTrack?: string;
}
