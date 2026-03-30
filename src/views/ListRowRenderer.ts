import { Menu } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Ticket } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { generateTicketNote, deleteTicketNote } from '../ticketNote';
import type { ListDragHandler } from './ListDragHandler';

export class ListRowRenderer {
	private view: BoardView;
	private dragHandler: ListDragHandler;

	constructor(view: BoardView, dragHandler: ListDragHandler) {
		this.view = view;
		this.dragHandler = dragHandler;
	}

	renderEpicSection(
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

		const headerEl = section.createEl('div', { cls: `pf-tbl-row pf-tbl-row-epic pf-draggable-row` });
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

		this.view.makeStatusBadge(headerEl.createEl('div', { cls: 'pf-tbl-cell' }), epic.status, projectId);

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

	renderRogueRow(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		ticket: Ticket,
		epics: Ticket[],
		orderedIds: string[],
	): void {
		const subtasks = store.getChildTickets(ticket.id);
		const isCollapsed = this.view.collapsedSections.has(ticket.id);

		const row = container.createEl('div', {
			cls: `pf-tbl-row pf-draggable-row`,
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

		if (subtasks.length > 0) {
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
		if (ticket.points !== undefined) {
			nameInner.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		this.view.makeStatusBadge(row.createEl('div', { cls: 'pf-tbl-cell' }), ticket.status, projectId);

		const extraCell = row.createEl('div', { cls: 'pf-tbl-cell' });
		if (subtasks.length > 0) {
			extraCell.createEl('span', { cls: 'pf-epic-progress', text: `${subtasks.filter(s => s.status === 'done').length}/${subtasks.length}` });
		}

		const actionsCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-actions' });
		if (ticket.type === 'task' || ticket.type === 'bug' || ticket.type === 'story') {
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

		row.addEventListener('dragstart', (e) => {
			this.view.draggedTicketId = ticket.id;
			this.view.draggedTicketType = ticket.type;
			this.dragHandler.highlightMultiDrag(row, ticket.id, e);
		});
		row.addEventListener('dragend', () => {
			this.view.draggedTicketId = null;
			this.view.draggedTicketType = null;
			row.draggable = false;
			this.dragHandler.clearDragging();
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
			if (ticket.type === 'task' || ticket.type === 'bug' || ticket.type === 'story') {
				menu.addItem(item =>
					item.setTitle('Add subtask').setIcon('plus').onClick(() =>
						new TicketModal(this.view.app, this.view.plugin, {
							projectId,
							sprintId: ticket.sprintId ?? null,
							parentId: ticket.id,
							defaultType: 'subtask',
						}, () => this.view.render()).open()
					)
				);
			}
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

		// Render subtasks below rogue row when expanded
		if (subtasks.length > 0 && !isCollapsed) {
			for (const sub of subtasks) {
				this.renderEpicChild(container, store, projectId, sub, 1, orderedIds);
			}
		}
	}

	renderEpicChild(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
		ticket: Ticket,
		depth: number,
		orderedIds: string[],
	): void {
		const row = container.createEl('div', {
			cls: `pf-tbl-row pf-tbl-row-depth-${depth} pf-draggable-row`,
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
			this.dragHandler.highlightMultiDrag(row, ticket.id, e);
		});
		row.addEventListener('dragend', () => {
			this.view.draggedTicketId = null;
			this.view.draggedTicketType = null;
			row.draggable = false;
			this.dragHandler.clearDragging();
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

		this.view.makeStatusBadge(row.createEl('div', { cls: 'pf-tbl-cell' }), ticket.status, projectId);

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

	showEpicContextMenu(e: MouseEvent, epic: Ticket, store: ProjectStore, projectId: string): void {
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
}
