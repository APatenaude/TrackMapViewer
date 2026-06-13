import { track } from "./analytics.js";
import { registerI18n, t } from "./i18n.js";
import { isEmbedded, isIosSafari, isStandalone } from "./platform.js";

// Chrome/Edge fire `beforeinstallprompt` (not in lib.dom). Minimal shape.
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// iOS "Share" glyph (box with an up arrow) shown inline in the instructions.
const SHARE_ICON = `<svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v13"/><path d="m7 6 5-5 5 5"/><path d="M7 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1"/></svg>`;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let buttonEl: HTMLButtonElement | null = null;
let modalEl: HTMLElement | null = null;
let modalVariant: "ios-safari" | "generic" = "generic";

// What the install button should do right now. Recomputed on demand so a
// late-firing prompt is honored.
type Strategy = "native" | "ios-safari" | "generic" | "hidden";

function resolveStrategy(): Strategy {
	if (isStandalone()) return "hidden"; // already installed
	if (isEmbedded()) return "hidden"; // VS Code / in-app webview — can't install
	if (deferredPrompt) return "native"; // Chromium desktop + Android: real API
	if (isIosSafari()) return "ios-safari"; // tailored Add-to-Home-Screen steps
	return "generic"; // Firefox, iOS non-Safari, etc.: browser-menu instructions
}

function refreshButton(): void {
	if (buttonEl) buttonEl.hidden = resolveStrategy() === "hidden";
}

/**
 * Capture the install prompt as early as possible — it can fire before the rest
 * of bootstrap (config fetch) resolves. Call before any awaits in main().
 */
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

/** Build (once) and show install instructions tailored to the platform. Content
 *  is rebuilt each open so it reflects the active language. */
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
           <li>${t("installIos2")}</li>
           <li>${t("installIos3")}</li>
         </ol>`
		:	`<h2 class="install-title">${t("installTitle")}</h2>
         <p class="install-generic">${t("installGeneric")}</p>`;
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

	// Re-render an open instructions modal when the language changes (its text is
	// built inline, so translateTree doesn't cover it). No-op until first opened.
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
				// prompt() rejects if called more than once / when not allowed — ignore.
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
