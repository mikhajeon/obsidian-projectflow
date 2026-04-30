import { Menu } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';


export class SubtasksPanelView {
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
		const wrapper = container.createDiv('pf-subtasks-wrapper');

		const sprintTickets = currentSprint
			? store.getTickets({ projectId, sprintId: currentSprint.id })
			: store.getTickets({ projectId }).filter(t => !useSprints || t.showOnBoard === true);

		const sprintSubtaskIds = new Set(
			sprintTickets.filter(t => t.type === 'subtask').map(t => t.id)
		);

		// Parents = sprint tasks/stories/bugs PLUS backlog parents that own sprint subtasks
		// PLUS unparented backlog tasks (no sprint, no epic parent) so subtasks can be added to them
		const sprintParentIds = new Set(
			sprintTickets.filter(t => t.type === 'subtask' && t.parentId).map(t => t.parentId as string)
		);
		const allProjectTickets = store.getTickets({ projectId });
		const parents = currentSprint
			? allProjectTickets
				.filter(t =>
					(t.type === 'task' || t.type === 'story' || t.type === 'bug') &&
					(t.sprintId === currentSprint.id || sprintParentIds.has(t.id) || (!t.parentId && !t.sprintId))
				)
				.sort((a, b) => a.order - b.order)
			: allProjectTickets
				.filter(t =>
					(t.type === 'task' || t.type === 'story' || t.type === 'bug') &&
					(!useSprints ? t.showOnBoard === true : true)
				)
				.sort((a, b) => a.order - b.order);

		// Apply "has subtasks only" filter before rendering
		const visibleParents = this.view.filterHasSubtasks
			? parents.filter(p =>
				store.getChildTickets(p.id).some(t => t.type === 'subtask' && sprintSubtaskIds.has(t.id))
			)
			: parents;

		if (visibleParents.length === 0) {
			wrapper.createDiv('pf-subtasks-empty').setText('No tasks, stories, or bugs in this view.');
			return;
		}

		for (const parent of visibleParents) {
			const allChildren = store.getChildTickets(parent.id)
				.filter(t => t.type === 'subtask' && sprintSubtaskIds.has(t.id));

			const isCollapsed = this.view.collapsedSections.has(parent.id);
			const doneCount = allChildren.filter(t => t.status === 'done').length;

			const block = wrapper.createDiv('pf-subtasks-block');

			// Header
			const blockHeader = block.createDiv('pf-subtasks-block-header');

			const toggle = blockHeader.createSpan('pf-subtasks-toggle');
			toggle.setText(isCollapsed ? '▸' : '▾');
			toggle.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.view.collapsedSections.has(parent.id)) {
					this.view.collapsedSections.delete(parent.id);
				} else {
					this.view.collapsedSections.add(parent.id);
				}
				this.view.render();
			});

			blockHeader.createSpan({ cls: `pf-badge pf-type-${parent.type}`, text: parent.type });
			blockHeader.createSpan('pf-subtasks-block-title').setText(parent.title);
			blockHeader.createSpan('pf-subtasks-block-progress').setText(`${doneCount}/${allChildren.length}`);

			const addBtn = blockHeader.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Subtask' });
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new TicketModal(this.view.app, this.view.plugin, {
					projectId,
					sprintId: currentSprint ? currentSprint.id : null,
					defaultType: 'subtask',
					parentId: parent.id,
				}, () => this.view.render()).open();
			});

			blockHeader.addEventListener('contextmenu', (e) => {
				const menu = new Menu();
				menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, { ticket: parent, sprintId: currentSprint?.id ?? null }, () => this.view.render()).open()
				));
				menu.addItem(i => i.setTitle('Open note').setIcon('file-text').onClick(async () =>
					await this.view.openTicketNote(parent)
				));
				menu.addItem(i => i.setTitle('Add subtask').setIcon('plus').onClick(() =>
					new TicketModal(this.view.app, this.view.plugin, {
						projectId,
						sprintId: currentSprint ? currentSprint.id : null,
						defaultType: 'subtask',
						parentId: parent.id,
					}, () => this.view.render()).open()
				));
				menu.showAtMouseEvent(e);
			});

			if (isCollapsed) continue;

			const COLS = this.view.plugin.store.getProjectStatuses(projectId);

			// Dynamic-column grid — column width matches board view setting
			const colW = this.view.boardColWidth;
			const grid = block.createDiv('pf-subtasks-grid');
			grid.style.gridTemplateColumns = `repeat(${COLS.length}, ${colW}px)`;
			grid.style.gap = '12px';

			for (const col of COLS) {
				const colEl = grid.createDiv('pf-subtasks-col');
				colEl.dataset.status = col.id;
				colEl.style.setProperty('--pf-col-color', col.color);

				const colHead = colEl.createDiv('pf-subtasks-col-head');
				colHead.createSpan('pf-subtasks-col-title').setText(col.label);
				const colTickets = allChildren.filter(t => t.status === col.id);
				colHead.createSpan('pf-subtasks-col-count').setText(String(colTickets.length));

				const addHeaderBtn = colHead.createEl('button', { cls: 'pf-subtasks-col-add-btn' });
				addHeaderBtn.createSpan({ text: '⧉' });
				addHeaderBtn.createSpan({ text: '+' });
				addHeaderBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					new TicketModal(this.view.app, this.view.plugin, {
						projectId,
						sprintId: currentSprint ? currentSprint.id : null,
						status: col.id,
						defaultType: 'subtask',
						parentId: parent.id,
					}, () => this.view.render()).open();
				});

				const colBody = colEl.createDiv('pf-subtasks-col-body');
				const dropLineEl = colBody.createEl('div', { cls: 'pf-board-drop-line' });
				let dropBeforeId: string | null | '__end__' = null;

				const filtered = colTickets
					.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority);
				const tickets = this.view.applySort(filtered, this.view.sortOrder);

				if (tickets.length === 0) {
					colBody.createDiv('pf-subtasks-col-empty').setText('Empty');
				}
				for (const ticket of tickets) {
					this.renderCard(colBody, ticket, currentSprint);
				}

				colBody.addEventListener('dragover', (e) => {
					e.preventDefault();
					if (!this.view.draggedTicketId) return;

					const card = (e.target as HTMLElement).closest<HTMLElement>('.pf-subtasks-card[data-id]');

					if (card && card.dataset.id === this.view.draggedTicketId) {
						dropLineEl.classList.remove('pf-drop-line-visible');
						return;
					}

					const cards = Array.from(colBody.querySelectorAll<HTMLElement>('.pf-subtasks-card[data-id]'))
						.filter(c => c.dataset.id !== this.view.draggedTicketId);

					const allCardsInCol = Array.from(colBody.querySelectorAll<HTMLElement>('.pf-subtasks-card[data-id]'));
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
						this.view.draggedTicketId = null;
						const sprintId = currentSprint ? currentSprint.id : null;
						const colTicketsNow = allChildren
							.filter(t => t.status === col.id && t.id !== droppedId)
							.sort((a, b) => a.order - b.order);

						let insertIdx = colTicketsNow.length;
						if (dropBeforeId !== '__end__' && dropBeforeId !== null) {
							const idx = colTicketsNow.findIndex(t => t.id === dropBeforeId);
							if (idx !== -1) insertIdx = idx;
						}

						let newOrder: number;
						if (colTicketsNow.length === 0)            newOrder = 0;
						else if (insertIdx === 0)                  newOrder = colTicketsNow[0].order - 1;
						else if (insertIdx >= colTicketsNow.length) newOrder = colTicketsNow[colTicketsNow.length - 1].order + 1;
						else newOrder = (colTicketsNow[insertIdx - 1].order + colTicketsNow[insertIdx].order) / 2;

						dropBeforeId = null;
						await store.moveTicket(droppedId, sprintId, col.id, newOrder);
						generateTicketNote(this.view.plugin, droppedId).catch(() => {});
						this.view.render();
					}
				});

				}
		}
	}

	private renderCard(container: HTMLElement, ticket: Ticket, sprint: Sprint | null): void {
		const ap = this.view.plugin.store.getBoardCardAppearance();
		const showEdges = ap.priorityEdge && this.view.plugin.store.getProjectBoardPriorityEdges(ticket.projectId);
		const card = container.createDiv(`pf-subtasks-card${showEdges ? ` pf-priority-border-${ticket.priority}` : ''}`);
		card.dataset.id = ticket.id;
		card.draggable = true;

		card.addEventListener('dragstart', () => {
			this.view.draggedTicketId = ticket.id;
			card.addClass('pf-subtasks-card-dragging');
		});
		card.addEventListener('dragend', () => {
			card.removeClass('pf-subtasks-card-dragging');
			document.querySelectorAll('.pf-board-drop-line').forEach(el => el.classList.remove('pf-drop-line-visible'));
		});

		// Match board view card layout: title, description, top row
		card.createEl('p', { cls: 'pf-card-title', text: ticket.title });

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

		card.addEventListener('click', () => {
			new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint?.id ?? null }, () => this.view.render()).open();
		});

		card.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(i => i.setTitle('Edit').setIcon('pencil').onClick(() =>
				new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: sprint?.id ?? null }, () => this.view.render()).open()
			));
			menu.addItem(i => i.setTitle('Open note').setIcon('file-text').onClick(async () =>
				await this.view.openTicketNote(ticket)
			));
			menu.addItem(i => i.setTitle('Move to backlog').setIcon('archive').onClick(async () => {
				await this.view.plugin.store.moveTicket(ticket.id, null, 'todo', ticket.order);
				await generateTicketNote(this.view.plugin, ticket.id);
				this.view.render();
			}));
			menu.addSeparator();
			menu.addItem(i => i.setTitle('Delete ticket').setIcon('trash').onClick(() => {
				new ConfirmModal(this.view.app, `Delete "${ticket.title}"? This cannot be undone.`, async () => {
					await deleteTicketNote(this.view.plugin, ticket.id);
					await this.view.plugin.store.deleteTicket(ticket.id);
					this.view.render();
				}).open();
			}));
			menu.showAtMouseEvent(e);
		});
	}
}
