import { ItemView, Menu, WorkspaceLeaf } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket, TicketPriority, TicketType } from '../types';
import { PRIORITY_ORDER } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { SprintModal } from '../modals/SprintModal';

export const BACKLOG_VIEW = 'projectflow-backlog';

type SortKey = 'priority' | 'created' | 'type';

export class BacklogView extends ItemView {
	private plugin: ProjectFlowPlugin;
	private sortKey: SortKey = 'priority';
	private filterType: TicketType | 'all' = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return BACKLOG_VIEW; }
	getDisplayText(): string { return 'Backlog'; }
	getIcon(): string { return 'list'; }

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
			container.createEl('div', { cls: 'pf-empty-state' })
				.createEl('p', { text: 'No project selected. Open settings to create a project.' });
			return;
		}

		const project = store.getProject(projectId);

		// Header
		const header = container.createEl('div', { cls: 'pf-backlog-header' });
		const titleRow = header.createEl('div', { cls: 'pf-header-row' });
		titleRow.createEl('span', { cls: 'pf-project-label', text: project?.name ?? '' });
		titleRow.createEl('h2', { cls: 'pf-view-title', text: 'Backlog' });

		const actions = titleRow.createEl('div', { cls: 'pf-header-actions' });
		actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
			.addEventListener('click', () =>
				new TicketModal(this.app, this.plugin, { projectId, sprintId: null }, () => this.render()).open()
			);

		// Toolbar
		const toolbar = header.createEl('div', { cls: 'pf-toolbar' });

		// Sort
		const sortWrap = toolbar.createEl('div', { cls: 'pf-toolbar-group' });
		sortWrap.createEl('span', { cls: 'pf-toolbar-label', text: 'Sort:' });
		const sortSel = sortWrap.createEl('select', { cls: 'pf-select' }) as HTMLSelectElement;
		[['priority', 'Priority'], ['created', 'Newest'], ['type', 'Type']].forEach(([val, label]) => {
			const opt = sortSel.createEl('option', { text: label });
			opt.value = val;
			if (val === this.sortKey) opt.selected = true;
		});
		sortSel.addEventListener('change', () => {
			this.sortKey = sortSel.value as SortKey;
			this.render();
		});

		// Filter by type
		const filterWrap = toolbar.createEl('div', { cls: 'pf-toolbar-group' });
		filterWrap.createEl('span', { cls: 'pf-toolbar-label', text: 'Type:' });
		const filterSel = filterWrap.createEl('select', { cls: 'pf-select' }) as HTMLSelectElement;
		[['all', 'All'], ['task', 'Task'], ['bug', 'Bug'], ['feature', 'Feature'], ['story', 'Story']].forEach(([val, label]) => {
			const opt = filterSel.createEl('option', { text: label });
			opt.value = val;
			if (val === this.filterType) opt.selected = true;
		});
		filterSel.addEventListener('change', () => {
			this.filterType = filterSel.value as TicketType | 'all';
			this.render();
		});

		// Tickets
		let tickets = store.getTickets({ projectId, sprintId: null });

		if (this.filterType !== 'all') {
			tickets = tickets.filter(t => t.type === this.filterType);
		}

		tickets = this.sortTickets(tickets);

		const count = header.createEl('div', { cls: 'pf-backlog-count' });
		count.createEl('span', { text: `${tickets.length} item${tickets.length !== 1 ? 's' : ''}` });

		if (tickets.length === 0) {
			const empty = container.createEl('div', { cls: 'pf-empty-state' });
			empty.createEl('p', { cls: 'pf-empty-title', text: 'Backlog is empty.' });
			empty.createEl('p', { cls: 'pf-empty-desc', text: 'Add tickets to plan future sprints.' });
			return;
		}

		const list = container.createEl('div', { cls: 'pf-backlog-list' });

		for (const ticket of tickets) {
			this.renderRow(list, ticket, projectId);
		}
	}

	private renderRow(container: HTMLElement, ticket: Ticket, projectId: string): void {
		const row = container.createEl('div', { cls: `pf-backlog-row pf-priority-border-${ticket.priority}` });

		const left = row.createEl('div', { cls: 'pf-backlog-left' });
		left.createEl('span', { cls: `pf-badge pf-type-${ticket.type}`, text: ticket.type });
		left.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });
		left.createEl('span', { cls: 'pf-backlog-title', text: ticket.title });
		if (ticket.description) {
			left.createEl('span', { cls: 'pf-backlog-desc', text: ticket.description });
		}

		const right = row.createEl('div', { cls: 'pf-backlog-right' });

		const sprints = this.plugin.store.getSprints(projectId)
			.filter(s => s.status !== 'completed');

		if (sprints.length > 0) {
			const addToSprint = right.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
			addToSprint.createEl('option', { text: 'Add to sprint…', value: '' });
			for (const s of sprints) {
				addToSprint.createEl('option', { text: s.name, value: s.id });
			}
			addToSprint.addEventListener('change', async () => {
				if (addToSprint.value) {
					await this.plugin.store.moveTicket(ticket.id, addToSprint.value, 'todo', ticket.order);
					this.render();
				}
			});
		}

		right.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Edit' })
			.addEventListener('click', () =>
				new TicketModal(this.app, this.plugin, { ticket, sprintId: null }, () => this.render()).open()
			);

		row.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit').setIcon('pencil').onClick(() =>
					new TicketModal(this.app, this.plugin, { ticket, sprintId: null }, () => this.render()).open()
				)
			);
			menu.addItem(item =>
				item.setTitle('New sprint for this ticket').setIcon('plus-circle').onClick(() =>
					new SprintModal(this.app, this.plugin, projectId, null, async (sprintId) => {
						await this.plugin.store.moveTicket(ticket.id, sprintId ?? null, 'todo', ticket.order);
						this.render();
					}).open()
				)
			);
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete').setIcon('trash').onClick(async () => {
					await this.plugin.store.deleteTicket(ticket.id);
					this.render();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}

	private sortTickets(tickets: Ticket[]): Ticket[] {
		if (this.sortKey === 'priority') {
			return tickets.sort((a, b) =>
				PRIORITY_ORDER.indexOf(a.priority as TicketPriority) -
				PRIORITY_ORDER.indexOf(b.priority as TicketPriority)
			);
		}
		if (this.sortKey === 'created') {
			return tickets.sort((a, b) => b.createdAt - a.createdAt);
		}
		if (this.sortKey === 'type') {
			return tickets.sort((a, b) => a.type.localeCompare(b.type));
		}
		return tickets;
	}
}
