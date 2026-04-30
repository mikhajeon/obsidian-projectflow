import { Menu } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';

export class BoardPanelView {
	private view: BoardView;
	private dropBeforeId: string | null | '__end__' = null;
	private dropColStatus: string | null = null;

	constructor(view: BoardView) {
		this.view = view;
	}

	render(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		currentSprint: Sprint | null,
		useSprints = true,
	): void {
		const wrapper = container.createEl('div', { cls: 'pf-board-wrapper' });
		const board = wrapper.createEl('div', { cls: 'pf-board' });

		const COLUMNS = this.view.plugin.store.getProjectStatuses(projectId);
		for (const col of COLUMNS) {
			if (this.view.hiddenBoardColumns.has(col.id)) continue;

			const allTickets = (currentSprint
				? store.getTickets({ projectId, sprintId: currentSprint.id })
				: store.getTickets({ projectId })
			).filter(t => t.status === col.id)
			 .filter(t => useSprints || t.sprintId === null);

			const filtered = allTickets
				.filter(t => this.view.filterType === 'all' || t.type === this.view.filterType)
				.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority)
				.filter(t => this.view.filterStatus === 'all' || t.status === this.view.filterStatus);
			const tickets = this.view.applySort(filtered, this.view.sortOrder);

			const colKey = `board-col-${col.id}`;
			const isCollapsed = this.view.collapsedSections.has(colKey);
			const colEl = board.createEl('div', { cls: `pf-column${isCollapsed ? ' pf-column-collapsed' : ''}` });
			colEl.dataset.status = col.id;
			colEl.style.setProperty('--pf-col-color', col.color);
			const colW = this.view.boardColWidth;
			if (!isCollapsed) {
				colEl.style.flex = `0 0 ${colW}px`;
				colEl.style.minWidth = `${colW}px`;
				colEl.style.maxWidth = `${colW}px`;
			}

			const colHead = colEl.createEl('div', { cls: 'pf-column-header' });
			const colToggle = colHead.createEl('span', { cls: 'pf-column-toggle', text: isCollapsed ? '▸' : '▾' });
			const toggleColumn = () => {
				if (this.view.collapsedSections.has(colKey)) {
					this.view.collapsedSections.delete(colKey);
				} else {
					this.view.collapsedSections.add(colKey);
				}
				this.persistCollapsedColumns(projectId);
				this.view.render();
			};
			colToggle.addEventListener('click', (e) => {
				e.stopPropagation();
				toggleColumn();
			});
			colHead.createEl('span', { cls: 'pf-column-title', text: col.label });
			colHead.createEl('span', { cls: 'pf-column-count', text: String(allTickets.length) });

			if (isCollapsed) {
				colEl.addEventListener('click', () => {
					this.view.collapsedSections.delete(colKey);
					this.persistCollapsedColumns(projectId);
					this.view.render();
				});
				continue;
			}

			const colBody = colEl.createEl('div', { cls: 'pf-column-body' });
			const dropLineEl = colBody.createEl('div', { cls: 'pf-board-drop-line' });

			for (const ticket of tickets) {
				this.renderCard(colBody, ticket, currentSprint);
			}

			colBody.addEventListener('dragover', (e) => {
				e.preventDefault();
				if (!this.view.draggedTicketId) return;

				this.dropColStatus = col.id;

				const card = (e.target as HTMLElement).closest<HTMLElement>('.pf-card[data-id]');

				// Hovering over the dragged card itself — hide the line
				if (card && card.dataset.id === this.view.draggedTicketId) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					return;
				}

				const cards = Array.from(colBody.querySelectorAll<HTMLElement>('.pf-card[data-id]'))
					.filter(c => c.dataset.id !== this.view.draggedTicketId);

				// Determine the dragged card's current next sibling in this column
				// so we can suppress the line when the drop would be a no-op
				const allCardsInCol = Array.from(colBody.querySelectorAll<HTMLElement>('.pf-card[data-id]'));
				const draggedIdx = allCardsInCol.findIndex(c => c.dataset.id === this.view.draggedTicketId);
				const nextAdjacentId: string | '__end__' =
					draggedIdx !== -1 && draggedIdx + 1 < allCardsInCol.length
						? (allCardsInCol[draggedIdx + 1].dataset.id ?? '__end__')
						: '__end__';

				let lineTop: number;

				if (card) {
					const rect = card.getBoundingClientRect();
					const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;
					const cardIdx = cards.indexOf(card);

					if (insertBefore) {
						this.dropBeforeId = card.dataset.id ?? '__end__';
						lineTop = card.offsetTop;
					} else {
						const next = cards[cardIdx + 1];
						this.dropBeforeId = next?.dataset.id ?? '__end__';
						lineTop = card.offsetTop + card.offsetHeight;
					}
				} else {
					this.dropBeforeId = '__end__';
					const lastCard = cards[cards.length - 1];
					lineTop = lastCard ? lastCard.offsetTop + lastCard.offsetHeight : 0;
				}

				// Hide line if the drop would leave the card in its current position
				if (draggedIdx !== -1 && this.dropBeforeId === nextAdjacentId) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					return;
				}

				dropLineEl.style.top = lineTop + 'px';
				dropLineEl.classList.add('pf-drop-line-visible');
			});

			colBody.addEventListener('dragleave', (e) => {
				if (!colBody.contains(e.relatedTarget as Node)) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					if (this.dropColStatus === col.id) {
						this.dropColStatus = null;
						this.dropBeforeId = null;
					}
				}
			});

			colBody.addEventListener('drop', async (e) => {
				e.preventDefault();
				dropLineEl.classList.remove('pf-drop-line-visible');

				if (!this.view.draggedTicketId) return;

				const droppedId = this.view.draggedTicketId;
				const sprintId = currentSprint ? currentSprint.id : null;
				const beforeId = this.dropColStatus === col.id ? this.dropBeforeId : '__end__';

				this.dropColStatus = null;
				this.dropBeforeId = null;
				this.view.draggedTicketId = null;

				const colTickets = (sprintId
					? store.getTickets({ sprintId })
					: store.getTickets({ projectId })
				).filter(t => t.status === col.id && t.id !== droppedId)
				 .sort((a, b) => a.order - b.order);

				let insertIdx = colTickets.length;
				if (beforeId !== '__end__' && beforeId !== null) {
					const idx = colTickets.findIndex(t => t.id === beforeId);
					if (idx !== -1) insertIdx = idx;
				}

				let newOrder: number;
				if (colTickets.length === 0) {
					newOrder = 0;
				} else if (insertIdx === 0) {
					newOrder = colTickets[0].order - 1;
				} else if (insertIdx >= colTickets.length) {
					newOrder = colTickets[colTickets.length - 1].order + 1;
				} else {
					newOrder = (colTickets[insertIdx - 1].order + colTickets[insertIdx].order) / 2;
				}

				await store.moveTicket(droppedId, sprintId, col.id, newOrder);
				this.view.render();
				generateTicketNote(this.view.plugin, droppedId).catch(() => { /* silent */ });
			});

			const addBtn = colEl.createEl('button', { cls: 'pf-column-add', text: '+ Ticket' });
			addBtn.addEventListener('click', () =>
				new TicketModal(this.view.app, this.view.plugin, {
					projectId,
					sprintId: currentSprint ? currentSprint.id : null,
					status: col.id,
					showOnBoard: !useSprints,
				}, () => this.view.render()).open()
			);
		}
	}

	private persistCollapsedColumns(projectId: string): void {
		const PREFIX = 'board-col-';
		const ids = [...this.view.collapsedSections]
			.filter(k => k.startsWith(PREFIX))
			.map(k => k.slice(PREFIX.length));
		this.view.plugin.store.setCollapsedBoardColumns(projectId, ids);
	}

	private renderCard(container: HTMLElement, ticket: Ticket, sprint: Sprint | null): void {
		const ap = this.view.plugin.store.getBoardCardAppearance();
		const showEdges = ap.priorityEdge && this.view.plugin.store.getProjectBoardPriorityEdges(ticket.projectId);
		const card = container.createEl('div', { cls: `pf-card${showEdges ? ` pf-priority-border-${ticket.priority}` : ''}` });
		card.draggable = true;
		card.dataset.id = ticket.id;

		const cardTitleRow = card.createEl('div', { cls: 'pf-card-title-row' });
		cardTitleRow.createEl('span', { cls: 'pf-card-title', text: ticket.title });
		if (ap.recurrenceIcon && ticket.recurrence) cardTitleRow.createEl('span', { cls: 'pf-card-repeat-icon', text: '↻', attr: { title: `Repeats ${ticket.recurrence.rule}` } });

		if (ap.description && ticket.description) {
			card.createEl('p', { cls: 'pf-card-desc', text: ticket.description });
		}

		const top = card.createEl('div', { cls: 'pf-card-top' });
		if (ap.typeIcon) {
			const typeIcon = top.createEl('span', { cls: `pf-card-type-icon pf-type-${ticket.type}`, text: this.view.TYPE_ICONS[ticket.type] ?? ticket.type });
			typeIcon.title = ticket.type;
		}
		if (ap.priorityBadge) top.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });
		if (ap.points && ticket.points !== undefined) {
			top.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		if (ap.checklist && ticket.checklist && ticket.checklist.length > 0) {
			const doneCount = ticket.checklist.filter(i => i.done).length;
			card.createEl('p', { cls: 'pf-checklist-progress', text: `${doneCount}/${ticket.checklist.length} subtasks` });
		}

		if (ap.subtaskCount) {
			const childSubtasks = this.view.plugin.store.getChildTickets(ticket.id).filter(t => t.type === 'subtask');
			if (childSubtasks.length > 0) {
				const doneSubtasks = childSubtasks.filter(t => t.status === 'done').length;
				card.createEl('p', { cls: 'pf-card-subtask-count', text: `⧉ ${doneSubtasks}/${childSubtasks.length} subtasks` });
			}
		}

		card.addEventListener('dragstart', () => {
			this.view.draggedTicketId = ticket.id;
			card.addClass('pf-dragging');
		});
		card.addEventListener('dragend', () => {
			card.removeClass('pf-dragging');
			document.querySelectorAll('.pf-board-drop-line').forEach(el => el.classList.remove('pf-drop-line-visible'));
			this.dropColStatus = null;
			this.dropBeforeId = null;
		});

		card.addEventListener('click', () => {
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint?.id ?? null }, () => this.view.render()).open();
		});

		card.addEventListener('contextmenu', (e) => {
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
			menu.addItem(item =>
				item.setTitle('Move to backlog').setIcon('archive').onClick(async () => {
					await this.view.plugin.store.moveTicket(ticket.id, null, 'todo', ticket.order);
					await generateTicketNote(this.view.plugin, ticket.id);
					this.view.render();
				})
			);
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
				item.setTitle('Archive').setIcon('archive').onClick(() => {
					new ConfirmModal(this.view.app, `Archive "${ticket.title}"? It will be hidden from active views and can be restored later.`, async () => {
						await this.view.plugin.store.archiveTicket(ticket.id);
						this.view.render();
					}, 'Archive').open();
				})
			);
			menu.addItem(item =>
				item.setTitle('Delete ticket').setIcon('trash').onClick(() => {
					new ConfirmModal(this.view.app, `Delete "${ticket.title}"? This cannot be undone.`, async () => {
						await deleteTicketNote(this.view.plugin, ticket.id);
						await this.view.plugin.store.deleteTicket(ticket.id);
						this.view.render();
					}).open();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}
}
