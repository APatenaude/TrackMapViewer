import type { InstallGuide, InstallScenario, Lang, LocalizedString } from "./types.js";

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
		compass: "Reset rotation (hold to lock)",
		compassLocked: "Rotation locked (hold to unlock)",
		drawing: "Drawing",
		rotation: "Rotation",
		install: "Install",
		installApp: "Install app",
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
		compass: "Réinitialiser la rotation (maintenir pour verrouiller)",
		compassLocked: "Rotation verrouillée (maintenir pour déverrouiller)",
		drawing: "Dessin",
		rotation: "Rotation",
		install: "Installer",
		installApp: "Installer l'application",
	},
};

/**
 * Platform-tailored install walkthroughs. Kept structured (title/sub/steps/note)
 * rather than flattened into MESSAGES because steps are lists with inline glyphs.
 * Steps embed {share}/{add}/{install}/{menu} placeholders, replaced in install.ts.
 */
export const INSTALL_GUIDES: Record<Lang, Record<InstallScenario, InstallGuide>> = {
	en: {
		"ios-safari": {
			title: "Add to your Home Screen",
			sub: "In Safari, follow these 3 steps:",
			steps: [
				"Tap the <b>Share</b> button {share} at the bottom of the screen (top-right on iPad).",
				"Scroll to the bottom of the list and tap <b>View More</b> {more}, then tap <b>Add to Home Screen</b> {add}.",
				"Tap <b>Add</b> in the top corner. The app icon appears on your Home Screen.",
			],
		},
		"ios-other": {
			title: "Add to your Home Screen",
			sub: "Follow these 3 steps:",
			steps: [
				"Tap the <b>Share</b> button {share} (near the top-right of the screen).",
				"Scroll to the bottom of the list and tap <b>View More</b> {more}, then tap <b>Add to Home Screen</b> {add}.",
				"Tap <b>Add</b>. The app icon appears on your Home Screen.",
			],
		},
		"android-chromium": {
			title: "Install the app",
			sub: "Follow these steps:",
			steps: [
				"Tap the <b>menu</b> button {menu} (top-right corner).",
				"Tap <b>Add to Home screen</b> {install}.",
				"Tap <b>Install</b> to confirm.",
			],
		},
		"android-samsung": {
			title: "Install the app",
			sub: "In Samsung Browser:",
			steps: [
				"Tap the <b>menu</b> button {menu} ( bottom-right).",
				"Tap {plus} <b>Add page to</b>, then <b>Home screen</b>.",
				"Tap <b>Add</b> to confirm.",
			],
			note: "You may also see a small download icon in the address bar - tapping it installs the app too.",
		},
		"android-firefox": {
			title: "Install the app",
			sub: "In Firefox:",
			steps: [
				"Tap the <b>menu</b> button {menu} (top-right).",
				"Tap <b>··· More</b>.",
				"Tap <b>Add app to Home screen</b>, then confirm.",
			],
		},
		"desktop-chromium": {
			title: "Install the app",
			sub: "Follow these steps:",
			steps: [
				"Look at the right end of the <b>address bar</b> for an install icon {install} (a small screen with a down-arrow).",
				"Click it, then click <b>Install</b>.",
			],
			note: "No icon? Open the <b>menu</b> {menu}, choose <b>Cast, save, and share</b>, then <b>Install…</b>.",
		},
		"macos-safari": {
			title: "Add to your Dock",
			sub: "In Safari on your Mac:",
			steps: [
				"Open the <b>File</b> menu in the top menu bar.",
				"Choose <b>Add to Dock…</b>",
				"Click <b>Add</b>. The app appears in your Dock.",
			],
			note: "Requires macOS Sonoma (14) or newer.",
		},
		"desktop-firefox": {
			title: "Use a different browser to install",
			sub: "Firefox on desktop can't install web apps.",
			steps: [
				"Open this page in <b>Chrome</b>, <b>Microsoft Edge</b>, or <b>Brave</b>.",
				"Then use that browser's install button in the address bar.",
			],
		},
		fallback: {
			title: "Add this app to your device",
			sub: "Look for an install option in your browser:",
			steps: [
				"Open your browser's <b>menu</b> {menu}.",
				"Look for <b>Install app</b> or <b>Add to Home Screen</b>.",
				"Confirm to add it.",
			],
		},
	},
	fr: {
		"ios-safari": {
			title: "Ajouter à l'écran d'accueil",
			sub: "Dans Safari, suivez ces 3 étapes :",
			steps: [
				"Touchez le bouton <b>Partager</b> {share} en bas de l'écran (en haut à droite sur iPad).",
				"Faites défiler jusqu'au bas de la liste et touchez <b>Voir plus</b> {more}, puis touchez <b>Ajouter à l'écran d'accueil</b> {add}.",
				"Touchez <b>Ajouter</b> dans le coin supérieur. L'icône apparaît sur l'écran d'accueil.",
			],
		},
		"ios-other": {
			title: "Ajouter à l'écran d'accueil",
			sub: "Suivez ces 3 étapes :",
			steps: [
				"Touchez le bouton <b>Partager</b> {share} (en haut à droite de l'écran).",
				"Faites défiler jusqu'au bas de la liste et touchez <b>Voir plus</b> {more}, puis touchez <b>Ajouter à l'écran d'accueil</b> {add}.",
				"Touchez <b>Ajouter</b>. L'icône apparaît sur l'écran d'accueil.",
			],
		},
		"android-chromium": {
			title: "Installer l'application",
			sub: "Suivez ces étapes :",
			steps: [
				"Touchez le bouton <b>menu</b> {menu} (coin supérieur droit).",
				"Touchez <b>Ajouter à l'écran d'accueil</b> {install}.",
				"Touchez <b>Installer</b> pour confirmer.",
			],
		},
		"android-samsung": {
			title: "Installer l'application",
			sub: "Dans Samsung Browser :",
			steps: [
				"Touchez le bouton <b>menu</b> {menu} (en bas à droite).",
				"Touchez {plus} <b>Ajouter la page à</b>, puis <b>Écran d'accueil</b>.",
				"Touchez <b>Ajouter</b> pour confirmer.",
			],
			note: "Une petite icône de téléchargement peut aussi apparaître dans la barre d'adresse : l'utiliser installe également l'application.",
		},
		"android-firefox": {
			title: "Installer l'application",
			sub: "Dans Firefox :",
			steps: [
				"Touchez le bouton <b>menu</b> {menu} (en haut à droite).",
				"Touchez <b>··· Plus</b>.",
				"Touchez <b>Ajouter l'application à l'écran d'accueil</b>, puis confirmez.",
			],
		},
		"desktop-chromium": {
			title: "Installer l'application",
			sub: "Suivez ces étapes :",
			steps: [
				"À droite de la <b>barre d'adresse</b>, repérez une icône d'installation {install} (un petit écran avec une flèche vers le bas).",
				"Cliquez dessus, puis cliquez sur <b>Installer</b>.",
			],
			note: "Pas d'icône ? Ouvrez le <b>menu</b> {menu}, choisissez <b>Caster, enregistrer et partager</b>, puis <b>Installer…</b>.",
		},
		"macos-safari": {
			title: "Ajouter au Dock",
			sub: "Dans Safari sur votre Mac :",
			steps: [
				"Ouvrez le menu <b>Fichier</b> dans la barre de menus.",
				"Choisissez <b>Ajouter au Dock…</b>",
				"Cliquez sur <b>Ajouter</b>. L'application apparaît dans votre Dock.",
			],
			note: "Nécessite macOS Sonoma (14) ou une version plus récente.",
		},
		"desktop-firefox": {
			title: "Utilisez un autre navigateur pour installer",
			sub: "Firefox sur ordinateur ne peut pas installer d'applications web.",
			steps: [
				"Ouvrez cette page dans <b>Chrome</b>, <b>Microsoft Edge</b> ou <b>Brave</b>.",
				"Utilisez ensuite le bouton d'installation de ce navigateur dans la barre d'adresse.",
			],
		},
		fallback: {
			title: "Ajouter cette application à votre appareil",
			sub: "Cherchez une option d'installation dans votre navigateur :",
			steps: [
				"Ouvrez le <b>menu</b> {menu} de votre navigateur.",
				"Cherchez <b>Installer l'application</b> ou <b>Ajouter à l'écran d'accueil</b>.",
				"Confirmez pour l'ajouter.",
			],
		},
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
