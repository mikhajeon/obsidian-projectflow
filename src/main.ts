import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { ProjectStore } from './store';
import { BoardView, BOARD_VIEW } from './views/BoardView';
import { BacklogView, BACKLOG_VIEW } from './views/BacklogView';
import { SprintPanelView, SPRINT_VIEW } from './views/SprintPanelView';
import { CalendarView, CALENDAR_VIEW } from './views/calendar/CalendarView';
import { NotificationPanelView, NOTIFICATION_VIEW_TYPE } from './views/NotificationPanelView';
import { NotificationManager } from './notifications/NotificationManager';
import { ProjectFlowSettingTab } from './settings';
import { ProjectModal } from './modals/ProjectModal';
import { TicketModal } from './modals/TicketModal';
import { generateTicketNote, deleteTicketNote, ticketFilePath } from './ticketNote';
import { NoteSyncWatcher } from './noteSyncWatcher';
import type { Ticket, TicketPriority, TicketType } from './types';

export default class ProjectFlowPlugin extends Plugin {
	store!: ProjectStore;
	notificationManager: NotificationManager | null = null;

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
		this.store.setTicketDeleteHook(id => deleteTicketNote(this, id));

		this.registerView(BOARD_VIEW, (leaf) => new BoardView(leaf, this));
		this.registerView(BACKLOG_VIEW, (leaf) => new BacklogView(leaf, this));
		this.registerView(SPRINT_VIEW, (leaf) => new SprintPanelView(leaf, this));
		this.registerView(CALENDAR_VIEW, (leaf) => new CalendarView(leaf, this));
		this.registerView(NOTIFICATION_VIEW_TYPE, (leaf) => new NotificationPanelView(leaf, this));

		this.addRibbonIcon('layout-dashboard', 'ProjectFlow board', () =>
			this.activateView(BOARD_VIEW)
		);
		this.addRibbonIcon('calendar-days', 'ProjectFlow calendar flow', () =>
			this.activateView(CALENDAR_VIEW)
		);

		// Notification ribbon icon with badge
		const bellIconEl = this.addRibbonIcon('bell', 'ProjectFlow notifications', () =>
			this.activateView(NOTIFICATION_VIEW_TYPE)
		);
		bellIconEl.style.position = 'relative';
		const badgeEl = bellIconEl.createEl('span', { cls: 'pf-ribbon-badge' });
		badgeEl.style.display = 'none';

		this.notificationManager = new NotificationManager(this);
		this.notificationManager.addBadge(badgeEl);
		this.app.workspace.onLayoutReady(() => {
			this.notificationManager!.start();
		});

		this.addCommand({
			id: 'open-board',
			name: 'Open kanban board',
			callback: () => this.activateView(BOARD_VIEW),
		});
		this.addCommand({
			id: 'open-calendar',
			name: 'Open calendar flow',
			callback: () => this.activateView(CALENDAR_VIEW),
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

		// Calendar navigation commands (also triggered by keyboard in CalendarView)
		this.addCommand({
			id: 'calendar-prev',
			name: 'Calendar: Previous period',
			callback: () => {
				const view = this.app.workspace.getLeavesOfType(CALENDAR_VIEW)[0]?.view;
				if (view instanceof CalendarView) (view as any).navigatePrev?.();
			},
		});
		this.addCommand({
			id: 'calendar-next',
			name: 'Calendar: Next period',
			callback: () => {
				const view = this.app.workspace.getLeavesOfType(CALENDAR_VIEW)[0]?.view;
				if (view instanceof CalendarView) (view as any).navigateNext?.();
			},
		});
		this.addCommand({
			id: 'calendar-today',
			name: 'Calendar: Jump to today',
			callback: () => {
				const view = this.app.workspace.getLeavesOfType(CALENDAR_VIEW)[0]?.view;
				if (view instanceof CalendarView) (view as any).navigateToday?.();
			},
		});

		this.addSettingTab(new ProjectFlowSettingTab(this.app, this));

		new NoteSyncWatcher(this).register();

		this.app.workspace.onLayoutReady(() => {
			this.recaptureOrphanedNotes().catch(() => { /* silent */ });
		});
	}

	async onunload(): Promise<void> {
		this.notificationManager?.stop();
		this.app.workspace.detachLeavesOfType(BOARD_VIEW);
		this.app.workspace.detachLeavesOfType(BACKLOG_VIEW);
		this.app.workspace.detachLeavesOfType(SPRINT_VIEW);
		this.app.workspace.detachLeavesOfType(CALENDAR_VIEW);
		this.app.workspace.detachLeavesOfType(NOTIFICATION_VIEW_TYPE);
	}

	openTicketModal(ticket: Ticket): void {
		new TicketModal(this.app, this, { ticket, sprintId: ticket.sprintId }, () => this.refreshAllViews()).open();
	}

	refreshNotificationPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(NOTIFICATION_VIEW_TYPE)) {
			const view = leaf.view as NotificationPanelView;
			view.render();
		}
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

	/**
	 * On startup, scan all markdown files under the project base folder.
	 * Any file whose frontmatter `id` is not found in the store is re-imported
	 * as a ticket. This recovers tickets whose store entry was lost while their
	 * note file survived (e.g. after a data.json reset or partial migration).
	 */
	private async recaptureOrphanedNotes(): Promise<void> {
		const { vault, metadataCache } = this.app;
		const baseFolder = this.store.getBaseFolder();
		const prefix = baseFolder + '/';

		const files = vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));

		const validStatuses  = new Set(['todo', 'in-progress', 'in-review', 'done']);
		const validPriorities = new Set<TicketPriority>(['low', 'medium', 'high', 'critical']);
		const validTypes      = new Set<TicketType>(['task', 'bug', 'story', 'epic', 'subtask']);

		let restored = 0;

		for (const file of files) {
			const fm = metadataCache.getFileCache(file)?.frontmatter;
			if (!fm?.id) continue;

			const ticketId = String(fm.id);
			if (this.store.getTicket(ticketId)) continue;  // already in store

			// Resolve project by name
			const projectName = typeof fm.project === 'string' ? fm.project.trim() : '';
			if (!projectName) continue;
			const project = this.store.getAllProjects().find(p => p.name === projectName);
			if (!project || project.archived) continue;

			// Parse ticket number from key field (e.g. "DBA-42" → 42)
			const keyMatch = typeof fm.key === 'string' ? /^[^-]+-(\d+)$/.exec(fm.key) : null;
			const ticketNumber = keyMatch ? parseInt(keyMatch[1], 10) : 0;
			if (!ticketNumber) continue;

			// Resolve sprint by name (null = product backlog)
			let sprintId: string | null = null;
			if (typeof fm.sprint === 'string' && fm.sprint !== 'Backlog') {
				const sprint = this.store.getSprints(project.id).find(s => s.name === fm.sprint);
				if (sprint) sprintId = sprint.id;
			}

			// Parse body for description
			let description = '';
			try {
				const content = await vault.read(file);
				const fmEnd = content.indexOf('\n---\n', content.indexOf('---')) + 5;
				const body = fmEnd > 4 ? content.slice(fmEnd) : '';
				const nextSection = body.search(/^##\s/m);
				description = (nextSection === -1 ? body : body.slice(0, nextSection)).trim();
			} catch { /* silent */ }

			const status     = validStatuses.has(fm.status)     ? fm.status     : 'todo';
			const priority   = validPriorities.has(fm.priority) ? fm.priority as TicketPriority : 'medium';
			const type       = validTypes.has(fm.type)          ? fm.type as TicketType : 'task';
			const points: number | undefined =
				typeof fm.points === 'number' && fm.points >= 0 ? Math.round(fm.points) : undefined;

			const createdAt = fm.created ? new Date(String(fm.created)).getTime() || Date.now() : Date.now();
			const updatedAt = fm.updated ? new Date(String(fm.updated)).getTime() || Date.now() : Date.now();

			const ticket: Ticket = {
				id: ticketId,
				projectId: project.id,
				sprintId,
				title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : file.basename,
				description,
				status,
				priority,
				type,
				createdAt,
				updatedAt,
				order: ticketNumber,
				backlogOrder: ticketNumber,
				ticketNumber,
				points,
			};

			await this.store.restoreTicketRaw(ticket);
			restored++;
		}

		if (restored > 0) {
			new Notice(`ProjectFlow: recaptured ${restored} ticket${restored !== 1 ? 's' : ''} from notes.`);
			this.refreshAllViews();
		}
	}

	refreshAllViews(): void {
		const types = [BOARD_VIEW, BACKLOG_VIEW, SPRINT_VIEW, CALENDAR_VIEW, NOTIFICATION_VIEW_TYPE];
		for (const type of types) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view as { refresh?: () => void };
				view.refresh?.();
			}
		}
		this.notificationManager?.updateBadge();
	}
}
