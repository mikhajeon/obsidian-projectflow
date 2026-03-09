import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ProjectStore } from './store';
import { BoardView, BOARD_VIEW } from './views/BoardView';
import { BacklogView, BACKLOG_VIEW } from './views/BacklogView';
import { SprintPanelView, SPRINT_VIEW } from './views/SprintPanelView';
import { ProjectFlowSettingTab } from './settings';
import { ProjectModal } from './modals/ProjectModal';

export default class ProjectFlowPlugin extends Plugin {
	store!: ProjectStore;

	async onload(): Promise<void> {
		this.store = new ProjectStore(this);
		await this.store.load();

		this.registerView(BOARD_VIEW, (leaf) => new BoardView(leaf, this));
		this.registerView(BACKLOG_VIEW, (leaf) => new BacklogView(leaf, this));
		this.registerView(SPRINT_VIEW, (leaf) => new SprintPanelView(leaf, this));

		this.addRibbonIcon('layout-dashboard', 'ProjectFlow board', () =>
			this.activateView(BOARD_VIEW)
		);

		this.addCommand({
			id: 'open-board',
			name: 'Open kanban board',
			callback: () => this.activateView(BOARD_VIEW),
		});
		this.addCommand({
			id: 'open-backlog',
			name: 'Open backlog',
			callback: () => this.activateView(BACKLOG_VIEW),
		});
		this.addCommand({
			id: 'open-sprints',
			name: 'Open sprint panel',
			callback: () => this.activateView(SPRINT_VIEW),
		});
		this.addCommand({
			id: 'new-project',
			name: 'New project',
			callback: () =>
				new ProjectModal(this.app, this, null, () => this.refreshAllViews()).open(),
		});

		this.addSettingTab(new ProjectFlowSettingTab(this.app, this));
	}

	async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(BOARD_VIEW);
		this.app.workspace.detachLeavesOfType(BACKLOG_VIEW);
		this.app.workspace.detachLeavesOfType(SPRINT_VIEW);
	}

	async activateView(viewType: string): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(viewType)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf(false);
			if (leaf) await leaf.setViewState({ type: viewType, active: true });
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	refreshAllViews(): void {
		const types = [BOARD_VIEW, BACKLOG_VIEW, SPRINT_VIEW];
		for (const type of types) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view as { refresh?: () => void };
				view.refresh?.();
			}
		}
	}
}
