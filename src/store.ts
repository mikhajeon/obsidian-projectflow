import type ProjectFlowPlugin from './main';
import type { AppData, Project, Sprint, Ticket, TicketStatus, StoredNotification, NotificationSettings, ProjectNotificationSettings, CalendarCardAppearance, CalendarViewAppearance, BoardCardAppearance } from './types';
import { DEFAULT_DATA, DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_CALENDAR_CARD_APPEARANCE, DEFAULT_BOARD_CARD_APPEARANCE } from './types';
import { migrateAppData, defaultTagFromName } from './store/migrate';
import { type StatusDefinition, DEFAULT_STATUSES } from './statusConfig';

export { defaultTagFromName };

export class ProjectStore {
	private plugin: ProjectFlowPlugin;
	private data: AppData;
	private undoStack: Ticket[][] = [];
	private redoStack: Ticket[][] = [];
	private static readonly MAX_UNDO = 50;
	private ticketDeleteHook: ((ticketId: string) => Promise<void>) | null = null;

	setTicketDeleteHook(fn: (ticketId: string) => Promise<void>): void {
		this.ticketDeleteHook = fn;
	}

	constructor(plugin: ProjectFlowPlugin) {
		this.plugin = plugin;
		this.data = { ...DEFAULT_DATA };
	}

	private snapshotTickets(): void {
		this.undoStack.push(this.data.tickets.map(t => ({ ...t })));
		if (this.undoStack.length > ProjectStore.MAX_UNDO) this.undoStack.shift();
		this.redoStack = [];
	}

	canUndo(): boolean { return this.undoStack.length > 0; }
	canRedo(): boolean { return this.redoStack.length > 0; }

	async undo(): Promise<{ prev: Ticket[]; next: Ticket[] } | null> {
		if (this.undoStack.length === 0) return null;
		const prev = this.data.tickets.map(t => ({ ...t }));
		this.redoStack.push(prev);
		this.data.tickets = this.undoStack.pop()!;
		await this.save();
		return { prev, next: this.data.tickets };
	}

	async redo(): Promise<{ prev: Ticket[]; next: Ticket[] } | null> {
		if (this.redoStack.length === 0) return null;
		const prev = this.data.tickets.map(t => ({ ...t }));
		this.undoStack.push(prev);
		this.data.tickets = this.redoStack.pop()!;
		await this.save();
		return { prev, next: this.data.tickets };
	}

	async load(): Promise<void> {
		const saved = await this.plugin.loadData() as Partial<AppData & { sprintHistoryFolder?: string; ticketsFolder?: string }> | null;
		this.data = migrateAppData(saved);
	}

	private async save(): Promise<void> {
		await this.plugin.saveData(this.data);
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	// ── Projects ──────────────────────────────────────────────────────────────

	getProjects(): Project[] {
		return this.data.projects.filter(p => !p.archived);
	}

	getAllProjects(): Project[] {
		return this.data.projects;
	}

	getArchivedProjects(): Project[] {
		return this.data.projects
			.filter(p => p.archived)
			.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
	}

	getProject(id: string): Project | undefined {
		return this.data.projects.find(p => p.id === id);
	}

	async archiveProject(id: string): Promise<void> {
		const idx = this.data.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		this.data.projects[idx] = { ...this.data.projects[idx], archived: true, archivedAt: Date.now() };
		if (this.data.activeProjectId === id) {
			this.data.activeProjectId = this.data.projects.find(p => !p.archived)?.id ?? null;
		}
		await this.save();
	}

	async unarchiveProject(id: string): Promise<void> {
		const idx = this.data.projects.findIndex(p => p.id === id);
		if (idx === -1) return;
		const { archived: _a, archivedAt: _b, ...rest } = this.data.projects[idx];
		this.data.projects[idx] = rest as Project;
		await this.save();
	}

	getActiveProjectId(): string | null {
		return this.data.activeProjectId;
	}

	getActiveProject(): Project | undefined {
		if (!this.data.activeProjectId) return undefined;
		return this.getProject(this.data.activeProjectId);
	}

	async setActiveProject(id: string | null): Promise<void> {
		this.data.activeProjectId = id;
		await this.save();
	}

	getBaseFolder(): string {
		return this.data.baseFolder;
	}

	async setBaseFolder(folder: string): Promise<void> {
		this.data.baseFolder = folder;
		await this.save();
	}

	async createProject(data: Omit<Project, 'id' | 'createdAt' | 'ticketCounter'>): Promise<Project> {
		const project: Project = { ...data, id: this.generateId(), createdAt: Date.now(), ticketCounter: 0 };
		this.data.projects.push(project);
		if (!this.data.activeProjectId) {
			this.data.activeProjectId = project.id;
		}
		await this.save();
		return project;
	}

	async updateProject(id: string, data: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void> {
		const idx = this.data.projects.findIndex(p => p.id === id);
		if (idx !== -1) {
			this.data.projects[idx] = { ...this.data.projects[idx], ...data };
			await this.save();
		}
	}

	getProjectStatuses(projectId: string): StatusDefinition[] {
		return this.getProject(projectId)?.statuses ?? DEFAULT_STATUSES.map(s => ({ ...s }));
	}

	async setProjectStatuses(projectId: string, statuses: StatusDefinition[]): Promise<void> {
		await this.updateProject(projectId, { statuses });
	}

	async setAllTicketsShowOnBoard(projectId: string, showOnBoard: boolean): Promise<void> {
		const now = Date.now();
		this.data.tickets = this.data.tickets.map(t =>
			t.projectId === projectId && !t.archived && t.sprintId != null
				? { ...t, showOnBoard, updatedAt: now }
				: t
		);
		await this.save();
	}

	/**
	 * Called when switching a project from sprint mode to no-sprint mode.
	 * Sprint tickets (sprintId != null) get showOnBoard: true and are unassigned
	 * from their sprint so they appear in board and backlog views.
	 * Product-backlog tickets (sprintId === null) are left untouched.
	 */
	async migrateTicketsToNoSprint(projectId: string): Promise<void> {
		const now = Date.now();
		this.data.tickets = this.data.tickets.map(t =>
			t.projectId === projectId && !t.archived && t.sprintId != null
				? { ...t, showOnBoard: true, sprintId: null, updatedAt: now }
				: t
		);
		await this.save();
	}

	/**
	 * Restores a complete ticket object directly into the store (used for
	 * startup recapture of orphaned note files). Does not auto-generate id
	 * or ticketNumber — those come from the note's frontmatter.
	 */
	async restoreTicketRaw(ticket: Ticket): Promise<void> {
		this.data.tickets.push(ticket);
		// Ensure ticketCounter never falls below a restored ticket's number
		const projIdx = this.data.projects.findIndex(p => p.id === ticket.projectId);
		if (projIdx !== -1 && (ticket.ticketNumber ?? 0) > this.data.projects[projIdx].ticketCounter) {
			this.data.projects[projIdx].ticketCounter = ticket.ticketNumber;
		}
		await this.save();
	}

	/** Returns all tickets for a project regardless of archived state. Used for file cleanup on project delete. */
	getAllTicketsForProject(projectId: string): Ticket[] {
		return this.data.tickets.filter(t => t.projectId === projectId);
	}

	async deleteProject(id: string): Promise<void> {
		this.data.projects = this.data.projects.filter(p => p.id !== id);
		this.data.sprints = this.data.sprints.filter(s => s.projectId !== id);
		this.data.tickets = this.data.tickets.filter(t => t.projectId !== id);
		if (this.data.activeProjectId === id) {
			this.data.activeProjectId = this.data.projects.find(p => !p.archived)?.id ?? null;
		}
		await this.save();
	}

	// ── Sprints ───────────────────────────────────────────────────────────────

	getSprints(projectId?: string): Sprint[] {
		return projectId
			? this.data.sprints.filter(s => s.projectId === projectId)
			: this.data.sprints;
	}

	getSprint(id: string): Sprint | undefined {
		return this.data.sprints.find(s => s.id === id);
	}

	getActiveSprint(projectId: string): Sprint | undefined {
		return this.data.sprints.find(s => s.projectId === projectId && s.status === 'active');
	}

	async createSprint(data: Omit<Sprint, 'id'>): Promise<Sprint> {
		const sprint: Sprint = { ...data, id: this.generateId() };
		this.data.sprints.push(sprint);
		await this.save();
		return sprint;
	}

	async updateSprint(id: string, data: Partial<Omit<Sprint, 'id'>>): Promise<void> {
		const idx = this.data.sprints.findIndex(s => s.id === id);
		if (idx !== -1) {
			this.data.sprints[idx] = { ...this.data.sprints[idx], ...data };
			await this.save();
		}
	}

	async deleteSprint(id: string): Promise<void> {
		this.data.sprints = this.data.sprints.filter(s => s.id !== id);
		this.data.tickets = this.data.tickets.map(t =>
			t.sprintId === id ? { ...t, sprintId: null, status: 'todo' as TicketStatus } : t
		);
		await this.save();
	}

	// ── Tickets ───────────────────────────────────────────────────────────────

	getTickets(filter?: { projectId?: string; sprintId?: string | null }): Ticket[] {
		let tickets = this.data.tickets.filter(t => !t.archived);
		if (filter?.projectId !== undefined) {
			tickets = tickets.filter(t => t.projectId === filter.projectId);
		}
		if (filter?.sprintId !== undefined) {
			tickets = tickets.filter(t => t.sprintId === filter.sprintId);
		}
		return tickets.sort((a, b) => a.order - b.order);
	}

	getArchivedTickets(projectId: string): Ticket[] {
		return this.data.tickets
			.filter(t => t.archived && t.projectId === projectId)
			.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
	}

	async archiveTicket(id: string): Promise<void> {
		this.snapshotTickets();
		const now = Date.now();
		// Archive the ticket and all its descendants
		const toArchive = new Set([id, ...this.getDescendantIds(id)]);
		this.data.tickets = this.data.tickets.map(t =>
			toArchive.has(t.id) ? { ...t, archived: true, archivedAt: now, updatedAt: now } : t
		);
		await this.save();
	}

	async unarchiveTicket(id: string): Promise<void> {
		this.snapshotTickets();
		const now = Date.now();
		// Unarchive only this ticket (not descendants — they have their own archived state)
		const idx = this.data.tickets.findIndex(t => t.id === id);
		if (idx !== -1) {
			const t = this.data.tickets[idx];
			this.data.tickets[idx] = { ...t, archived: false, archivedAt: undefined, updatedAt: now };
		}
		await this.save();
	}

	async bulkArchiveTickets(ids: string[]): Promise<void> {
		this.snapshotTickets();
		const now = Date.now();
		const toArchive = new Set<string>();
		for (const id of ids) {
			toArchive.add(id);
			for (const descId of this.getDescendantIds(id)) toArchive.add(descId);
		}
		this.data.tickets = this.data.tickets.map(t =>
			toArchive.has(t.id) ? { ...t, archived: true, archivedAt: now, updatedAt: now } : t
		);
		await this.save();
	}

	async migrateTicketStatus(projectId: string, fromStatusId: string, toStatusId: string): Promise<void> {
		const now = Date.now();
		let changed = false;
		this.data.tickets = this.data.tickets.map(t => {
			if (t.projectId === projectId && t.status === fromStatusId && !t.archived) {
				changed = true;
				return { ...t, status: toStatusId, updatedAt: now };
			}
			return t;
		});
		if (changed) await this.save();
	}

	async archiveDoneTicketsInSprint(sprintId: string): Promise<void> {
		const done = this.data.tickets.filter(t => t.sprintId === sprintId && t.status === 'done' && !t.archived);
		if (done.length === 0) return;
		await this.bulkArchiveTickets(done.map(t => t.id));
	}

	getProjectAutoArchiveDone(projectId: string): boolean {
		return this.getProject(projectId)?.autoArchiveDone === true;
	}

	getProjectBoardPriorityEdges(projectId: string): boolean {
		return this.getProject(projectId)?.boardPriorityEdges !== false; // default true
	}

	getTicket(id: string): Ticket | undefined {
		return this.data.tickets.find(t => t.id === id);
	}

	async createTicket(data: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'backlogOrder' | 'ticketNumber'>): Promise<Ticket> {
		this.snapshotTickets();
		const existing = this.getTickets({ projectId: data.projectId, sprintId: data.sprintId });
		const maxOrder = existing.reduce((max, t) => Math.max(max, t.order), -1);
		const maxBacklogOrder = existing.reduce((max, t) => Math.max(max, t.backlogOrder ?? -1), -1);

		// Increment the project's ticket counter to get a new sequential number
		const projIdx = this.data.projects.findIndex(p => p.id === data.projectId);
		const ticketNumber = projIdx !== -1
			? ++this.data.projects[projIdx].ticketCounter
			: 1;

		const ticket: Ticket = {
			...data,
			id: this.generateId(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			order: maxOrder + 1,
			backlogOrder: maxBacklogOrder + 1,
			ticketNumber,
		};
		this.data.tickets.push(ticket);
		await this.save();
		return ticket;
	}

	async updateTicket(id: string, data: Partial<Omit<Ticket, 'id' | 'createdAt'>>): Promise<void> {
		this.snapshotTickets();
		const idx = this.data.tickets.findIndex(t => t.id === id);
		if (idx !== -1) {
			const existing = this.data.tickets[idx];
			const completedAt = data.status === 'done' && existing.status !== 'done'
				? Date.now()
				: data.status !== undefined && data.status !== 'done'
					? undefined
					: existing.completedAt;
			this.data.tickets[idx] = { ...existing, ...data, updatedAt: Date.now(), completedAt };
			await this.save();
		}
	}

	async deleteTicket(id: string): Promise<void> {
		const toRemove = new Set([id, ...this.getDescendantIds(id)]);
		// Delete associated notes before removing from store (lookup still works)
		if (this.ticketDeleteHook) {
			for (const ticketId of toRemove) {
				await this.ticketDeleteHook(ticketId).catch(() => {});
			}
		}
		this.snapshotTickets();
		this.data.tickets = this.data.tickets.filter(t => !toRemove.has(t.id));
		// Dismiss any notifications tied to the deleted tickets
		if (this.data.notifications) {
			this.data.notifications = this.data.notifications.filter(
				n => !n.ticketId || !toRemove.has(n.ticketId)
			);
		}
		await this.save();
	}

	async moveTicket(id: string, sprintId: string | null, status: TicketStatus, order: number): Promise<void> {
		await this.updateTicket(id, { sprintId, status, order });
	}

	async reorderTicket(id: string, newParentId: string | null, beforeId: string | null): Promise<void> {
		const ticket = this.getTicket(id);
		if (!ticket) return;
		this.snapshotTickets();

		// Hierarchy enforcement
		if (newParentId !== null) {
			const parent = this.getTicket(newParentId);
			if (!parent) return;
			if (parent.type === 'story' || parent.type === 'task' || parent.type === 'bug') {
				if (ticket.type !== 'subtask') return; // only subtasks under task/story/bug
			} else if (parent.type === 'epic') {
				if (ticket.type === 'epic' || ticket.type === 'subtask') return; // only story/task/bug under epic
			} else {
				return; // subtask cannot be a parent
			}
		} else {
			if (ticket.type === 'subtask') return; // subtasks must always have a parent
		}

		// Collect siblings: same projectId, same newParentId, excluding the moved ticket
		// For epics (top-level, type=epic), scope siblings to epics only to avoid mixing with unparented tickets
		const siblings = this.data.tickets
			.filter(t => {
				if (t.id === id) return false;
				if (t.projectId !== ticket.projectId) return false;
				if ((t.parentId ?? null) !== newParentId) return false;
				if (ticket.type === 'epic') return t.type === 'epic';
				return true;
			})
			.sort((a, b) => a.order - b.order);

		// Find insert index
		let insertIdx = siblings.length; // default: append
		if (beforeId !== null) {
			const idx = siblings.findIndex(t => t.id === beforeId);
			if (idx !== -1) insertIdx = idx;
		}

		// Insert moved ticket at that index
		siblings.splice(insertIdx, 0, ticket);

		// Reassign sequential order values and update parentId
		for (let i = 0; i < siblings.length; i++) {
			const t = siblings[i];
			const ticketIdx = this.data.tickets.findIndex(x => x.id === t.id);
			if (ticketIdx !== -1) {
				this.data.tickets[ticketIdx] = {
					...this.data.tickets[ticketIdx],
					order: i,
					parentId: t.id === id ? newParentId : this.data.tickets[ticketIdx].parentId,
					updatedAt: t.id === id ? Date.now() : this.data.tickets[ticketIdx].updatedAt,
				};
			}
		}

		await this.save();
	}

	async reorderBacklogTicket(id: string, sprintId: string | null, beforeId: string | null): Promise<void> {
		const ticket = this.getTicket(id);
		if (!ticket) return;
		this.snapshotTickets();

		// Collect all backlog-visible siblings in the same sprint bucket, excluding moved ticket
		const siblings = this.data.tickets
			.filter(t => t.id !== id && t.projectId === ticket.projectId && (t.sprintId ?? null) === sprintId)
			.sort((a, b) => (a.backlogOrder ?? 0) - (b.backlogOrder ?? 0));

		// Find insert index
		let insertIdx = siblings.length;
		if (beforeId !== null) {
			const idx = siblings.findIndex(t => t.id === beforeId);
			if (idx !== -1) insertIdx = idx;
		}

		siblings.splice(insertIdx, 0, ticket);

		for (let i = 0; i < siblings.length; i++) {
			const t = siblings[i];
			const ticketIdx = this.data.tickets.findIndex(x => x.id === t.id);
			if (ticketIdx !== -1) {
				this.data.tickets[ticketIdx] = {
					...this.data.tickets[ticketIdx],
					backlogOrder: i,
				};
			}
		}

		await this.save();
	}

	getChildTickets(parentId: string, includeArchived = false): Ticket[] {
		return this.data.tickets
			.filter(t => t.parentId === parentId && (includeArchived || !t.archived))
			.sort((a, b) => a.order - b.order);
	}

	getEpics(projectId: string): Ticket[] {
		return this.data.tickets
			.filter(t => t.projectId === projectId && t.type === 'epic' && !t.archived)
			.sort((a, b) => a.order - b.order);
	}

	getDescendantIds(parentId: string): string[] {
		const ids: string[] = [];
		const children = this.getChildTickets(parentId, true); // include archived for cascade ops
		for (const child of children) {
			ids.push(child.id);
			ids.push(...this.getDescendantIds(child.id));
		}
		return ids;
	}

	getUnparentedTickets(projectId: string): Ticket[] {
		return this.data.tickets
			.filter(t => t.projectId === projectId && t.type !== 'epic' && t.type !== 'subtask' && !t.parentId && !t.archived)
			.sort((a, b) => a.order - b.order);
	}

	// ── Column widths ─────────────────────────────────────────────────────────

	getColWidths(viewKey: string): Record<string, number> {
		return this.data.colWidths?.[viewKey] ?? {};
	}

	async setColWidths(viewKey: string, widths: Record<string, number>): Promise<void> {
		if (!this.data.colWidths) this.data.colWidths = {};
		this.data.colWidths[viewKey] = widths;
		await this.save();
	}

	// ── Tab order ─────────────────────────────────────────────────────────────

	getTabOrder(): string[] {
		return this.data.tabOrder ?? ['board', 'parent', 'backlog', 'list'];
	}

	async setTabOrder(order: string[]): Promise<void> {
		this.data.tabOrder = order;
		await this.save();
	}

	// ── Sort orders ───────────────────────────────────────────────────────────

	getSortOrder(viewKey: string): string {
		return this.data.sortOrders?.[viewKey] ?? 'manual';
	}

	async setSortOrder(viewKey: string, field: string): Promise<void> {
		if (!this.data.sortOrders) this.data.sortOrders = {};
		this.data.sortOrders[viewKey] = field;
		await this.save();
	}

	// ── Board grouping ────────────────────────────────────────────────────────

	getBoardGrouping(): string {
		return this.data.boardGrouping ?? 'default';
	}

	async setBoardGrouping(value: string): Promise<void> {
		this.data.boardGrouping = value;
		await this.save();
	}

	// ── Hidden board columns ──────────────────────────────────────────────────

	getHiddenBoardColumns(projectId: string): string[] {
		return this.data.hiddenBoardColumns?.[projectId] ?? [];
	}

	async setHiddenBoardColumns(projectId: string, ids: string[]): Promise<void> {
		if (!this.data.hiddenBoardColumns) this.data.hiddenBoardColumns = {};
		this.data.hiddenBoardColumns[projectId] = ids;
		await this.save();
	}

	// ── Collapsed board columns ──────────────────────────────────────────────

	getCollapsedBoardColumns(projectId: string): string[] {
		return this.data.collapsedBoardColumns?.[projectId] ?? [];
	}

	async setCollapsedBoardColumns(projectId: string, ids: string[]): Promise<void> {
		if (!this.data.collapsedBoardColumns) this.data.collapsedBoardColumns = {};
		this.data.collapsedBoardColumns[projectId] = ids;
		await this.save();
	}

	// ── Board column width ────────────────────────────────────────────────────

	getBoardColWidth(viewKey: string): number {
		return this.data.boardColWidth?.[viewKey] ?? 240;
	}

	async setBoardColWidth(viewKey: string, width: number): Promise<void> {
		if (!this.data.boardColWidth) this.data.boardColWidth = {};
		this.data.boardColWidth[viewKey] = width;
		await this.save();
	}

	// ── Calendar project selection ────────────────────────────────────────────

	getCalendarProjectIds(): string[] | null {
		return this.data.calendarProjectIds ?? null;
	}

	async setCalendarProjectIds(ids: string[]): Promise<void> {
		this.data.calendarProjectIds = ids;
		await this.save();
	}

	// ── Calendar card appearance ──────────────────────────────────────────────

	getCalendarCardAppearance(): CalendarViewAppearance {
		const d = DEFAULT_CALENDAR_CARD_APPEARANCE;
		const stored = this.data.calendarCardAppearance ?? {};
		return {
			month:  { ...d, ...stored.month },
			week:   { ...d, ...stored.week },
			day:    { ...d, ...stored.day },
			agenda: { ...d, ...stored.agenda },
		};
	}

	async setCalendarCardAppearance(appearance: CalendarViewAppearance): Promise<void> {
		this.data.calendarCardAppearance = appearance;
		await this.save();
	}

	getBoardCardAppearance(): BoardCardAppearance {
		return { ...DEFAULT_BOARD_CARD_APPEARANCE, ...this.data.boardCardAppearance };
	}

	async setBoardCardAppearance(appearance: BoardCardAppearance): Promise<void> {
		this.data.boardCardAppearance = appearance;
		await this.save();
	}

	// ── Filter states ─────────────────────────────────────────────────────────

	getFilterState(viewKey: string): { type: string; priority: string; status: string; hasSubtasks?: boolean } {
		return this.data.filterStates?.[viewKey] ?? { type: 'all', priority: 'all', status: 'all' };
	}

	async setFilterState(viewKey: string, state: { type: string; priority: string; status: string; hasSubtasks?: boolean }): Promise<void> {
		if (!this.data.filterStates) this.data.filterStates = {};
		this.data.filterStates[viewKey] = state;
		await this.save();
	}

	// ── Derived ───────────────────────────────────────────────────────────────

	getSprintProgress(sprintId: string): { total: number; done: number; percent: number } {
		const tickets = this.getTickets({ sprintId });
		const total = tickets.length;
		const done = tickets.filter(t => t.status === 'done').length;
		return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
	}

	// ── Per-project sprint settings ───────────────────────────────────────────

	getProjectUseSprints(projectId: string): boolean {
		const project = this.getProject(projectId);
		return project?.useSprints !== false; // default true
	}

	getProjectAutoCreate(projectId: string): boolean {
		return this.getProject(projectId)?.autoCreateSprint === true; // default false
	}

	getProjectAutoSpillover(projectId: string): boolean {
		return this.getProject(projectId)?.autoSpillover === true; // default false
	}

	// ── Notification settings ─────────────────────────────────────────────────

	getNotificationSettings(): NotificationSettings {
		return this.data.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
	}

	async saveNotificationSettings(settings: NotificationSettings): Promise<void> {
		this.data.notificationSettings = settings;
		await this.save();
	}

	getProjectNotificationSettings(projectId: string): ProjectNotificationSettings {
		return this.getProject(projectId)?.notificationSettings ?? { useGlobal: true, triggers: {} };
	}

	async saveProjectNotificationSettings(projectId: string, settings: ProjectNotificationSettings): Promise<void> {
		const project = this.getProject(projectId);
		if (!project) return;
		project.notificationSettings = settings;
		await this.save();
	}

	// ── Notification CRUD ─────────────────────────────────────────────────────

	getNotifications(): StoredNotification[] {
		return this.data.notifications ?? [];
	}

	async addNotification(notification: StoredNotification): Promise<void> {
		if (!this.data.notifications) this.data.notifications = [];
		this.data.notifications.push(notification);
		await this.save();
	}

	async updateNotification(id: string, patch: Partial<StoredNotification>): Promise<void> {
		if (!this.data.notifications) return;
		const n = this.data.notifications.find(n => n.id === id);
		if (n) Object.assign(n, patch);
		await this.save();
	}

	async clearDismissed(): Promise<void> {
		if (!this.data.notifications) return;
		this.data.notifications = this.data.notifications.filter(n => !n.dismissed);
		await this.save();
	}

}
