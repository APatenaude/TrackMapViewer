import type { Lang, LocalizedString } from "./types.js";

/** UI chrome strings. Layer names + title live in config.json instead. */
const MESSAGES: Record<Lang, Record<string, string>> = {
	en: {
		layers: "Options",
		allOn: "All on",
		allOff: "All off",
		resetView: "Reset view",
		share: "Share",
		copyLink: "Copy link",
		close: "Close",
		closePanel: "Close panel",
		layersPanel: "Options",
		openLayersPanel: "Open options",
		minimap: "Minimap",
		drawMode: "Draw on map",
		clearDrawing: "Clear drawing",
		installApp: "Install app",
		installTitle: "Install this app",
		installGeneric:
			"Open your browser menu — or the install icon in the address bar — and choose “Install” or “Add to Home screen”.",
		installTitleIos: "Add to Home Screen",
		installIos1: "Tap the Share button {icon} at the bottom of Safari",
		installIos2: "Scroll down and tap “Add to Home Screen”",
		installIos3: "Tap “Add” in the top-right",
	},
	fr: {
		layers: "Options",
		allOn: "Tout afficher",
		allOff: "Tout masquer",
		resetView: "Réinitialiser la vue",
		share: "Partager",
		copyLink: "Copier le lien",
		close: "Fermer",
		closePanel: "Fermer le panneau",
		layersPanel: "Options",
		openLayersPanel: "Ouvrir les options",
		minimap: "Minicarte",
		drawMode: "Dessiner sur la carte",
		clearDrawing: "Effacer le dessin",
		installApp: "Installer l'application",
		installTitle: "Installer cette application",
		installGeneric:
			"Ouvrez le menu de votre navigateur — ou l'icône d'installation dans la barre d'adresse — et choisissez « Installer » ou « Ajouter à l'écran d'accueil ».",
		installTitleIos: "Sur l'écran d'accueil",
		installIos1: "Touchez le bouton Partager {icon} en bas de Safari",
		installIos2: "Faites défiler et touchez « Sur l'écran d'accueil »",
		installIos3: "Touchez « Ajouter » en haut à droite",
	},
};

let currentLang: Lang = "en";
const listeners: Array<() => void> = [];

export function getLang(): Lang {
	return currentLang;
}

/** Translate a UI chrome key for the active language. */
export function t(key: string): string {
	return MESSAGES[currentLang][key] ?? MESSAGES.en[key] ?? key;
}

/**
 * Resolve a LocalizedString for the active (or given) language.
 * Falls back: requested lang → en → raw string.
 */
export function pick(value: LocalizedString, lang: Lang = currentLang): string {
	if (typeof value === "string") return value;
	return value[lang] ?? value.en ?? Object.values(value)[0] ?? "";
}

export function initI18n(lang: Lang): void {
	currentLang = lang;
	document.documentElement.lang = lang;
}

/** Register a callback run now and on every language change. */
export function registerI18n(fn: () => void): void {
	listeners.push(fn);
	fn();
}

export function setLang(lang: Lang): void {
	if (lang === currentLang) return;
	currentLang = lang;
	document.documentElement.lang = lang;
	for (const fn of listeners) fn();
}

/** Apply translations to static markup tagged with data-i18n / data-i18n-aria. */
export function translateTree(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
		el.textContent = t(el.dataset.i18n!);
	});
	root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
		el.setAttribute("aria-label", t(el.dataset.i18nAria!));
	});
}
