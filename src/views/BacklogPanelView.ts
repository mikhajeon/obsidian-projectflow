import { Menu } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket } from '../types';
import { TICKET_STATUS_LABELS } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';

export class BacklogPanelView {
	private view: BoardView;

	// Drag state — draggedIds is the full set being moved; draggedId is the anchor row
	private draggedId: string | null = null;
	private draggedIds: string[] = [];
	private draggedFromSectionId: string | null = null;
	private dropSectionId: string | null = null;
	private dropBeforeId: string | null | '__end__' = null;

	// Cached useSprints flag and scroll container for use inside helpers
	private _useSprints = true;
	private _scrollArea: HTMLElement | null = null;
	// Cached backlog/todo status IDs for the active project
	private _backlogStatusIds: Set<string> = new Set(['backlog']);
	private _backlogStatusId = 'backlog';
	private _todoStatusId = 'todo';

	constructor(view: BoardView) {
		this.view = view;
	}

	render(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		useSprints = true,
	): void {
		this._useSprints = useSprints;

		const projectStatuses = store.getProjectStatuses(projectId);
		this._backlogStatusIds = new Set(projectStatuses.filter(s => s.universalId === 'backlog').map(s => s.id));
		this._backlogStatusId = projectStatuses.find(s => s.universalId === 'backlog')?.id ?? 'backlog';
		this._todoStatusId = projectStatuses.find(s => s.universalId === 'todo')?.id ?? 'todo';

		const scrollArea = container.createEl('div', { cls: 'pf-backlog-list pf-tbl-container' });
		this._scrollArea = scrollArea;

		const backlogCols = [
			{ key: 'name',     label: 'Name',                          cssVar: '--pf-col-name',     default: 280, sortField: 'title'    },
			{ key: 'priority', label: 'Priority',                      cssVar: '--pf-col-priority', default: 100, sortField: 'priority' },
			{ key: 'status',   label: 'Status',                        cssVar: '--pf-col-status',   default: 110, sortField: 'status'   },
			{ key: 'sprint',   label: useSprints ? 'Sprint' : '',       cssVar: '--pf-col-extra',    default: 130 },
		];
		const savedBacklogWidths = store.getColWidths('backlog');
		for (const col of backlogCols) {
			scrollArea.style.setProperty(col.cssVar, `${savedBacklogWidths[col.key] ?? col.default}px`);
		}

		this.view.renderTableHeader(scrollArea, backlogCols, (key, width) => {
			const current = store.getColWidths('backlog');
			store.setColWidths('backlog', { ...current, [key]: width });
		}, this.view.sortOrder, async (next) => {
			this.view.sortOrder = next;
			await this.view.plugin.store.setSortOrder('backlog', next);
			const scrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			const scrollTop = scrollEl?.scrollTop ?? 0;
			this.view.render();
			const newScrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			if (newScrollEl) newScrollEl.scrollTop = scrollTop;
		});

		// ── No-sprint mode: two flat sections (Board list + Product Backlog) ─
		if (!useSprints) {
			const allUnassigned = store.getTickets({ projectId, sprintId: null })
				.filter(t => t.type !== 'epic' && t.type !== 'subtask');

			const boardTickets   = allUnassigned.filter(t => !this._backlogStatusIds.has(t.status));
			const backlogTickets = allUnassigned.filter(t => this._backlogStatusIds.has(t.status));

			const sortedBoard   = this.sortBacklogTickets(this.applyFilters(boardTickets));
			const sortedBacklog = this.sortBacklogTickets(this.applyFilters(backlogTickets));

			const orderedIds: string[] = [];
			if (!this.view.collapsedSections.has('board-list')) {
				for (const t of sortedBoard) orderedIds.push(t.id);
			}
			if (!this.view.collapsedSections.has('product-backlog')) {
				for (const t of sortedBacklog) orderedIds.push(t.id);
			}

			for (const id of [...this.view.selectedIds]) {
				if (!orderedIds.includes(id)) this.view.selectedIds.delete(id);
			}
			if (this.view.selectedIds.size > 0) scrollArea.addClass('pf-has-selection');

			const dropLineEl = scrollArea.createEl('div', { cls: 'pf-drop-line' });

			this.renderBacklogSection(scrollArea, store, projectId, 'Active', null, 'board-list', sortedBoard, null, orderedIds);
			this.renderBacklogSection(scrollArea, store, projectId, 'Product Backlog', null, 'product-backlog', sortedBacklog, null, orderedIds);

			this.renderSelectionBar(scrollArea, store);

			// ── No-sprint drag handlers ───────────────────────────────────────
			this.attachDragHandlers(scrollArea, dropLineEl, async (destSectionId, beforeId) => {
				const ticketsToMove = this.resolveDraggedTickets(store);
				const newShowOnBoard = destSectionId === 'board-list';
				for (const t of ticketsToMove) {
					const newStatus = newShowOnBoard && this._backlogStatusIds.has(t.status)
						? this._todoStatusId
						: !newShowOnBoard && !this._backlogStatusIds.has(t.status)
						? this._backlogStatusId
						: undefined;
					if (t.showOnBoard !== newShowOnBoard || newStatus !== undefined) {
						await store.updateTicket(t.id, {
							showOnBoard: newShowOnBoard,
							...(newStatus !== undefined ? { status: newStatus } : {}),
						});
					}
					const resolvedBefore = beforeId === '__end__' ? null : (beforeId ?? null);
					await store.reorderBacklogTicket(t.id, null, resolvedBefore);
					generateTicketNote(this.view.plugin, t.id).catch(() => { /* silent */ });
				}
				const scrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
				const scrollTop = scrollEl?.scrollTop ?? 0;
				this.view.render();
				const newScrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
				if (newScrollEl) newScrollEl.scrollTop = scrollTop;
			});
			return;
		}

		// ── Sprint mode ───────────────────────────────────────────────────────

		const sprints = store.getSprints(projectId)
			.filter(s => s.status !== 'completed')
			.sort((a, b) => {
				if (a.status === 'active' && b.status !== 'active') return -1;
				if (b.status === 'active' && a.status !== 'active') return 1;
				return b.startDate - a.startDate;
			});

		const orderedIds: string[] = [];
		for (const sprint of sprints) {
			const st = this.sortBacklogTickets(this.applyFilters(
				store.getTickets({ projectId, sprintId: sprint.id })
					.filter(t => !this._backlogStatusIds.has(t.status))
			));
			if (!this.view.collapsedSections.has(sprint.id)) {
				for (const t of st) orderedIds.push(t.id);
			}
		}
		const unassignedForOrder = this.sortBacklogTickets(
			this.applyFilters(
				store.getTickets({ projectId })
					.filter(t => t.type !== 'epic' && t.type !== 'subtask')
					.filter(t => t.sprintId === null || this._backlogStatusIds.has(t.status))
			)
		);
		if (!this.view.collapsedSections.has('product-backlog')) {
			for (const t of unassignedForOrder) orderedIds.push(t.id);
		}

		for (const id of [...this.view.selectedIds]) {
			if (!orderedIds.includes(id)) this.view.selectedIds.delete(id);
		}
		if (this.view.selectedIds.size > 0) scrollArea.addClass('pf-has-selection');

		const dropLineEl = scrollArea.createEl('div', { cls: 'pf-drop-line' });

		for (const sprint of sprints) {
			const tickets = this.sortBacklogTickets(this.applyFilters(
				store.getTickets({ projectId, sprintId: sprint.id })
					.filter(t => !this._backlogStatusIds.has(t.status))
			));
			this.renderBacklogSection(scrollArea, store, projectId, sprint.name, sprint.status, sprint.id, tickets, sprint, orderedIds);
		}

		const unassigned = this.sortBacklogTickets(
			this.applyFilters(
				store.getTickets({ projectId })
					.filter(t => t.type !== 'epic' && t.type !== 'subtask')
					.filter(t => t.sprintId === null || this._backlogStatusIds.has(t.status))
			)
		);
		this.renderBacklogSection(scrollArea, store, projectId, 'Product Backlog', null, 'product-backlog', unassigned, null, orderedIds);

		this.renderSelectionBar(scrollArea, store);

		// ── Sprint drag handlers ──────────────────────────────────────────────
		this.attachDragHandlers(scrollArea, dropLineEl, async (destSectionId, beforeId) => {
			const ticketsToMove = this.resolveDraggedTickets(store);
			const destSprintId = destSectionId === 'product-backlog' ? null : destSectionId;
			for (const t of ticketsToMove) {
				const srcSprintId = t.sprintId ?? null;
				const newStatus = destSectionId === 'product-backlog' && !this._backlogStatusIds.has(t.status)
					? this._backlogStatusId
					: destSectionId !== 'product-backlog' && this._backlogStatusIds.has(t.status)
					? this._todoStatusId
					: t.status;
				if (destSprintId !== srcSprintId || newStatus !== t.status) {
					await store.moveTicket(t.id, destSprintId, newStatus, t.order);
				}
				const resolvedBefore = beforeId === '__end__' ? null : (beforeId ?? null);
				await store.reorderBacklogTicket(t.id, destSprintId, resolvedBefore);
				generateTicketNote(this.view.plugin, t.id).catch(() => { /* silent */ });
			}
			const scrollEl = this.view.contentEl.querySelector('.pf-tbl-container');
			const scrollTop = scrollEl?.scrollTop ?? 0;
			this.view.render();
			const newScrollEl = this.view.contentEl.querySelector('.pf-tbl-container');
			if (newScrollEl) newScrollEl.scrollTop = scrollTop;
		});
	}

	// ── Drag orchestration ────────────────────────────────────────────────────

	/** Returns dragged tickets sorted by their current backlogOrder (preserves relative order on drop). */
	private resolveDraggedTickets(store: ProjectStore): Ticket[] {
		return this.draggedIds
			.map(id => store.getTicket(id))
			.filter((t): t is Ticket => t !== undefined)
			.sort((a, b) => (a.backlogOrder ?? 0) - (b.backlogOrder ?? 0));
	}

	/**
	 * Attaches unified dragover / dragleave / drop handlers to scrollArea.
	 * The drop callback receives (destSectionId, beforeId) and owns the commit logic.
	 */
	private attachDragHandlers(
		scrollArea: HTMLElement,
		dropLineEl: HTMLElement,
		onDrop: (destSectionId: string, beforeId: string | null | '__end__') => Promise<void>,
	): void {
		scrollArea.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (!this.draggedId) return;

			// Hovering over a section header?
			const headerEl = (e.target as HTMLElement).closest<HTMLElement>('.pf-tbl-section-header[data-section-id]');
			if (headerEl) {
				scrollArea.querySelectorAll('.pf-section-drop-active').forEach(el => el.classList.remove('pf-section-drop-active'));
				dropLineEl.classList.remove('pf-drop-line-visible');
				headerEl.classList.add('pf-section-drop-active');
				this.dropSectionId = headerEl.dataset.sectionId ?? null;
				this.dropBeforeId = '__end__';
				return;
			}

			scrollArea.querySelectorAll('.pf-section-drop-active').forEach(el => el.classList.remove('pf-section-drop-active'));

			const row = (e.target as HTMLElement).closest<HTMLElement>('.pf-tbl-row[data-ticket-id]');
			// Skip rows that are part of the dragged group
			if (!row || this.draggedIds.includes(row.dataset.ticketId ?? '')) {
				dropLineEl.classList.remove('pf-drop-line-visible');
				this.dropSectionId = null;
				this.dropBeforeId = null;
				return;
			}

			const rect = row.getBoundingClientRect();
			const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;
			this.dropSectionId = row.dataset.sectionId ?? null;

			if (insertBefore) {
				this.dropBeforeId = row.dataset.ticketId ?? null;
			} else {
				const allRows = Array.from(scrollArea.querySelectorAll<HTMLElement>('.pf-tbl-row[data-ticket-id]'));
				const idx = allRows.indexOf(row);
				const next = allRows[idx + 1];
				if (!next || next.dataset.sectionId !== row.dataset.sectionId) {
					this.dropBeforeId = '__end__';
				} else {
					this.dropBeforeId = next.dataset.ticketId ?? '__end__';
				}
			}

			dropLineEl.className = 'pf-drop-line pf-drop-line-visible';
			dropLineEl.style.top = (insertBefore ? row.offsetTop : row.offsetTop + row.offsetHeight) + 'px';
		});

		scrollArea.addEventListener('dragleave', (e) => {
			if (!scrollArea.contains(e.relatedTarget as Node)) {
				dropLineEl.classList.remove('pf-drop-line-visible');
				scrollArea.querySelectorAll('.pf-section-drop-active').forEach(el => el.classList.remove('pf-section-drop-active'));
				this.dropSectionId = null;
				this.dropBeforeId = null;
			}
		});

		scrollArea.addEventListener('drop', async (e) => {
			e.preventDefault();
			dropLineEl.classList.remove('pf-drop-line-visible');
			scrollArea.querySelectorAll('.pf-section-drop-active').forEach(el => el.classList.remove('pf-section-drop-active'));

			const destSectionId = this.dropSectionId;
			const beforeId = this.dropBeforeId;

			// Clear UI state immediately; keep draggedIds until after onDrop
			// so that resolveDraggedTickets() can still read them.
			this.draggedFromSectionId = null;
			this.dropSectionId = null;
			this.dropBeforeId = null;

			if (!destSectionId) {
				this.draggedId = null;
				this.draggedIds = [];
				return;
			}

			await onDrop(destSectionId, beforeId);

			// Reset only after onDrop has consumed the IDs
			this.draggedId = null;
			this.draggedIds = [];
		});
	}

	// ── Shared helpers ────────────────────────────────────────────────────────

	private applyFilters(tickets: Ticket[]): Ticket[] {
		return tickets
			.filter(t => this.view.filterType === 'all' || t.type === this.view.filterType)
			.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority)
			.filter(t => this.view.filterStatus === 'all' || t.status === this.view.filterStatus);
	}

	private renderSelectionBar(scrollArea: HTMLElement, store: ProjectStore): void {
		const hasSelection = this.view.selectedIds.size > 0;
		const bar = scrollArea.createEl('div', { cls: 'pf-selection-bar' });
		if (!hasSelection) return;
		bar.createEl('span', { cls: 'pf-selection-bar-count', text: `${this.view.selectedIds.size} selected` });
		const archiveBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Archive selected' });
		archiveBtn.addEventListener('click', async () => {
			const ids = [...this.view.selectedIds];
			await store.bulkArchiveTickets(ids);
			this.view.selectedIds.clear();
			this.view.lastSelectedId = null;
			this.view.render();
		});
		const deleteBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Delete selected' });
		deleteBtn.addEventListener('click', async () => {
			const ids = [...this.view.selectedIds];
			const msg = `Delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''}? This cannot be undone.`;
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

	private renderBacklogSection(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		title: string,
		sprintStatus: string | null,
		sectionId: string,
		tickets: Ticket[],
		sprint: Sprint | null,
		orderedIds: string[],
	): void {
		const section = container.createEl('div', { cls: 'pf-backlog-section' });
		const isCollapsed = this.view.collapsedSections.has(sectionId);

		const headerEl = section.createEl('div', { cls: 'pf-tbl-section-header' });
		headerEl.dataset.sectionId = sectionId;

		headerEl.createEl('span', {
			cls: `pf-epic-toggle${isCollapsed ? '' : ' pf-epic-toggle-open'}`,
			text: isCollapsed ? '▸' : '▾',
		});
		headerEl.createEl('span', { cls: 'pf-backlog-section-title', text: title });
		if (sprintStatus) {
			headerEl.createEl('span', { cls: `pf-badge pf-status-${sprintStatus}`, text: sprintStatus });
		}
		if (!this._useSprints) {
			const desc = sectionId === 'board-list'
				? 'Tickets shown on the board'
				: 'Backlog status tickets';
			headerEl.createEl('span', { cls: 'pf-backlog-section-desc', text: desc });
		}
		headerEl.createEl('span', { cls: 'pf-backlog-section-count', text: `${tickets.length} item${tickets.length !== 1 ? 's' : ''}` });

		headerEl.addEventListener('click', () => {
			if (this.view.collapsedSections.has(sectionId)) {
				this.view.collapsedSections.delete(sectionId);
			} else {
				this.view.collapsedSections.add(sectionId);
			}
			this.view.render();
		});

		if (isCollapsed) return;

		if (tickets.length === 0) {
			const emptyEl = section.createEl('div', { cls: 'pf-backlog-empty pf-backlog-drop-zone' });
			emptyEl.setText(
				!this._useSprints && sectionId === 'board-list'
					? 'Drag tickets here to show them on the board.'
					: 'No tickets in this section.'
			);
			emptyEl.dataset.sectionId = sectionId;
			emptyEl.addEventListener('dragover', (e) => {
				e.preventDefault();
				if (!this.draggedId) return;
				emptyEl.classList.add('pf-section-drop-active');
				this.dropSectionId = sectionId;
				this.dropBeforeId = '__end__';
			});
			emptyEl.addEventListener('dragleave', () => {
				emptyEl.classList.remove('pf-section-drop-active');
			});
			return;
		}

		for (const ticket of tickets) {
			this.renderBacklogRow(section, store, ticket, projectId, sprint, sectionId, orderedIds);
		}
	}

	private renderBacklogRow(
		container: HTMLElement,
		store: ProjectStore,
		ticket: Ticket,
		projectId: string,
		sprint: Sprint | null,
		sectionId: string,
		orderedIds: string[],
	): void {
		const row = container.createEl('div', { cls: `pf-tbl-row pf-draggable-row` });
		row.draggable = true;
		row.dataset.ticketId = ticket.id;
		row.dataset.sectionId = sectionId;
		row.dataset.parentId = '';
		row.dataset.depth = '0';

		row.createEl('div', { cls: 'pf-drag-handle', text: '⠿' });

		this.view.addRowCheckbox(row, ticket.id, container, orderedIds);

		row.addEventListener('dragstart', (e) => {
			// If dragging a selected row and there are multiple selected, drag the whole group.
			// If dragging a non-selected row, drag only this row (and clear the prior selection).
			if (this.view.selectedIds.has(ticket.id) && this.view.selectedIds.size > 1) {
				this.draggedIds = [...this.view.selectedIds];
			} else {
				if (!this.view.selectedIds.has(ticket.id)) {
					this.view.selectedIds.clear();
				}
				this.draggedIds = [ticket.id];
			}
			this.draggedId = ticket.id;
			this.draggedFromSectionId = sectionId;

			// Highlight all dragged rows
			if (this._scrollArea) {
				for (const id of this.draggedIds) {
					const el = this._scrollArea.querySelector<HTMLElement>(`.pf-tbl-row[data-ticket-id="${id}"]`);
					el?.classList.add('pf-dragging');
				}
			} else {
				row.addClass('pf-dragging');
			}

			// Custom ghost for multi-drag
			if (this.draggedIds.length > 1 && e.dataTransfer) {
				const ghost = document.createElement('div');
				ghost.className = 'pf-multi-drag-ghost';
				ghost.textContent = `Moving ${this.draggedIds.length} tickets`;
				document.body.appendChild(ghost);
				e.dataTransfer.setDragImage(ghost, 14, 14);
				requestAnimationFrame(() => {
					if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
				});
			}

			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		row.addEventListener('dragend', () => {
			row.draggable = true;
			// Remove dragging class from all rows that were being dragged
			if (this._scrollArea) {
				this._scrollArea.querySelectorAll<HTMLElement>('.pf-tbl-row.pf-dragging').forEach(el => {
					el.classList.remove('pf-dragging');
				});
			}
		});

		const nameCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' });
		const nameInner = nameCell.createEl('div', { cls: 'pf-tbl-name-inner' });
		nameInner.createEl('span', { cls: `pf-type-icon pf-type-icon-${ticket.type}`, text: this.view.TYPE_ICONS[ticket.type] ?? '◻' });
		nameInner.createEl('span', { cls: 'pf-tbl-title', text: ticket.title });
		if (ticket.points !== undefined) {
			nameInner.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		this.view.makeStatusBadge(row.createEl('div', { cls: 'pf-tbl-cell' }), ticket.status, projectId);

		const lastCell = row.createEl('div', { cls: 'pf-tbl-cell' });

		if (!this._useSprints) {
			// Last cell intentionally empty — section placement is driven by status
		} else if (!sprint) {
			const availableSprints = store.getSprints(projectId).filter(s => s.status !== 'completed');
			if (availableSprints.length > 0) {
				const addToSprint = lastCell.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
				addToSprint.createEl('option', { text: 'Add to sprint...', value: '' });
				for (const s of availableSprints) {
					addToSprint.createEl('option', { text: s.name, value: s.id });
				}
				addToSprint.addEventListener('change', async () => {
					if (addToSprint.value) {
						await store.moveTicket(ticket.id, addToSprint.value, this._todoStatusId, ticket.order);
						await generateTicketNote(this.view.plugin, ticket.id);
						this.view.render();
					}
				});
			}
		} else {
			lastCell.createEl('span', { cls: 'pf-tbl-sprint-name', text: sprint.name });
		}

		row.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'OPTION') return;
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint?.id ?? null }, () => this.view.render()).open();
		});

		row.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint?.id ?? null }, () => this.view.render()).open()
				)
			);
			menu.addItem(item =>
				item.setTitle('Open note').setIcon('file-text').onClick(async () =>
					await this.view.openTicketNote(ticket)
				)
			);
			if (!this._useSprints) {
				if (ticket.showOnBoard === true && !this._backlogStatusIds.has(ticket.status)) {
					menu.addItem(item =>
						item.setTitle('Move to product backlog').setIcon('archive').onClick(async () => {
							await store.updateTicket(ticket.id, { showOnBoard: false, status: this._backlogStatusId });
							await generateTicketNote(this.view.plugin, ticket.id);
							this.view.render();
						})
					);
				} else if (!this._backlogStatusIds.has(ticket.status)) {
					menu.addItem(item =>
						item.setTitle('Show on board').setIcon('layout-dashboard').onClick(async () => {
							await store.updateTicket(ticket.id, { showOnBoard: true });
							await generateTicketNote(this.view.plugin, ticket.id);
							this.view.render();
						})
					);
				} else {
					menu.addItem(item =>
						item.setTitle('Show on board').setIcon('layout-dashboard').onClick(async () => {
							await store.updateTicket(ticket.id, { showOnBoard: true, status: this._todoStatusId });
							await generateTicketNote(this.view.plugin, ticket.id);
							this.view.render();
						})
					);
				}
			} else if (sprint) {
				menu.addItem(item =>
					item.setTitle('Move to product backlog').setIcon('archive').onClick(async () => {
						await store.moveTicket(ticket.id, null, this._backlogStatusId, ticket.order);
						await generateTicketNote(this.view.plugin, ticket.id);
						this.view.render();
					})
				);
			}
			if (ticket.type === 'task' || ticket.type === 'bug' || ticket.type === 'story') {
				menu.addItem(item =>
					item.setTitle('Add subtask').setIcon('plus').onClick(() =>
						new TicketModal(this.view.app, this.view.plugin, {
							projectId: ticket.projectId,
							sprintId: sprint?.id ?? null,
							parentId: ticket.id,
							defaultType: 'subtask',
						}, () => this.view.render()).open()
					)
				);
			}
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Archive').setIcon('archive').onClick(async () => {
					await store.archiveTicket(ticket.id);
					this.view.render();
				})
			);
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

	sortBacklogTickets(tickets: Ticket[]): Ticket[] {
		if (this.view.sortOrder !== 'manual') {
			return this.view.applySort(tickets, this.view.sortOrder);
		}
		return tickets.slice().sort((a, b) => (a.backlogOrder ?? 0) - (b.backlogOrder ?? 0));
	}
}
