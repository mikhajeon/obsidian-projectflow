import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ProjectStore } from './store';
import { BoardView, BOARD_VIEW } from './views/BoardView';
import { BacklogView, BACKLOG_VIEW } from './views/BacklogView';
import { SprintPanelView, SPRINT_VIEW } from './views/SprintPanelView';
import { ProjectFlowSettingTab } from './settings';
import { ProjectModal } from './modals/ProjectModal';
import { generateTicketNote, ticketFilePath } from './ticketNote';
import { NoteSyncWatcher } from './noteSyncWatcher';
import type { Ticket } from './types';

export default class ProjectFlowPlugin extends Plugin {
	store!: ProjectStore;

	// Paths currently being written by the plugin — skip sync on these to avoid loops
	writingPaths = new Set<string>();
	// Ticket IDs currently being deleted by the plugin — prevents re-entrant delete on vault 'delete' event
	deletingIds = new Set<string>();

	markWriting(path: string): void {
		this.writingPaths.add(path);
		// Clear the guard after a short window so future user edits still trigger sync
		setTimeout(() => this.writingPaths.delete(path), 2000);
	}

	markDeleting(id: string): void {
		this.deletingIds.add(id);
		setTimeout(() => this.deletingIds.delete(id), 3000);
	}

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
		this.addCommand({
			id: 'undo-ticket',
			name: 'Undo last ticket change',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'z' }],
			callback: async () => {
				const diff = await this.store.undo();
				if (diff) { await this.syncNotesAfterUndoRedo(diff.prev, diff.next); this.refreshAllViews(); new Notice('Undone.'); }
			},
		});
		this.addCommand({
			id: 'redo-ticket',
			name: 'Redo ticket change',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'y' }],
			callback: async () => {
				const diff = await this.store.redo();
				if (diff) { await this.syncNotesAfterUndoRedo(diff.prev, diff.next); this.refreshAllViews(); new Notice('Redone.'); }
			},
		});

		this.addSettingTab(new ProjectFlowSettingTab(this.app, this));

		new NoteSyncWatcher(this).register();
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

	private async syncNotesAfterUndoRedo(prev: Ticket[], next: Ticket[]): Promise<void> {
		const prevMap = new Map(prev.map(t => [t.id, t]));
		const nextMap = new Map(next.map(t => [t.id, t]));

		const toRegenerate: string[] = [];
		const toDelete: Ticket[] = [];

		for (const [id, ticket] of prevMap) {
			if (!nextMap.has(id)) {
				toDelete.push(ticket);
			} else {
				const after = nextMap.get(id)!;
				if (JSON.stringify(ticket) !== JSON.stringify(after)) {
					toRegenerate.push(id);
				}
			}
		}
		for (const [id] of nextMap) {
			if (!prevMap.has(id)) {
				toRegenerate.push(id);
			}
		}

		for (const id of toRegenerate) {
			this.markWriting(ticketFilePath(this, this.store.getProject(this.store.getTicket(id)!.projectId)?.name ?? '', this.store.getTicket(id)!));
			await generateTicketNote(this, id).catch(() => { /* silent */ });
		}

		for (const ticket of toDelete) {
			const project = this.store.getProject(ticket.projectId);
			if (!project) continue;
			const path = ticketFilePath(this, project.name, ticket);
			const file = this.app.vault.getFileByPath(path);
			if (file) {
				this.markWriting(path);
				await this.app.fileManager.trashFile(file).catch(() => { /* silent */ });
			}
		}
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
