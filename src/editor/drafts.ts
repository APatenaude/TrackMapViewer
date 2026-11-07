import type { TrackDoc } from "../trackDoc.js";

/*
 * Editor drafts in IndexedDB: autosaved work in progress, one per track (a new track's
 * photo included). They live in this browser only; Save is what puts a track in the repo.
 * Also read by the viewer's ?draft= preview.
 */

export interface Draft {
	/** The track slug, or "new-<time>" for a track that was never saved. */
	id: string;
	doc: TrackDoc;
	/** Deployed track.json content the draft started from (serialized), to tell what changed since. */
	base?: string;
	/** A new track's photo (already re-encoded, see photo.ts). */
	photo?: Blob;
	updated: number;
}

const DB_NAME = "trackmap-editor";
const STORE = "drafts";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const req = fn(db.transaction(STORE, mode).objectStore(STORE));
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

export async function listDrafts(): Promise<Draft[]> {
	const all = await run<Draft[]>("readonly", (s) => s.getAll() as IDBRequest<Draft[]>);
	return all.sort((a, b) => b.updated - a.updated);
}

export function getDraft(id: string): Promise<Draft | undefined> {
	return run<Draft | undefined>("readonly", (s) => s.get(id) as IDBRequest<Draft | undefined>);
}

let persistAsked = false;
export async function putDraft(draft: Draft): Promise<void> {
	// Without persistent storage Safari/Chrome may evict drafts after a while unvisited.
	if (!persistAsked) {
		persistAsked = true;
		navigator.storage?.persist?.().catch(() => undefined);
	}
	await run("readwrite", (s) => s.put(draft));
}

export async function deleteDraft(id: string): Promise<void> {
	await run("readwrite", (s) => s.delete(id));
}
