/*
 * Saving: under `npm run dev` on this machine the dev server writes tracks/<slug>/ straight
 * into the repo (vite-tracks.ts, /__editor/save); anywhere else Save downloads a zip whose
 * paths (tracks/<slug>/...) land in place when unzipped at the repo root.
 */

export interface SaveOutcome {
	ok: boolean;
	message: string;
	problems?: string[];
	/** The files were written although the save failed afterwards (tiling). */
	saved?: boolean;
}

/** Whether this page can save straight into the repo (dev server, same machine). */
export async function canDirectSave(): Promise<boolean> {
	try {
		const r = await fetch("/__editor/ping", { cache: "no-store" });
		if (!r.ok) return false;
		const body = (await r.json()) as { canSave?: boolean };
		return body.canSave === true;
	} catch {
		return false; // a deployed site answers with the app's HTML, which isn't JSON
	}
}

/** `create`: a new track, which the server refuses to write over an existing folder. */
export async function saveDirect(slug: string, json: string, create: boolean, photo?: Blob): Promise<SaveOutcome> {
	const image = photo ? await toBase64(photo) : undefined;
	let r: Response;
	try {
		r = await fetch("/__editor/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug, json, image, create }),
		});
	} catch (e) {
		return { ok: false, message: `Couldn't reach the dev server (${(e as Error).message}).` };
	}
	const body = (await r.json().catch(() => ({}))) as {
		error?: string;
		problems?: string[];
		path?: string;
		tiled?: boolean;
		warning?: string;
		saved?: boolean;
	};
	if (!r.ok) {
		return {
			ok: false,
			message: body.error ?? `Save failed (${r.status}).`,
			problems: body.problems,
			saved: body.saved === true,
		};
	}
	const done = `Saved ${body.path ?? `tracks/${slug}/track.json`}${body.tiled ? " and tiled the photo" : ""}.`;
	return { ok: true, message: body.warning ? `${done} ${body.warning}` : done };
}

export async function downloadZip(slug: string, json: string, photo?: Blob): Promise<SaveOutcome> {
	const files: ZipFile[] = [{ name: `tracks/${slug}/track.json`, data: bytes(json) }];
	if (photo) files.push({ name: `tracks/${slug}/image.jpg`, data: new Uint8Array(await photo.arrayBuffer()) });
	const url = URL.createObjectURL(zipStored(files));
	const a = document.createElement("a");
	a.href = url;
	a.download = `${slug}.zip`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
	return { ok: true, message: `Downloaded ${slug}.zip: unzip it at the repo root, then commit.` };
}

async function toBase64(blob: Blob): Promise<string> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result));
		fr.onerror = () => reject(fr.error);
		fr.readAsDataURL(blob);
	});
	return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// ---------------------------------------------------------------- zip (store only)

// The payload is a JPEG and a small JSON: compression gains nothing worth a dependency.
let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

type Bytes = Uint8Array<ArrayBuffer>;
interface ZipFile {
	name: string;
	data: Bytes;
}
const bytes = (text: string): Bytes => new Uint8Array(new TextEncoder().encode(text));

function zipStored(files: ZipFile[]): Blob {
	const now = new Date();
	const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
	const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	const parts: BlobPart[] = [];
	const central: Bytes[] = [];
	let offset = 0;
	for (const f of files) {
		const name = bytes(f.name);
		const crc = crc32(f.data);
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true); // version needed
		local.setUint16(6, 0x0800, true); // UTF-8 names
		local.setUint16(8, 0, true); // stored
		local.setUint16(10, time, true);
		local.setUint16(12, date, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, f.data.length, true);
		local.setUint32(22, f.data.length, true);
		local.setUint16(26, name.length, true);
		parts.push(local.buffer, name, f.data);

		const cd = new DataView(new ArrayBuffer(46));
		cd.setUint32(0, 0x02014b50, true);
		cd.setUint16(4, 20, true);
		cd.setUint16(6, 20, true);
		cd.setUint16(8, 0x0800, true);
		cd.setUint16(10, 0, true);
		cd.setUint16(12, time, true);
		cd.setUint16(14, date, true);
		cd.setUint32(16, crc, true);
		cd.setUint32(20, f.data.length, true);
		cd.setUint32(24, f.data.length, true);
		cd.setUint16(28, name.length, true);
		cd.setUint32(42, offset, true);
		const entry = new Uint8Array(46 + name.length);
		entry.set(new Uint8Array(cd.buffer), 0);
		entry.set(name, 46);
		central.push(entry);
		offset += 30 + name.length + f.data.length;
	}
	const cdSize = central.reduce((n, e) => n + e.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, cdSize, true);
	end.setUint32(16, offset, true);
	return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
