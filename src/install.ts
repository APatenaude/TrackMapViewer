import { track } from "./analytics.js";
import { registerI18n, t } from "./i18n.js";
import { isEmbedded, isIosSafari, isStandalone } from "./platform.js";

// Chrome/Edge fire `beforeinstallprompt` (not in lib.dom). Minimal shape.
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Glyphs shown inline in the instructions wherever the text names a button/icon.
const SHARE_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v13"/><path d="m7 6 5-5 5 5"/><path d="M7 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1"/></svg>`;
// "Add to Home Screen" glyph (rounded square with a plus).
const ADD_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`;
// Browser "install" glyph (down arrow into a tray).
const INSTALL_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>`;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let buttonEl: HTMLButtonElement | null = null;
let modalEl: HTMLElement | null = null;
let modalVariant: "ios-safari" | "generic" = "generic";

// What the install button should do now; recomputed on demand for late-firing prompts.
type Strategy = "native" | "ios-safari" | "generic" | "hidden";

function resolveStrategy(): Strategy {
	if (isStandalone()) return "hidden"; // already installed
	if (isEmbedded()) return "hidden"; // VS Code / in-app webview - can't install
	if (deferredPrompt) return "native"; // Chromium desktop + Android: real API
	if (isIosSafari()) return "ios-safari"; // tailored Add-to-Home-Screen steps
	return "generic"; // Firefox, iOS non-Safari, etc.: browser-menu instructions
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

/** Show platform-tailored install instructions; rebuilt each open to reflect the language. */
function openModal(variant: "ios-safari" | "generic"): void {
	if (!modalEl) {
		const el = document.createElement("div");
		el.id = "install-modal";
		el.className = "modal-scrim";
		el.addEventListener("click", (e) => {
			if (e.target === el) el.hidden = true;
		});
		document.body.appendChild(el);
		modalEl = el;
	}
	const el = modalEl;
	modalVariant = variant;
	const body =
		variant === "ios-safari" ?
			`<h2 class="install-title">${t("installTitleIos")}</h2>
         <ol class="install-steps">
           <li>${t("installIos1").replace("{icon}", SHARE_ICON)}</li>
           <li>${t("installIos2").replace("{icon}", ADD_ICON)}</li>
           <li>${t("installIos3")}</li>
         </ol>`
		:	`<h2 class="install-title">${t("installTitle")}</h2>
         <p class="install-generic">${t("installGeneric").replace("{icon}", INSTALL_ICON)}</p>`;
	el.innerHTML = `
    <div class="modal-card install-card" role="dialog" aria-modal="true">
      ${body}
      <div class="modal-actions">
        <button class="modal-close">${t("close")}</button>
      </div>
    </div>
  `;
	el.querySelector(".modal-close")!.addEventListener("click", () => (el.hidden = true));
	el.hidden = false;
}

/** Wire the drawer's install button. Visible only when install is possible. */
export function initInstall(button: HTMLButtonElement): void {
	buttonEl = button;
	refreshButton();

	// Re-render an open modal on language change (its text is built inline, not via translateTree).
	registerI18n(() => {
		if (modalEl && !modalEl.hidden) openModal(modalVariant);
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
		} else if (strategy === "ios-safari") {
			openModal("ios-safari");
		} else if (strategy === "generic") {
			openModal("generic");
		}
	});
}
