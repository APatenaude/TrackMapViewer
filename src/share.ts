import QRCode from "qrcode";
import { track } from "./analytics.js";

let modalEl: HTMLElement | null = null;
let shareUrl = "";

export function initShare(): void {
	modalEl = document.createElement("div");
	modalEl.id = "share-modal";
	modalEl.className = "modal-scrim";
	modalEl.hidden = true;
	modalEl.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" data-i18n-aria="share">
      <canvas id="qr-canvas"></canvas>
      <p class="share-url"></p>
      <div class="modal-actions">
        <button class="copy-btn" data-i18n="copyLink"></button>
        <button class="modal-close" data-i18n="close"></button>
      </div>
    </div>
  `;

	modalEl.querySelector(".modal-close")!.addEventListener("click", closeShareModal);
	modalEl.addEventListener("click", (e) => {
		if (e.target === modalEl) closeShareModal();
	});
	modalEl.querySelector(".copy-btn")!.addEventListener("click", () => {
		navigator.clipboard.writeText(shareUrl || window.location.href).catch(() => undefined);
		track("link_copied");
	});

	document.body.appendChild(modalEl);
}

/** Show the share modal for the given URL (encodes the current view's settings). */
export async function openShareModal(url: string = window.location.href): Promise<void> {
	if (!modalEl) return;
	shareUrl = url;
	const canvas = modalEl.querySelector("#qr-canvas") as HTMLCanvasElement;
	const urlEl = modalEl.querySelector(".share-url") as HTMLElement;

	await QRCode.toCanvas(canvas, url, { width: 512, margin: 1 });
	urlEl.textContent = url;
	modalEl.hidden = false;
	track("share_opened");
}

function closeShareModal(): void {
	if (modalEl) modalEl.hidden = true;
}
