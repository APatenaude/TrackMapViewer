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

/** A lap-replay speed control point: relative speed at a path position. */
export interface ReplaySpeedPoint {
	/** Path-normalized position in [0,1] (0 = start of the path `d`). */
	u: number;
	/** Relative speed factor (> 0); bigger = faster. */
	speed: number;
}

export interface ReplayConfig {
	/** Path-normalized position [0,1] where the lap starts (start/finish line). */
	startOffset?: number;
	/** Travel the loop in the opposite direction to the path `d`. */
	reverse?: boolean;
	/** Manual speed control points (interpolated); omit to use the auto curvature profile. */
	speedPoints?: ReplaySpeedPoint[];
	/** Pan/zoom the view to follow the car during replay (default true). */
	follow?: boolean;
	/** Zoom the view to this OSD viewport zoom when replay starts (bigger = closer). Default 5. */
	initialZoom?: number;
	/** Deprecated alias for initialZoom. */
	followZoom?: number;
	/** Follow-cam smoothing 0..1 (0 = locked to the car, higher = smoother but laggier). Default 0.4. */
	followSmoothing?: number;
	/** Rotate the view so the car's direction of travel points up (chase cam). Default false. */
	followOrient?: boolean;
	/** Orient-rotation smoothing 0..1 (higher = smoother/less jerky turns). Default 0.7. */
	orientSmoothing?: number;
	/** Shift the view ahead of the car (0 = centred, ~0.3 = car near the back). Default 0.25. */
	lookAhead?: number;
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
	/** Lap-replay tuning (start point, direction, manual speed profile). */
	replay?: ReplayConfig;
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
}
