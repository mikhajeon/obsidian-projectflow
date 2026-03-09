import { ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Sprint } from '../types';
import { SprintModal } from '../modals/SprintModal';

export const SPRINT_VIEW = 'projectflow-sprint';

export class SprintPanelView extends ItemView {
	private plugin: ProjectFlowPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return SPRINT_VIEW; }
	getDisplayText(): string { return 'Sprints'; }
	getIcon(): string { return 'calendar-range'; }

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
		const sprints = store.getSprints(projectId)
			.sort((a, b) => b.startDate - a.startDate);

		// Header
		const header = container.createEl('div', { cls: 'pf-sprint-header' });
		const titleRow = header.createEl('div', { cls: 'pf-header-row' });
		titleRow.createEl('span', { cls: 'pf-project-label', text: project?.name ?? '' });
		titleRow.createEl('h2', { cls: 'pf-view-title', text: 'Sprints' });

		titleRow.createEl('div', { cls: 'pf-header-actions' })
			.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ New sprint' })
			.addEventListener('click', () =>
				new SprintModal(this.app, this.plugin, projectId, null, () => this.render()).open()
			);

		if (project) {
			header.createEl('p', { cls: 'pf-sprint-cycle-info', text: `Sprint cycle: ${project.cycleDays} days` });
		}

		if (sprints.length === 0) {
			const empty = container.createEl('div', { cls: 'pf-empty-state' });
			empty.createEl('p', { cls: 'pf-empty-title', text: 'No sprints yet.' });
			empty.createEl('p', { cls: 'pf-empty-desc', text: 'Create your first sprint to start tracking work.' });
			return;
		}

		const list = container.createEl('div', { cls: 'pf-sprint-list' });

		for (const sprint of sprints) {
			this.renderSprintCard(list, sprint, projectId);
		}
	}

	private renderSprintCard(container: HTMLElement, sprint: Sprint, projectId: string): void {
		const store = this.plugin.store;
		const progress = store.getSprintProgress(sprint.id);
		const tickets = store.getTickets({ sprintId: sprint.id });

		const card = container.createEl('div', { cls: `pf-sprint-card pf-sprint-${sprint.status}` });

		const cardHeader = card.createEl('div', { cls: 'pf-sprint-card-header' });
		const titleWrap = cardHeader.createEl('div', { cls: 'pf-sprint-title-wrap' });
		titleWrap.createEl('span', { cls: `pf-sprint-status-badge pf-status-${sprint.status}`, text: sprint.status });
		titleWrap.createEl('h3', { cls: 'pf-sprint-name', text: sprint.name });

		const dates = cardHeader.createEl('div', { cls: 'pf-sprint-dates' });
		dates.createEl('span', { text: `${new Date(sprint.startDate).toLocaleDateString()} – ${new Date(sprint.endDate).toLocaleDateString()}` });

		// Progress bar
		const progressWrap = card.createEl('div', { cls: 'pf-sprint-progress-wrap' });
		const bar = progressWrap.createEl('progress', { cls: 'pf-sprint-progress' }) as HTMLProgressElement;
		bar.value = progress.percent;
		bar.max = 100;
		progressWrap.createEl('span', { cls: 'pf-sprint-progress-label', text: `${progress.done} / ${progress.total} done (${progress.percent}%)` });

		// Ticket summary by status
		if (tickets.length > 0) {
			const summary = card.createEl('div', { cls: 'pf-sprint-summary' });
			const counts: Record<string, number> = { todo: 0, 'in-progress': 0, 'in-review': 0, done: 0 };
			for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;

			for (const [status, count] of Object.entries(counts)) {
				if (count > 0) {
					summary.createEl('span', { cls: `pf-mini-badge pf-col-${status.replace('-', '')}`, text: `${count} ${status}` });
				}
			}
		}

		// Actions
		const actions = card.createEl('div', { cls: 'pf-sprint-actions' });

		if (sprint.status === 'planning') {
			actions.createEl('button', { cls: 'pf-btn pf-btn-primary pf-btn-sm', text: 'Start sprint' })
				.addEventListener('click', async () => {
					// Mark any other active sprint complete first
					const active = store.getActiveSprint(projectId);
					if (active && active.id !== sprint.id) {
						await store.updateSprint(active.id, { status: 'completed' });
					}
					await store.updateSprint(sprint.id, { status: 'active' });
					this.render();
					this.plugin.refreshAllViews();
				});
		}

		if (sprint.status === 'active') {
			actions.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Complete sprint' })
				.addEventListener('click', async () => {
					await store.updateSprint(sprint.id, { status: 'completed' });
					this.render();
					this.plugin.refreshAllViews();
				});
		}

		actions.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Edit' })
			.addEventListener('click', () =>
				new SprintModal(this.app, this.plugin, projectId, sprint, () => this.render()).open()
			);

		card.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Edit sprint').setIcon('pencil').onClick(() =>
					new SprintModal(this.app, this.plugin, projectId, sprint, () => this.render()).open()
				)
			);
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete sprint').setIcon('trash').onClick(async () => {
					await store.deleteSprint(sprint.id);
					this.render();
					this.plugin.refreshAllViews();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}
}
