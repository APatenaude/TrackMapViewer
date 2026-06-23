import { track } from "./analytics.js";
import { getLang, INSTALL_GUIDES, registerI18n, t } from "./i18n.js";
import { detectInstallScenario, isEmbedded, isStandalone } from "./platform.js";
import type { InstallScenario } from "./types.js";

// Chrome/Edge fire `beforeinstallprompt` (not in lib.dom). Minimal shape.
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Glyphs shown inline in the instructions wherever the text names a button/icon.
const SHARE_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v13"/><path d="m7 6 5-5 5 5"/><path d="M7 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1"/></svg>`;
// "Add to Home Screen" glyph (rounded square with a plus).
const ADD_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`;
// Chrome's "install" glyph
const INSTALL_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M14 2.5v9"/><path d="m10.5 8 3.5 3.5 3.5-3.5"/><path d="M12 16v4"/><path d="M9 20h6"/></svg>`;
// Browser "menu" glyph (vertical three-dot kebab).
const MENU_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
// iOS share sheet "View More" glyph (downward arrow in a circle).
const MORE_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/></svg>`;
// Samsung Browser "Add page to" glyph (plus in a circle).
const PLUS_CIRCLE_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`;

// Placeholders used in INSTALL_GUIDES step/note text → their rendered glyph.
const GLYPHS: Record<string, string> = {
	"{share}": SHARE_ICON,
	"{add}": ADD_ICON,
	"{install}": INSTALL_ICON,
	"{menu}": MENU_ICON,
	"{more}": MORE_ICON,
	"{plus}": PLUS_CIRCLE_ICON,
};
const fillGlyphs = (s: string): string => s.replace(/\{share\}|\{add\}|\{install\}|\{menu\}|\{more\}|\{plus\}/g, (m) => GLYPHS[m] ?? "");

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let buttonEl: HTMLButtonElement | null = null;
let modalEl: HTMLElement | null = null;
let modalScenario: InstallScenario = "fallback";

/** What the install button should do: fire the native prompt, hide, or show a platform guide. */
type Strategy = "native" | "hidden" | InstallScenario;

// Resolved fresh on each call - beforeinstallprompt can fire after the button is wired.
function resolveStrategy(): Strategy {
	if (isStandalone()) return "hidden"; // already installed
	if (isEmbedded()) return "hidden"; // VS Code / in-app webview - can't install
	if (deferredPrompt) return "native"; // Chromium desktop + Android: real API
	return detectInstallScenario(); // platform-tailored instructions
}

function refreshButton(): void {
	if (buttonEl) buttonEl.hidden = resolveStrategy() === "hidden";
}

/** Capture the install prompt early - it can fire before config resolves. Call before any awaits. */
export function setupInstallCapture(): void {
	window.addEventListener("beforeinstallprompt", (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
		refreshButton();
	});
	window.addEventListener("appinstalled", () => {
		deferredPrompt = null;
		refreshButton();
	});
}

function closeModal(): void {
	if (modalEl) modalEl.hidden = true;
	buttonEl?.focus();
}

/** Show platform-tailored install instructions; rebuilt each open to reflect the language. */
function openModal(scenario: InstallScenario): void {
	if (!modalEl) {
		const el = document.createElement("div");
		el.id = "install-modal";
		el.className = "modal-scrim";
		el.addEventListener("click", (e) => {
			if (e.target === el) closeModal();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && modalEl && !modalEl.hidden) closeModal();
		});
		document.body.appendChild(el);
		modalEl = el;
	}
	const el = modalEl;
	modalScenario = scenario;
	const guide = INSTALL_GUIDES[getLang()][scenario] ?? INSTALL_GUIDES.en[scenario];
	const steps = guide.steps.map((s) => `<li>${fillGlyphs(s)}</li>`).join("");
	const note = guide.note ? `<p class="install-note">${fillGlyphs(guide.note)}</p>` : "";
	el.innerHTML = `
    <div class="modal-card install-card" role="dialog" aria-modal="true">
      <h2 class="install-title">${guide.title}</h2>
      <p class="install-sub">${guide.sub}</p>
      <ol class="install-steps">${steps}</ol>
      ${note}
      <div class="modal-actions">
        <button class="modal-close">${t("close")}</button>
      </div>
    </div>
  `;
	const closeBtn = el.querySelector<HTMLButtonElement>(".modal-close")!;
	closeBtn.addEventListener("click", closeModal);
	el.hidden = false;
	closeBtn.focus();
}

/** Wire the drawer's install button. Visible only when install is possible. */
export function initInstall(button: HTMLButtonElement): void {
	buttonEl = button;
	refreshButton();

	// Re-render an open modal on language change (its text is built inline, not via translateTree).
	registerI18n(() => {
		if (modalEl && !modalEl.hidden) openModal(modalScenario);
	});

	button.addEventListener("click", async () => {
		track("install_clicked");
		const strategy = resolveStrategy();
		if (strategy === "native" && deferredPrompt) {
			try {
				await deferredPrompt.prompt();
				await deferredPrompt.userChoice;
			} catch {
				// prompt() rejects if called more than once / when not allowed - ignore.
			}
			deferredPrompt = null;
			refreshButton();
		} else if (strategy !== "native" && strategy !== "hidden") {
			openModal(strategy);
		}
	});
}
