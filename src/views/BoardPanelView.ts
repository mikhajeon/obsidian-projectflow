import { Menu } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';

export class BoardPanelView {
	private view: BoardView;

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
		const board = container.createEl('div', { cls: 'pf-board' });

		const COLUMNS = this.view.plugin.store.getProjectStatuses(projectId);
		for (const col of COLUMNS) {
			const allTickets = (currentSprint
				? store.getTickets({ projectId, sprintId: currentSprint.id })
				: store.getTickets({ projectId })
			).filter(t => t.status === col.id)
			 .filter(t => useSprints || t.showOnBoard === true);

			const filtered = allTickets
				.filter(t => this.view.filterType === 'all' || t.type === this.view.filterType)
				.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority)
				.filter(t => this.view.filterStatus === 'all' || t.status === this.view.filterStatus);
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
			colHead.createEl('span', { cls: 'pf-column-count', text: String(allTickets.length) });

			const colBody = colEl.createEl('div', { cls: 'pf-column-body' });

			for (const ticket of tickets) {
				this.renderCard(colBody, ticket, currentSprint);
			}

			colBody.addEventListener('dragover', (e) => {
				e.preventDefault();
				colEl.addClass('pf-drop-active');
			});
			colBody.addEventListener('dragleave', () => colEl.removeClass('pf-drop-active'));
			colBody.addEventListener('drop', async (e) => {
				e.preventDefault();
				colEl.removeClass('pf-drop-active');
				if (this.view.draggedTicketId) {
					const droppedId = this.view.draggedTicketId;
					const sprintId = currentSprint ? currentSprint.id : null;
					const colTickets = (sprintId
						? store.getTickets({ sprintId })
						: store.getTickets({ projectId })
					).filter(t => t.status === col.id && t.id !== droppedId);
					const maxOrder = colTickets.length > 0 ? Math.max(...colTickets.map(t => t.order)) : -1;
					await store.moveTicket(droppedId, sprintId, col.id, maxOrder + 1);
					this.view.draggedTicketId = null;
					this.view.render();
					generateTicketNote(this.view.plugin, droppedId).catch(() => { /* silent */ });
				}
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

	private renderCard(container: HTMLElement, ticket: Ticket, sprint: Sprint | null): void {
		const card = container.createEl('div', { cls: `pf-card pf-priority-border-${ticket.priority}` });
		card.draggable = true;
		card.dataset.id = ticket.id;

		const top = card.createEl('div', { cls: 'pf-card-top' });
		top.createEl('span', { cls: `pf-badge pf-type-${ticket.type}`, text: ticket.type });
		top.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });
		if (ticket.points !== undefined) {
			top.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
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
		card.addEventListener('dragend', () => card.removeClass('pf-dragging'));

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
