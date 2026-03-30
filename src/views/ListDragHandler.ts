import { Notice } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Ticket } from '../types';
import { generateTicketNote } from '../ticketNote';

export class ListDragHandler {
	private view: BoardView;
	private _scrollArea: HTMLElement | null = null;

	constructor(view: BoardView) {
		this.view = view;
	}

	get scrollArea(): HTMLElement | null {
		return this._scrollArea;
	}

	set scrollArea(el: HTMLElement | null) {
		this._scrollArea = el;
	}

	setupDragDrop(
		scrollArea: HTMLElement,
		dropLineEl: HTMLElement,
		store: ProjectStore,
		projectId: string,
	): void {
		this._scrollArea = scrollArea;

		// Container-level dragover
		scrollArea.addEventListener('dragover', (e) => {
			e.preventDefault();
			const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ticket-id]');
			if (!row) {
				dropLineEl.classList.remove('pf-drop-line-visible');
				this.view.dropTarget = null;
				return;
			}

			const rowId = row.dataset.ticketId!;
			const rowParentId = row.dataset.parentId || null;
			const rowDepth = parseInt(row.dataset.depth ?? '0', 10);
			const isEpicRow = row.dataset.isEpic === 'true';
			const rect = row.getBoundingClientRect();
			const relY = e.clientY - rect.top;
			const pct = relY / rect.height;

			if (this.view.draggedEpicId) {
				if (rowDepth !== 0 || rowId === this.view.draggedEpicId) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					this.view.epicDropBeforeId = undefined;
					return;
				}
				const allTopRows = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-depth="0"]'));
				const idx = allTopRows.indexOf(row);
				if (pct < 0.5) {
					this.view.epicDropBeforeId = rowId;
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible';
					dropLineEl.style.top = row.offsetTop + 'px';
				} else {
					const nextTopRow = allTopRows[idx + 1];
					this.view.epicDropBeforeId = nextTopRow ? nextTopRow.dataset.ticketId! : null;
					const section = row.closest('.pf-epic-section');
					const lastChild = section
						? (Array.from(section.querySelectorAll<HTMLElement>('[data-ticket-id]')).pop() ?? row)
						: row;
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible';
					dropLineEl.style.top = (lastChild.offsetTop + lastChild.offsetHeight) + 'px';
				}
				return;
			}

			if (!this.view.draggedTicketId) return;
			if (rowId === this.view.draggedTicketId) {
				dropLineEl.classList.remove('pf-drop-line-visible');
				this.view.dropTarget = null;
				return;
			}

			scrollArea.querySelectorAll('.pf-drop-active').forEach(el => el.classList.remove('pf-drop-active'));

			if (this.view.draggedTicketType === 'subtask') {
				if (isEpicRow || rowDepth === 0) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					this.view.dropTarget = null;
					if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
					return;
				}
				if (rowDepth === 1) {
					if (pct >= 0.2 && pct <= 0.8) {
						row.classList.add('pf-drop-active');
						this.view.dropTarget = { parentId: rowId, beforeId: null, depth: 2 };
						dropLineEl.classList.remove('pf-drop-line-visible');
					} else {
						dropLineEl.classList.remove('pf-drop-line-visible');
						this.view.dropTarget = null;
						if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
					}
					return;
				}
				const insertBefore = pct < 0.5;
				this.view.dropTarget = {
					parentId: rowParentId,
					beforeId: insertBefore ? rowId : null,
					depth: 2,
				};
				if (!insertBefore) {
					const allRows = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-ticket-id]'));
					const idx = allRows.indexOf(row);
					let nextSiblingId: string | null = null;
					for (let i = idx + 1; i < allRows.length; i++) {
						const nr = allRows[i];
						if ((nr.dataset.parentId || null) === rowParentId && parseInt(nr.dataset.depth ?? '0', 10) === 2) {
							nextSiblingId = nr.dataset.ticketId!;
							break;
						}
					}
					this.view.dropTarget.beforeId = nextSiblingId;
				}
				dropLineEl.className = 'pf-drop-line pf-drop-line-visible pf-drop-line-indented-2';
				dropLineEl.style.top = (insertBefore ? row.offsetTop : row.offsetTop + row.offsetHeight) + 'px';
				return;
			}

			if (isEpicRow) {
				if (pct < 0.3) {
					this.view.dropTarget = { parentId: null, beforeId: rowId, depth: 0 };
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible';
					dropLineEl.style.top = (row.offsetTop) + 'px';
				} else if (pct < 0.7) {
					row.classList.add('pf-drop-active');
					this.view.dropTarget = { parentId: rowId, beforeId: null, depth: 1 };
					dropLineEl.classList.remove('pf-drop-line-visible');
				} else {
					this.view.dropTarget = { parentId: rowId, beforeId: null, depth: 1 };
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible pf-drop-line-indented';
					dropLineEl.style.top = (row.offsetTop + row.offsetHeight) + 'px';
				}
			} else {
				if (rowDepth === 2) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					this.view.dropTarget = null;
					if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
					return;
				}
				const insertBefore = pct < 0.5;
				this.view.dropTarget = {
					parentId: rowParentId,
					beforeId: insertBefore ? rowId : null,
					depth: rowDepth,
				};
				if (!insertBefore) {
					const allRows = Array.from(scrollArea.querySelectorAll<HTMLElement>('[data-ticket-id]'));
					const idx = allRows.indexOf(row);
					let nextSiblingId: string | null = null;
					for (let i = idx + 1; i < allRows.length; i++) {
						const nr = allRows[i];
						if ((nr.dataset.parentId || null) === rowParentId && parseInt(nr.dataset.depth ?? '0', 10) === rowDepth) {
							nextSiblingId = nr.dataset.ticketId!;
							break;
						}
					}
					this.view.dropTarget.beforeId = nextSiblingId;
				}
				const lineTop = insertBefore ? row.offsetTop : (row.offsetTop + row.offsetHeight);
				if (rowDepth === 0) {
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible';
				} else if (rowDepth === 1) {
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible pf-drop-line-indented';
				} else {
					dropLineEl.className = 'pf-drop-line pf-drop-line-visible pf-drop-line-indented-2';
				}
				dropLineEl.style.top = lineTop + 'px';
			}
		});

		scrollArea.addEventListener('dragleave', (e) => {
			if (!scrollArea.contains(e.relatedTarget as Node)) {
				dropLineEl.classList.remove('pf-drop-line-visible');
				scrollArea.querySelectorAll('.pf-drop-active').forEach(el => el.classList.remove('pf-drop-active'));
				this.view.dropTarget = null;
				this.view.epicDropBeforeId = undefined;
			}
		});

		scrollArea.addEventListener('drop', async (e) => {
			e.preventDefault();
			dropLineEl.classList.remove('pf-drop-line-visible');
			scrollArea.querySelectorAll('.pf-drop-active').forEach(el => el.classList.remove('pf-drop-active'));

			if (this.view.draggedEpicId) {
				const draggedId = this.view.draggedEpicId;
				const beforeId = this.view.epicDropBeforeId;
				this.view.draggedEpicId = null;
				this.view.epicDropBeforeId = undefined;
				if (beforeId !== undefined) {
					const draggedEpic = store.getTicket(draggedId);
					if (draggedEpic) {
						await store.reorderTicket(draggedId, null, beforeId);
						this.view.render();
					}
				}
				return;
			}

			if (!this.view.draggedTicketId || !this.view.dropTarget) {
				this.view.draggedTicketId = null;
				this.view.dropTarget = null;
				return;
			}

			const droppedId = this.view.draggedTicketId;
			const target = this.view.dropTarget;
			const draggedTicket = store.getTicket(droppedId);
			this.view.draggedTicketId = null;
			this.view.draggedTicketType = null;
			this.view.dropTarget = null;

			if (!draggedTicket) return;

			const isMultiDrag = this.view.selectedIds.size > 1 && this.view.selectedIds.has(droppedId);
			if (isMultiDrag) {
				const levels = new Set([...this.view.selectedIds].map(id => this.view.getTicketLevel(id)).filter(Boolean));
				if (levels.size > 1) {
					new Notice('Cannot drag tickets of mixed hierarchy levels together.');
					return;
				}
				const multiParentTicket = target.parentId ? store.getTicket(target.parentId) : null;
				const multiParentType = multiParentTicket?.type ?? null;
				if (levels.has('subtask') && !target.parentId) {
					new Notice('Subtasks must be placed under a task, story, or bug.');
					return;
				}
				if (!levels.has('subtask') && multiParentType !== null && multiParentType !== 'epic') {
					new Notice(`Only subtasks can be placed under a ${multiParentType}.`);
					return;
				}
				if (levels.has('epic') && target.parentId) {
					new Notice('Epics cannot be nested under another ticket.');
					return;
				}
				// Sort selected tickets by current order to preserve relative positions
				const idsToMove = [...this.view.selectedIds]
					.map(id => store.getTicket(id))
					.filter((t): t is Ticket => !!t)
					.sort((a, b) => a.order - b.order)
					.map(t => t.id);
				if (!idsToMove.includes(droppedId)) idsToMove.unshift(droppedId);
				// Same beforeId for every insert — preserves relative order at the drop point
				const multiBeforeId = target.beforeId;
				for (const id of idsToMove) {
					const t = store.getTicket(id);
					if (!t) continue;
					const oldPar = t.parentId ?? null;
					const parChanged = oldPar !== target.parentId;
					const oldMovePath = parChanged ? this.view.getTicketFilePath(id) : null;
					await store.reorderTicket(id, target.parentId, multiBeforeId);
					if (parChanged) {
						await generateTicketNote(this.view.plugin, id, oldMovePath ?? undefined);
						if (oldPar) await generateTicketNote(this.view.plugin, oldPar);
						if (target.parentId) await generateTicketNote(this.view.plugin, target.parentId);
					} else {
						await generateTicketNote(this.view.plugin, id);
					}
				}
				this.view.render();
				return;
			}

			const parentTicket = target.parentId ? store.getTicket(target.parentId) : null;
			const parentType = parentTicket?.type ?? null;
			if (draggedTicket.type === 'subtask' && !target.parentId) {
				new Notice('Subtasks must be placed under a task, story, or bug.');
				return;
			}
			if (draggedTicket.type !== 'subtask' && parentType !== null && parentType !== 'epic') {
				new Notice(`Only subtasks can be placed under a ${parentType}.`);
				return;
			}
			if (draggedTicket.type === 'epic' && target.parentId) {
				new Notice('Epics cannot be nested under another ticket.');
				return;
			}

			const oldParentId = draggedTicket.parentId ?? null;
			const parentChanged = oldParentId !== target.parentId;
			const oldPath = parentChanged ? this.view.getTicketFilePath(droppedId) : null;

			await store.reorderTicket(droppedId, target.parentId, target.beforeId);

			this.view.render();
			if (parentChanged) {
				generateTicketNote(this.view.plugin, droppedId, oldPath ?? undefined).catch(() => { /* silent */ });
				if (oldParentId) generateTicketNote(this.view.plugin, oldParentId).catch(() => { /* silent */ });
				if (target.parentId) generateTicketNote(this.view.plugin, target.parentId).catch(() => { /* silent */ });
			} else {
				generateTicketNote(this.view.plugin, droppedId).catch(() => { /* silent */ });
			}
		});
	}

	/** Highlights all selected rows on dragstart; shows multi-drag ghost when > 1 row. */
	highlightMultiDrag(anchorRow: HTMLElement, ticketId: string, e: DragEvent): void {
		const isInSelection = this.view.selectedIds.has(ticketId) && this.view.selectedIds.size > 1;
		if (isInSelection && this._scrollArea) {
			for (const id of this.view.selectedIds) {
				const el = this._scrollArea.querySelector<HTMLElement>(`.pf-tbl-row[data-ticket-id="${id}"]`);
				el?.classList.add('pf-dragging');
			}
			if (e.dataTransfer) {
				const ghost = document.createElement('div');
				ghost.className = 'pf-multi-drag-ghost';
				ghost.textContent = `Moving ${this.view.selectedIds.size} tickets`;
				document.body.appendChild(ghost);
				e.dataTransfer.setDragImage(ghost, 14, 14);
				requestAnimationFrame(() => {
					if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
				});
			}
		} else {
			anchorRow.classList.add('pf-dragging');
		}
	}

	/** Removes pf-dragging from all rows in the scroll area. */
	clearDragging(): void {
		if (this._scrollArea) {
			this._scrollArea.querySelectorAll<HTMLElement>('.pf-tbl-row.pf-dragging').forEach(el => {
				el.classList.remove('pf-dragging');
			});
		}
	}
}
