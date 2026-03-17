import { Menu, Notice } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Ticket } from '../types';
import { TICKET_STATUS_LABELS } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';

export class ListPanelView {
	private view: BoardView;
	private _scrollArea: HTMLElement | null = null;

	constructor(view: BoardView) {
		this.view = view;
	}

	render(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
	): void {
		const scrollArea = container.createEl('div', { cls: 'pf-epics-list pf-tbl-container' });
		this._scrollArea = scrollArea;
		const epicsCols = [
			{ key: 'name',     label: 'Name',     cssVar: '--pf-col-name',     default: 320 },
			{ key: 'priority', label: 'Priority', cssVar: '--pf-col-priority', default: 100 },
			{ key: 'status',   label: 'Status',   cssVar: '--pf-col-status',   default: 110 },
			{ key: 'points',   label: 'Points',   cssVar: '--pf-col-extra',    default: 80 },
		];
		const savedListWidths = store.getColWidths('list');
		for (const col of epicsCols) {
			scrollArea.style.setProperty(col.cssVar, `${savedListWidths[col.key] ?? col.default}px`);
		}

		const epics = store.getEpics(projectId);
		const rogueTickets = store.getUnparentedTickets(projectId);

		if (epics.length === 0 && rogueTickets.length === 0) {
			this.view.renderEmpty(scrollArea, 'No tickets yet.', 'Create a ticket to get started.', () =>
				new TicketModal(this.view.app, this.view.plugin, { projectId, sprintId: null }, () => this.view.render()).open()
			);
			return;
		}

		const filteredTop = [...epics, ...rogueTickets]
			.filter(t => this.view.filterType === 'all' || t.type === this.view.filterType || t.type === 'epic')
			.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority)
			.filter(t => this.view.filterStatus === 'all' || t.status === this.view.filterStatus || t.type === 'epic');
		const topLevel = this.view.sortOrder === 'manual'
			? filteredTop.sort((a, b) => a.order - b.order)
			: this.view.applySort(filteredTop, this.view.sortOrder);

		const orderedIds: string[] = [];
		for (const item of topLevel) {
			orderedIds.push(item.id);
			if (item.type === 'epic') {
				const children = store.getChildTickets(item.id);
				if (!this.view.collapsedSections.has(item.id)) {
					for (const child of children) {
						orderedIds.push(child.id);
						if (!this.view.collapsedSections.has(child.id)) {
							for (const sub of store.getChildTickets(child.id)) {
								orderedIds.push(sub.id);
							}
						}
					}
				}
			}
		}

		for (const id of [...this.view.selectedIds]) {
			if (!orderedIds.includes(id)) this.view.selectedIds.delete(id);
		}

		if (this.view.selectedIds.size > 0) scrollArea.addClass('pf-has-selection');

		this.view.renderTableHeader(scrollArea, epicsCols, (key, width) => {
			const current = store.getColWidths('list');
			store.setColWidths('list', { ...current, [key]: width });
		});

		const dropLineEl = scrollArea.createEl('div', { cls: 'pf-drop-line' });

		for (const item of topLevel) {
			if (item.type === 'epic') {
				this.renderEpicSection(scrollArea, store, projectId, item, orderedIds);
			} else {
				this.renderRogueRow(scrollArea, store, projectId, item, epics, orderedIds);
			}
		}

		// Selection action bar
		if (this.view.selectedIds.size > 0) {
			const levels = new Set([...this.view.selectedIds].map(id => this.view.getTicketLevel(id)).filter(Boolean));
			const dragAllowed = levels.size === 1;
			const bar = scrollArea.createEl('div', { cls: 'pf-selection-bar' });
			bar.createEl('span', { cls: 'pf-selection-bar-count', text: `${this.view.selectedIds.size} selected` });
			if (!dragAllowed) {
				bar.createEl('span', { cls: 'pf-selection-bar-locked', text: 'Drag locked: mixed hierarchy' });
			}
			const deleteBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Delete selected' });
			deleteBtn.addEventListener('click', async () => {
				const ids = [...this.view.selectedIds];
				const totalDescendants = ids.reduce((n, id) => n + store.getDescendantIds(id).length, 0);
				const msg = totalDescendants > 0
					? `Delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''} and ${totalDescendants} descendant${totalDescendants !== 1 ? 's' : ''}? This cannot be undone.`
					: `Delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''}? This cannot be undone.`;
				new ConfirmModal(this.view.app, msg, async () => {
					for (const id of ids) {
						await deleteTicketNote(this.view.plugin, id);
						await store.deleteTicket(id);
					}
					this.view.selectedIds.clear();
					this.view.lastSelectedId = null;
					this.view.render();
				}).open();
			});
			const clearBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Clear' });
			clearBtn.addEventListener('click', () => {
				this.view.selectedIds.clear();
				this.view.lastSelectedId = null;
				this.view.render();
			});
		}

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

	private renderEpicSection(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		epic: Ticket,
		orderedIds: string[],
	): void {
		const section = container.createEl('div', { cls: 'pf-epic-section' });
		const isCollapsed = this.view.collapsedSections.has(epic.id);
		const children = store.getChildTickets(epic.id);
		const doneChildren = children.filter(c => c.status === 'done').length;

		const headerEl = section.createEl('div', { cls: `pf-tbl-row pf-tbl-row-epic pf-priority-border-${epic.priority} pf-draggable-row` });
		headerEl.draggable = false;
		headerEl.dataset.ticketId = epic.id;
		headerEl.dataset.parentId = '';
		headerEl.dataset.depth = '0';
		headerEl.dataset.isEpic = 'true';

		const epicDragHandle = headerEl.createEl('div', { cls: 'pf-drag-handle', text: '⠿' });
		epicDragHandle.addEventListener('mousedown', () => { headerEl.draggable = true; });
		headerEl.addEventListener('dragend', () => { headerEl.draggable = false; });

		this.view.addRowCheckbox(headerEl, epic.id, container, orderedIds);

		const nameCell = headerEl.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' });
		const nameInner = nameCell.createEl('div', { cls: 'pf-tbl-name-inner' });
		const toggleEl = nameInner.createEl('span', {
			cls: `pf-epic-toggle${isCollapsed ? '' : ' pf-epic-toggle-open'}`,
			text: isCollapsed ? '▸' : '▾',
		});
		toggleEl.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.view.collapsedSections.has(epic.id)) {
				this.view.collapsedSections.delete(epic.id);
			} else {
				this.view.collapsedSections.add(epic.id);
			}
			this.view.render();
		});
		nameInner.createEl('span', { cls: 'pf-type-icon pf-type-icon-epic', text: this.view.TYPE_ICONS['epic'] });
		nameInner.createEl('span', { cls: 'pf-tbl-title pf-tbl-title-epic', text: epic.title });

		headerEl.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${epic.priority}`, text: epic.priority });

		headerEl.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-status-col-${epic.status.replace(/-/g, '')}`, text: TICKET_STATUS_LABELS[epic.status] });

		const extraCell = headerEl.createEl('div', { cls: 'pf-tbl-cell' });
		if (children.length > 0) {
			extraCell.createEl('span', { cls: 'pf-epic-progress', text: `${doneChildren}/${children.length}` });
		}

		const actionsCell = headerEl.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-actions' });
		const addChildBtn = actionsCell.createEl('button', { cls: 'pf-btn pf-btn-sm pf-epic-add-child', text: '+ Task' });
		addChildBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new TicketModal(this.view.app, this.view.plugin, {
				projectId,
				sprintId: null,
				parentId: epic.id,
				defaultType: 'task',
			}, () => this.view.render()).open();
		});

		headerEl.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			this.view.draggedEpicId = epic.id;
			this.view.draggedTicketId = null;
			headerEl.addClass('pf-dragging');
		});
		headerEl.addEventListener('dragend', () => {
			this.view.draggedEpicId = null;
			headerEl.draggable = false;
			headerEl.removeClass('pf-dragging');
		});

		nameCell.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'BUTTON') return;
			if ((e.target as HTMLElement).classList.contains('pf-epic-toggle')) return;
			new TicketModal(this.view.app, this.view.plugin, { ticket: epic, sprintId: null }, () => this.view.render()).open();
		});

		headerEl.addEventListener('contextmenu', (e) => {
			this.showEpicContextMenu(e, epic, store, projectId);
		});

		if (isCollapsed) return;

		if (children.length === 0) {
			const emptyRow = section.createEl('div', { cls: 'pf-tbl-row pf-tbl-row-empty' });
			emptyRow.createEl('div', { cls: 'pf-tbl-cell' });
			emptyRow.createEl('div', { cls: 'pf-tbl-cell' });
			emptyRow.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' })
				.createEl('span', { cls: 'pf-tbl-empty-text', text: 'No tasks in this epic yet.' });
			for (let i = 0; i < 4; i++) emptyRow.createEl('div', { cls: 'pf-tbl-cell' });
			return;
		}

		for (const child of children) {
			this.renderEpicChild(section, store, projectId, child, 1, orderedIds);
		}
	}

	private renderRogueRow(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		ticket: Ticket,
		epics: Ticket[],
		orderedIds: string[],
	): void {
		const row = container.createEl('div', {
			cls: `pf-tbl-row pf-priority-border-${ticket.priority} pf-draggable-row`,
		});
		row.draggable = false;
		row.dataset.ticketId = ticket.id;
		row.dataset.parentId = '';
		row.dataset.depth = '0';

		const rogueDragHandle = row.createEl('div', { cls: 'pf-drag-handle', text: '⠿' });
		rogueDragHandle.addEventListener('mousedown', () => { row.draggable = true; });

		this.view.addRowCheckbox(row, ticket.id, container, orderedIds);

		const nameCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' });
		const nameInner = nameCell.createEl('div', { cls: 'pf-tbl-name-inner' });
		nameInner.createEl('span', { cls: 'pf-epic-toggle-placeholder' });
		nameInner.createEl('span', { cls: `pf-type-icon pf-type-icon-${ticket.type}`, text: this.view.TYPE_ICONS[ticket.type] ?? '◻' });
		nameInner.createEl('span', { cls: 'pf-tbl-title', text: ticket.title });
		if (ticket.points !== undefined) {
			nameInner.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-status-col-${ticket.status.replace(/-/g, '')}`, text: TICKET_STATUS_LABELS[ticket.status] });

		row.createEl('div', { cls: 'pf-tbl-cell' });
		row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-actions' });

		row.addEventListener('dragstart', (e) => {
			this.view.draggedTicketId = ticket.id;
			this.view.draggedTicketType = ticket.type;
			this._highlightMultiDrag(row, ticket.id, e);
		});
		row.addEventListener('dragend', () => {
			this.view.draggedTicketId = null;
			this.view.draggedTicketType = null;
			row.draggable = false;
			this._clearDragging();
		});

		nameCell.addEventListener('click', () => {
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: ticket.sprintId ?? null }, () => this.view.render()).open();
		});

		row.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: ticket.sprintId ?? null }, () => this.view.render()).open()
				)
			);
			menu.addItem(item =>
				item.setTitle('Open note').setIcon('file-text').onClick(async () =>
					await this.view.openTicketNote(ticket)
				)
			);
			if (epics.length > 0) {
				for (const epic of epics) {
					menu.addItem(item =>
						item.setTitle(`Move to "${epic.title}"`).setIcon('arrow-right').onClick(async () => {
							const oldPath = this.view.getTicketFilePath(ticket.id);
							await store.updateTicket(ticket.id, { parentId: epic.id });
							await generateTicketNote(this.view.plugin, ticket.id, oldPath ?? undefined);
							await generateTicketNote(this.view.plugin, epic.id);
							this.view.render();
						})
					);
				}
			}
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete').setIcon('trash').onClick(() => {
					new ConfirmModal(this.view.app, `Delete "${ticket.title}"? This cannot be undone.`, async () => {
						await deleteTicketNote(this.view.plugin, ticket.id);
						await store.deleteTicket(ticket.id);
						this.view.render();
					}).open();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}

	private renderEpicChild(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		ticket: Ticket,
		depth: number,
		orderedIds: string[],
	): void {
		const row = container.createEl('div', {
			cls: `pf-tbl-row pf-tbl-row-depth-${depth} pf-priority-border-${ticket.priority} pf-draggable-row`,
		});
		row.draggable = false;
		row.dataset.ticketId = ticket.id;
		row.dataset.parentId = ticket.parentId ?? '';
		row.dataset.depth = String(depth);

		row.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			this.view.draggedTicketId = ticket.id;
			this.view.draggedTicketType = ticket.type;
			this.view.draggedEpicId = null;
			this._highlightMultiDrag(row, ticket.id, e);
		});
		row.addEventListener('dragend', () => {
			this.view.draggedTicketId = null;
			this.view.draggedTicketType = null;
			row.draggable = false;
			this._clearDragging();
		});

		const subtasks = store.getChildTickets(ticket.id);
		const isCollapsed = this.view.collapsedSections.has(ticket.id);
		const indentPx = depth * 20;

		const childDragHandle = row.createEl('div', { cls: 'pf-drag-handle', text: '⠿' });
		childDragHandle.addEventListener('mousedown', () => { row.draggable = true; });

		this.view.addRowCheckbox(row, ticket.id, container, orderedIds);

		const nameCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' });
		const nameInner = nameCell.createEl('div', { cls: 'pf-tbl-name-inner' });
		nameInner.style.paddingLeft = `${indentPx}px`;

		if (depth === 1 && subtasks.length > 0) {
			const toggleEl = nameInner.createEl('span', {
				cls: `pf-epic-toggle${isCollapsed ? '' : ' pf-epic-toggle-open'}`,
				text: isCollapsed ? '▸' : '▾',
			});
			toggleEl.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.view.collapsedSections.has(ticket.id)) {
					this.view.collapsedSections.delete(ticket.id);
				} else {
					this.view.collapsedSections.add(ticket.id);
				}
				this.view.render();
			});
		} else {
			nameInner.createEl('span', { cls: 'pf-epic-toggle-placeholder' });
		}

		nameInner.createEl('span', { cls: `pf-type-icon pf-type-icon-${ticket.type}`, text: this.view.TYPE_ICONS[ticket.type] ?? '◻' });
		nameInner.createEl('span', { cls: 'pf-tbl-title', text: ticket.title });

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-status-col-${ticket.status.replace(/-/g, '')}`, text: TICKET_STATUS_LABELS[ticket.status] });

		const extraCell = row.createEl('div', { cls: 'pf-tbl-cell' });
		if (ticket.points !== undefined) {
			extraCell.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		} else if (depth === 1 && subtasks.length > 0) {
			extraCell.createEl('span', { cls: 'pf-epic-progress', text: `${subtasks.filter(s => s.status === 'done').length}/${subtasks.length}` });
		}

		const actionsCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-actions' });
		if (depth === 1) {
			const addSubBtn = actionsCell.createEl('button', { cls: 'pf-btn pf-btn-sm pf-epic-add-child', text: '+ Sub' });
			addSubBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new TicketModal(this.view.app, this.view.plugin, {
					projectId,
					sprintId: null,
					parentId: ticket.id,
					defaultType: 'subtask',
				}, () => this.view.render()).open();
			});
		}

		nameCell.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'BUTTON') return;
			if ((e.target as HTMLElement).classList.contains('pf-epic-toggle')) return;
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: ticket.sprintId ?? null }, () => this.view.render()).open();
		});

		row.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: ticket.sprintId ?? null }, () => this.view.render()).open()
				)
			);
			menu.addItem(item =>
				item.setTitle('Open note').setIcon('file-text').onClick(async () =>
					await this.view.openTicketNote(ticket)
				)
			);
			if (depth === 1) {
				menu.addItem(item =>
					item.setTitle('Add subtask').setIcon('plus').onClick(() =>
						new TicketModal(this.view.app, this.view.plugin, {
							projectId,
							sprintId: null,
							parentId: ticket.id,
							defaultType: 'subtask',
						}, () => this.view.render()).open()
					)
				);
				menu.addItem(item =>
					item.setTitle('Remove from parent').setIcon('x').onClick(async () => {
						const oldPath = this.view.getTicketFilePath(ticket.id);
						await store.updateTicket(ticket.id, { parentId: null });
						await generateTicketNote(this.view.plugin, ticket.id, oldPath ?? undefined);
						this.view.render();
					})
				);
			}
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete').setIcon('trash').onClick(() => {
					const childCount = store.getChildTickets(ticket.id).length;
					const msg = childCount > 0
						? `Delete "${ticket.title}" and its ${childCount} subtask${childCount !== 1 ? 's' : ''}? This cannot be undone.`
						: `Delete "${ticket.title}"? This cannot be undone.`;
					new ConfirmModal(this.view.app, msg, async () => {
						await deleteTicketNote(this.view.plugin, ticket.id);
						await store.deleteTicket(ticket.id);
						this.view.render();
					}).open();
				})
			);
			menu.showAtMouseEvent(e);
		});

		if (depth === 1 && !isCollapsed) {
			for (const sub of subtasks) {
				this.renderEpicChild(container, store, projectId, sub, 2, orderedIds);
			}
		}
	}

	private showEpicContextMenu(e: MouseEvent, epic: Ticket, store: ProjectStore, projectId: string): void {
		const menu = new Menu();
		menu.addItem(item =>
			item.setTitle('Edit').setIcon('pencil').onClick(() =>
				new TicketModal(this.view.app, this.view.plugin, { ticket: epic, sprintId: null }, () => this.view.render()).open()
			)
		);
		menu.addItem(item =>
			item.setTitle('Open note').setIcon('file-text').onClick(async () =>
				await this.view.openTicketNote(epic)
			)
		);
		menu.addItem(item =>
			item.setTitle('Add task').setIcon('plus').onClick(() =>
				new TicketModal(this.view.app, this.view.plugin, {
					projectId,
					sprintId: null,
					parentId: epic.id,
					defaultType: 'task',
				}, () => this.view.render()).open()
			)
		);
		menu.addSeparator();
		menu.addItem(item =>
			item.setTitle('Delete epic').setIcon('trash').onClick(() => {
				const childCount = store.getDescendantIds(epic.id).length;
				const msg = childCount > 0
					? `Delete epic "${epic.title}" and all ${childCount} descendant${childCount !== 1 ? 's' : ''}? This cannot be undone.`
					: `Delete epic "${epic.title}"? This cannot be undone.`;
				new ConfirmModal(this.view.app, msg, async () => {
					await deleteTicketNote(this.view.plugin, epic.id);
					await store.deleteTicket(epic.id);
					this.view.render();
				}).open();
			})
		);
		menu.showAtMouseEvent(e);
	}

	// ── Multi-drag helpers ────────────────────────────────────────────────────

	/** Highlights all selected rows on dragstart; shows multi-drag ghost when > 1 row. */
	private _highlightMultiDrag(anchorRow: HTMLElement, ticketId: string, e: DragEvent): void {
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
	private _clearDragging(): void {
		if (this._scrollArea) {
			this._scrollArea.querySelectorAll<HTMLElement>('.pf-tbl-row.pf-dragging').forEach(el => {
				el.classList.remove('pf-dragging');
			});
		}
	}
}
