import { ItemView, Menu, WorkspaceLeaf } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Sprint, Ticket, TicketStatus } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { SprintModal } from '../modals/SprintModal';
import { ProjectModal } from '../modals/ProjectModal';

export const BOARD_VIEW = 'projectflow-board';

const COLUMNS: { id: TicketStatus; label: string }[] = [
	{ id: 'todo', label: 'To Do' },
	{ id: 'in-progress', label: 'In Progress' },
	{ id: 'in-review', label: 'In Review' },
	{ id: 'done', label: 'Done' },
];

export class BoardView extends ItemView {
	private plugin: ProjectFlowPlugin;
	private draggedTicketId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return BOARD_VIEW; }
	getDisplayText(): string { return 'Board'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {}

	refresh(): void {
		this.render();
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('pf-view');

		const store = this.plugin.store;
		const projectId = store.getActiveProjectId();

		if (!projectId) {
			this.renderEmpty(container, 'No project selected.', 'Create a project to get started.', () =>
				new ProjectModal(this.app, this.plugin, null, () => this.render()).open()
			);
			return;
		}

		const activeSprint = store.getActiveSprint(projectId);

		// Header
		const header = container.createEl('div', { cls: 'pf-board-header' });
		const titleRow = header.createEl('div', { cls: 'pf-header-row' });

		const project = store.getProject(projectId);
		titleRow.createEl('span', { cls: 'pf-project-label', text: project?.name ?? '' });
		titleRow.createEl('h2', { cls: 'pf-view-title', text: activeSprint ? activeSprint.name : 'No active sprint' });

		const actions = titleRow.createEl('div', { cls: 'pf-header-actions' });

		if (!activeSprint) {
			actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ New sprint' })
				.addEventListener('click', () =>
					new SprintModal(this.app, this.plugin, projectId, null, () => this.render()).open()
				);
		} else {
			actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
				.addEventListener('click', () =>
					new TicketModal(this.app, this.plugin, { projectId, sprintId: activeSprint.id }, () => this.render()).open()
				);
		}

		if (activeSprint) {
			const progress = store.getSprintProgress(activeSprint.id);
			const progressRow = header.createEl('div', { cls: 'pf-progress-row' });
			progressRow.createEl('span', { cls: 'pf-progress-label', text: `${progress.done} / ${progress.total} done · ${progress.percent}%` });
			const bar = progressRow.createEl('progress', { cls: 'pf-sprint-progress' }) as HTMLProgressElement;
			bar.value = progress.percent;
			bar.max = 100;

			const endDate = new Date(activeSprint.endDate).toLocaleDateString();
			progressRow.createEl('span', { cls: 'pf-sprint-date', text: `Ends ${endDate}` });
		}

		if (!activeSprint) return;

		// Board columns
		const board = container.createEl('div', { cls: 'pf-board' });

		for (const col of COLUMNS) {
			const tickets = store.getTickets({ projectId, sprintId: activeSprint.id })
				.filter(t => t.status === col.id);

			const colEl = board.createEl('div', { cls: 'pf-column' });
			colEl.dataset.status = col.id;

			const colHead = colEl.createEl('div', { cls: 'pf-column-header' });
			colHead.createEl('span', { cls: 'pf-column-title', text: col.label });
			colHead.createEl('span', { cls: 'pf-column-count', text: String(tickets.length) });

			const colBody = colEl.createEl('div', { cls: 'pf-column-body' });

			for (const ticket of tickets) {
				this.renderCard(colBody, ticket, activeSprint);
			}

			colBody.addEventListener('dragover', (e) => {
				e.preventDefault();
				colEl.addClass('pf-drop-active');
			});
			colBody.addEventListener('dragleave', () => colEl.removeClass('pf-drop-active'));
			colBody.addEventListener('drop', async (e) => {
				e.preventDefault();
				colEl.removeClass('pf-drop-active');
				if (this.draggedTicketId) {
					await store.moveTicket(this.draggedTicketId, activeSprint.id, col.id, Date.now());
					this.draggedTicketId = null;
					this.render();
				}
			});
		}
	}

	private renderCard(container: HTMLElement, ticket: Ticket, sprint: Sprint): void {
		const card = container.createEl('div', { cls: `pf-card pf-priority-border-${ticket.priority}` });
		card.draggable = true;
		card.dataset.id = ticket.id;

		const top = card.createEl('div', { cls: 'pf-card-top' });
		top.createEl('span', { cls: `pf-badge pf-type-${ticket.type}`, text: ticket.type });
		top.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		card.createEl('p', { cls: 'pf-card-title', text: ticket.title });

		if (ticket.description) {
			card.createEl('p', { cls: 'pf-card-desc', text: ticket.description });
		}

		card.addEventListener('dragstart', () => {
			this.draggedTicketId = ticket.id;
			card.addClass('pf-dragging');
		});
		card.addEventListener('dragend', () => card.removeClass('pf-dragging'));

		card.addEventListener('click', () => {
			new TicketModal(this.app, this.plugin, { ticket, sprintId: sprint.id }, () => this.render()).open();
		});

		card.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.app, this.plugin, { ticket, sprintId: sprint.id }, () => this.render()).open()
				)
			);
			menu.addItem(item =>
				item.setTitle('Move to backlog').setIcon('archive').onClick(async () => {
					await this.plugin.store.moveTicket(ticket.id, null, 'todo', ticket.order);
					this.render();
				})
			);
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete ticket').setIcon('trash').onClick(async () => {
					await this.plugin.store.deleteTicket(ticket.id);
					this.render();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}

	private renderEmpty(container: HTMLElement, title: string, desc: string, action: () => void): void {
		const el = container.createEl('div', { cls: 'pf-empty-state' });
		el.createEl('p', { cls: 'pf-empty-title', text: title });
		el.createEl('p', { cls: 'pf-empty-desc', text: desc });
		el.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Get started' })
			.addEventListener('click', action);
	}
}
