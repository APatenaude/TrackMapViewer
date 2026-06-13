export type Lang = "en" | "fr";

/** A string that may be plain (single language) or localized per Lang. */
export type LocalizedString = string | Partial<Record<Lang, string>>;

export interface LayerConfig {
	id: string;
	label: LocalizedString;
	defaultOn: boolean;
	defaultOpacity: number;
}

export interface AnalyticsConfig {
	scriptUrl: string;
	websiteId: string;
}

export interface AppConfig {
	imageWidth: number;
	imageHeight: number;
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
	layers: LayerConfig[];
	analytics?: AnalyticsConfig;
}

export interface LayerState {
	visible: boolean;
	opacity: number;
}

export interface PersistedState {
	view: { x: number; y: number; zoom: number } | null;
	layers: Record<string, LayerState>;
	lang: Lang;
	minimap: boolean;
}
