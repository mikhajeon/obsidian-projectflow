import { Menu, Notice } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';

/**
 * Board panel that shows only subtasks across the four status columns.
 * Each card displays a small parent-name label for context.
 */
export class BoardSubtasksPanelView {
	private view: BoardView;

	constructor(view: BoardView) {
		this.view = view;
	}

	render(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		currentSprint: Sprint,
	): void {
		const board = container.createEl('div', { cls: 'pf-board' });

		const allSprintTickets = store.getTickets({ projectId, sprintId: currentSprint.id });
		const subtasks = allSprintTickets.filter(t => t.type === 'subtask');

		const COLUMNS = store.getProjectStatuses(projectId);
		for (const col of COLUMNS) {
			if (this.view.hiddenBoardColumns.has(col.id)) continue;

			const allInCol = subtasks.filter(t => t.status === col.id);

			// Only priority filter is meaningful here — type is always subtask, status is implicit from column
			const filtered = allInCol
				.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority);
			const tickets = this.view.applySort(filtered, this.view.sortOrder);

			const colEl = board.createEl('div', { cls: 'pf-column' });
			colEl.dataset.status = col.id;
			colEl.style.setProperty('--pf-col-color', col.color);
			const colW = this.view.boardColWidth;
			colEl.style.flex = `0 0 ${colW}px`;
			colEl.style.minWidth = `${colW}px`;
			colEl.style.maxWidth = `${colW}px`;

			const colHead = colEl.createEl('div', { cls: 'pf-column-header' });
			colHead.createEl('span', { cls: 'pf-column-title', text: col.label });
			colHead.createEl('span', { cls: 'pf-column-count', text: String(allInCol.length) });

			const colBody = colEl.createEl('div', { cls: 'pf-column-body' });
			const dropLineEl = colBody.createEl('div', { cls: 'pf-board-drop-line' });
			let dropBeforeId: string | null | '__end__' = null;

			for (const ticket of tickets) {
				const parent = ticket.parentId ? store.getTicket(ticket.parentId) : undefined;
				this.renderCard(colBody, ticket, currentSprint, parent);
			}

			colBody.addEventListener('dragover', (e) => {
				e.preventDefault();
				if (!this.view.draggedTicketId) return;

				const card = (e.target as HTMLElement).closest<HTMLElement>('.pf-card[data-id]');

				if (card && card.dataset.id === this.view.draggedTicketId) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					return;
				}

				const cards = Array.from(colBody.querySelectorAll<HTMLElement>('.pf-card[data-id]'))
					.filter(c => c.dataset.id !== this.view.draggedTicketId);

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
						dropBeforeId = card.dataset.id ?? '__end__';
						lineTop = card.offsetTop;
					} else {
						const next = cards[cardIdx + 1];
						dropBeforeId = next?.dataset.id ?? '__end__';
						lineTop = card.offsetTop + card.offsetHeight;
					}
				} else {
					dropBeforeId = '__end__';
					const lastCard = cards[cards.length - 1];
					lineTop = lastCard ? lastCard.offsetTop + lastCard.offsetHeight : 0;
				}

				if (draggedIdx !== -1 && dropBeforeId === nextAdjacentId) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					return;
				}

				dropLineEl.style.top = lineTop + 'px';
				dropLineEl.classList.add('pf-drop-line-visible');
			});

			colBody.addEventListener('dragleave', (e) => {
				if (!colBody.contains(e.relatedTarget as Node)) {
					dropLineEl.classList.remove('pf-drop-line-visible');
					dropBeforeId = null;
				}
			});

			colBody.addEventListener('drop', async (e) => {
				e.preventDefault();
				dropLineEl.classList.remove('pf-drop-line-visible');
				if (this.view.draggedTicketId) {
					const droppedId = this.view.draggedTicketId;
					const dragged = store.getTicket(droppedId);
					if (!dragged || dragged.type !== 'subtask') {
						new Notice('Only subtasks are shown in this view.');
						this.view.draggedTicketId = null;
						dropBeforeId = null;
						return;
					}
					const colTickets = subtasks
						.filter(t => t.status === col.id && t.id !== droppedId)
						.sort((a, b) => a.order - b.order);

					let insertIdx = colTickets.length;
					if (dropBeforeId !== '__end__' && dropBeforeId !== null) {
						const idx = colTickets.findIndex(t => t.id === dropBeforeId);
						if (idx !== -1) insertIdx = idx;
					}

					let newOrder: number;
					if (colTickets.length === 0)           newOrder = 0;
					else if (insertIdx === 0)              newOrder = colTickets[0].order - 1;
					else if (insertIdx >= colTickets.length) newOrder = colTickets[colTickets.length - 1].order + 1;
					else newOrder = (colTickets[insertIdx - 1].order + colTickets[insertIdx].order) / 2;

					dropBeforeId = null;
					this.view.draggedTicketId = null;
					await store.moveTicket(droppedId, currentSprint.id, col.id, newOrder);
					this.view.render();
					generateTicketNote(this.view.plugin, droppedId).catch(() => { /* silent */ });
				}
			});

			const addBtn = colEl.createEl('button', { cls: 'pf-column-add', text: '+ Subtask' });
			addBtn.addEventListener('click', () =>
				new TicketModal(this.view.app, this.view.plugin, {
					projectId,
					sprintId: currentSprint.id,
					status: col.id,
					defaultType: 'subtask',
				}, () => this.view.render()).open()
			);
		}
	}

	private renderCard(container: HTMLElement, ticket: Ticket, sprint: Sprint, parent: Ticket | undefined): void {
		const showEdges = this.view.plugin.store.getProjectBoardPriorityEdges(ticket.projectId);
		const card = container.createEl('div', { cls: `pf-card${showEdges ? ` pf-priority-border-${ticket.priority}` : ''}` });
		card.draggable = true;
		card.dataset.id = ticket.id;

		const top = card.createEl('div', { cls: 'pf-card-top' });
		top.createEl('span', { cls: `pf-badge pf-type-${ticket.type}`, text: ticket.type });
		top.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });
		if (ticket.points !== undefined) {
			top.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		// Parent label
		if (parent) {
			top.createEl('span', { cls: 'pf-card-parent-label', text: parent.title });
		}

		card.createEl('p', { cls: 'pf-card-title', text: ticket.title });

		if (ticket.description) {
			card.createEl('p', { cls: 'pf-card-desc', text: ticket.description });
		}

		if (ticket.checklist && ticket.checklist.length > 0) {
			const doneCount = ticket.checklist.filter(i => i.done).length;
			card.createEl('p', { cls: 'pf-checklist-progress', text: `${doneCount}/${ticket.checklist.length} subtasks` });
		}

		card.addEventListener('dragstart', () => {
			this.view.draggedTicketId = ticket.id;
			card.addClass('pf-dragging');
		});
		card.addEventListener('dragend', () => {
			card.removeClass('pf-dragging');
			document.querySelectorAll('.pf-board-drop-line').forEach(el => el.classList.remove('pf-drop-line-visible'));
		});

		card.addEventListener('click', () => {
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint.id }, () => this.view.render()).open();
		});

		card.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint.id }, () => this.view.render()).open()
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
			menu.addSeparator();
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
