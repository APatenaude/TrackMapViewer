import type { TrackDoc } from "../trackDoc.js";
import type { PathRef } from "./ops.js";

export type Selection =
	| { type: "node"; path: PathRef; node: string }
	| { type: "line"; line: string }
	| { type: "zone"; zone: string }
	| { type: "marker"; marker: string }
	| null;

/** doc: committed change; preview: live drag state; selection / line: only what's highlighted. */
export type ChangeKind = "doc" | "preview" | "selection" | "line";

const MAX_UNDO = 150;

/**
 * The document being edited, its undo history, the selection and the active line.
 * Docs are treated as immutable (see ops.ts); dev builds freeze them to catch a stray mutation.
 */
export class EditorStore {
	private committed: TrackDoc;
	private previewDoc: TrackDoc | null = null;
	private undoStack: TrackDoc[] = [];
	private redoStack: TrackDoc[] = [];
	private listeners = new Set<(kind: ChangeKind) => void>();
	selection: Selection = null;
	activeLine: string | undefined;
	/** Bumped on every committed change (drafts and "unsaved" state key off it). */
	revision = 0;

	constructor(doc: TrackDoc) {
		this.committed = freeze(doc);
		this.activeLine = doc.lines[0]?.id;
	}

	/** What to draw: the live drag preview if any, else the committed doc. */
	get doc(): TrackDoc {
		return this.previewDoc ?? this.committed;
	}

	get base(): TrackDoc {
		return this.committed;
	}

	subscribe(fn: (kind: ChangeKind) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(kind: ChangeKind): void {
		for (const fn of this.listeners) fn(kind);
	}

	/** One undo step. A no-op edit (same doc back) records nothing. */
	commit(next: TrackDoc): void {
		this.previewDoc = null;
		if (next === this.committed) {
			this.emit("preview");
			return;
		}
		this.undoStack.push(this.committed);
		if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
		this.redoStack = [];
		this.committed = freeze(next);
		this.revision++;
		this.fixSelection();
		this.emit("doc");
	}

	/** Show an uncommitted state (during a drag); commit() or cancelPreview() ends it. */
	preview(next: TrackDoc): void {
		this.previewDoc = next;
		this.emit("preview");
	}

	cancelPreview(): void {
		if (!this.previewDoc) return;
		this.previewDoc = null;
		this.emit("preview");
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(): void {
		const prev = this.undoStack.pop();
		if (!prev) return;
		this.previewDoc = null;
		this.redoStack.push(this.committed);
		this.committed = prev;
		this.revision++;
		this.fixSelection();
		this.emit("doc");
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (!next) return;
		this.previewDoc = null;
		this.undoStack.push(this.committed);
		this.committed = next;
		this.revision++;
		this.fixSelection();
		this.emit("doc");
	}

	select(sel: Selection): void {
		this.selection = sel;
		if (sel?.type === "line") this.activeLine = sel.line;
		if (sel?.type === "node" && sel.path.kind === "line") this.activeLine = sel.path.id;
		this.emit("selection");
	}

	setActiveLine(id: string | undefined): void {
		this.activeLine = id;
		if (this.selection?.type === "node" && this.selection.path.kind === "line" && this.selection.path.id !== id) {
			this.selection = null;
		}
		this.emit("line");
	}

	/** After undo/redo or a delete, drop a selection whose item no longer exists. */
	private fixSelection(): void {
		const doc = this.committed;
		if (!doc.lines.some((l) => l.id === this.activeLine)) this.activeLine = doc.lines[0]?.id;
		const s = this.selection;
		if (!s) return;
		const exists =
			(s.type === "line" && doc.lines.some((l) => l.id === s.line)) ||
			(s.type === "zone" && doc.zones.some((z) => z.id === s.zone)) ||
			(s.type === "marker" && doc.markers.some((m) => m.id === s.marker)) ||
			(s.type === "node" &&
				(s.path.kind === "line"
					? doc.lines.find((l) => l.id === s.path.id)?.nodes.some((n) => n.id === s.node)
					: doc.zones.some((z) => z.id === s.path.id && z.kind === "passing" && z.nodes.some((n) => n.id === s.node))));
		if (!exists) this.selection = null;
	}
}

function freeze<T>(value: T): T {
	if (!import.meta.env.DEV || value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const v of Object.values(value as Record<string, unknown>)) freeze(v);
	return value;
}
