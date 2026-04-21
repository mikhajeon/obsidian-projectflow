import { TFile } from 'obsidian';
import type ProjectFlowPlugin from './main';
import type { TicketStatus, TicketPriority } from './types';
import { generateTicketNote, ticketFilePath } from './ticketNote';

/**
 * How the deferred-merge strategy works
 * ──────────────────────────────────────
 * When a ticket note is modified externally (user typing in the Obsidian editor)
 * we do NOT merge immediately. Instead we start a 10-second idle countdown.
 * The countdown is reset on every subsequent `modify` event for the same file.
 *
 * The sync fires early (before 10 s) if any of these happen:
 *   • The user switches to a different note/leaf (active-leaf-change)
 *   • The document/tab becomes hidden (visibilitychange → hidden)
 *   • The Obsidian window loses focus (window blur)
 *
 * This prevents mid-keystroke merges that would interrupt the user while they
 * are still editing the note.
 */
export class NoteSyncWatcher {
	private plugin: ProjectFlowPlugin;

	/** Per-path idle timers (10 s countdown). */
	private idleTimers   = new Map<string, ReturnType<typeof setTimeout>>();
	/** Per-path pending-sync flags (set after first modify, cleared after sync). */
	private pendingPaths = new Set<string>();

	/** Cached path of the note that was open when a modify was registered. */
	private activeNotePath: string | null = null;

	/** Unregistration callbacks for document/window listeners we add manually. */
	private cleanupListeners: (() => void)[] = [];

	constructor(plugin: ProjectFlowPlugin) {
		this.plugin = plugin;
	}

	register(): void {
		const { plugin } = this;

		// ── 1. vault:modify — queue the file and (re)start idle countdown ─────
		plugin.registerEvent(
			plugin.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				if (!file.path.startsWith(baseFolder + '/')) return;
				if (plugin.writingPaths.has(file.path)) return;

				// Remember which note is being edited so we can flush on leaf change
				this.activeNotePath = file.path;
				this.scheduleIdleSync(file.path);
			})
		);

		// ── 2. workspace:active-leaf-change — flush if user left the note ─────
		plugin.registerEvent(
			plugin.app.workspace.on('active-leaf-change', () => {
				const openFile = plugin.app.workspace.getActiveFile();
				const newPath  = openFile?.path ?? null;

				// If the newly active file is different from the one being edited,
				// immediately flush any pending sync for the old note.
				if (this.activeNotePath && newPath !== this.activeNotePath) {
					this.flushPath(this.activeNotePath);
					this.activeNotePath = newPath;
				} else {
					this.activeNotePath = newPath;
				}
			})
		);

		// ── 3. vault:rename ──────────────────────────────────────────────────
		plugin.registerEvent(
			plugin.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				const prefix = baseFolder + '/';

				if (plugin.writingPaths.has(file.path) || plugin.writingPaths.has(oldPath)) return;

				const movedInto = file.path.startsWith(prefix);
				const movedFrom = oldPath.startsWith(prefix);

				if (movedFrom && !movedInto) {
					const fm = plugin.app.metadataCache.getCache(oldPath)?.frontmatter;
					if (!fm?.id) return;
					const ticketId = String(fm.id);
					if (plugin.deletingIds.has(ticketId)) return;
					const ticket = plugin.store.getTicket(ticketId);
					if (!ticket) return;
					plugin.store.deleteTicket(ticketId)
						.then(() => plugin.refreshAllViews())
						.catch(() => { /* silent */ });
					return;
				}

				if (!movedInto) return;

				// Short debounce for renames (metadataCache may not have updated yet)
				const existing = this.idleTimers.get(file.path);
				if (existing) clearTimeout(existing);
				const timer = setTimeout(() => {
					this.idleTimers.delete(file.path);
					this.syncRenameToStore(file, oldPath).catch(() => { /* silent */ });
				}, 500);
				this.idleTimers.set(file.path, timer);
			})
		);

		// ── 4. vault:delete ──────────────────────────────────────────────────
		plugin.registerEvent(
			plugin.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				if (!file.path.startsWith(baseFolder + '/')) return;

				const fm = plugin.app.metadataCache.getCache(file.path)?.frontmatter;
				if (!fm?.id) return;
				const ticketId = String(fm.id);
				if (plugin.deletingIds.has(ticketId)) return;

				const ticket = plugin.store.getTicket(ticketId);
				if (!ticket) return;

				// Cancel any pending sync for this file — it no longer exists
				this.cancelPath(file.path);

				plugin.store.deleteTicket(ticketId)
					.then(() => plugin.refreshAllViews())
					.catch(() => { /* silent */ });
			})
		);

		// ── 5. Document/window listeners for "user left the page" ────────────
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') this.flushAll();
		};
		const onBlur = () => this.flushAll();

		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('blur', onBlur);

		this.cleanupListeners.push(
			() => document.removeEventListener('visibilitychange', onVisibility),
			() => window.removeEventListener('blur', onBlur),
		);
	}

	/** Call from onunload() to remove the manually-added listeners. */
	unregister(): void {
		this.flushAll();
		for (const fn of this.cleanupListeners) fn();
		this.cleanupListeners = [];
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	/**
	 * (Re)start the 10-second idle timer for a given path.
	 * Each new modify event resets the clock.
	 */
	private scheduleIdleSync(filePath: string): void {
		this.pendingPaths.add(filePath);

		const existing = this.idleTimers.get(filePath);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.idleTimers.delete(filePath);
			this.pendingPaths.delete(filePath);
			const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				this.syncNoteToStore(file).catch(() => { /* silent */ });
			}
		}, 10_000); // 10 seconds of user idleness

		this.idleTimers.set(filePath, timer);
	}

	/** Immediately cancel the idle timer and run the sync for one path. */
	private flushPath(filePath: string): void {
		if (!this.pendingPaths.has(filePath)) return;

		const timer = this.idleTimers.get(filePath);
		if (timer) clearTimeout(timer);
		this.idleTimers.delete(filePath);
		this.pendingPaths.delete(filePath);

		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			this.syncNoteToStore(file).catch(() => { /* silent */ });
		}
	}

	/** Flush all pending syncs (used on visibility/blur). */
	private flushAll(): void {
		for (const filePath of [...this.pendingPaths]) {
			this.flushPath(filePath);
		}
	}

	/** Cancel a pending sync without running it (used on delete). */
	private cancelPath(filePath: string): void {
		const timer = this.idleTimers.get(filePath);
		if (timer) clearTimeout(timer);
		this.idleTimers.delete(filePath);
		this.pendingPaths.delete(filePath);
	}

	// ── Sync logic (unchanged from original) ──────────────────────────────────

	private async syncNoteToStore(file: TFile): Promise<void> {
		const { plugin } = this;
		const cache = plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.id) return;

		const ticketId = String(fm.id);
		const ticket = plugin.store.getTicket(ticketId);
		if (!ticket) return;

		// Skip sync for tickets belonging to archived projects
		const ticketProject = plugin.store.getProject(ticket.projectId);
		if (ticketProject?.archived) return;

		const newTitle: string = typeof fm.title === 'string' && fm.title.trim()
			? fm.title.trim()
			: ticket.title;

		const content = await plugin.app.vault.read(file);
		const bodyStart = content.indexOf('\n---\n', content.indexOf('---')) + 5;
		const body = bodyStart > 4 ? content.slice(bodyStart) : content;

		const nextSection = body.search(/^##\s/m);
		const newDescription = (nextSection === -1 ? body : body.slice(0, nextSection)).trim();

		const validStatuses  = new Set(['todo', 'in-progress', 'in-review', 'done']);
		const validPriorities = new Set(['low', 'medium', 'high', 'critical']);
		const newStatus: TicketStatus     = validStatuses.has(fm.status)     ? fm.status     : ticket.status;
		const newPriority: TicketPriority = validPriorities.has(fm.priority) ? fm.priority   : ticket.priority;
		const rawPoints = fm.points;
		const newPoints: number | undefined = typeof rawPoints === 'number' && rawPoints >= 0
			? Math.round(rawPoints)
			: ticket.points;

		const rawDue = fm.due;
		let newDueDate: number | undefined = ticket.dueDate;
		if (typeof rawDue === 'string' && rawDue.trim()) {
			const parsed = new Date(rawDue.trim()).getTime();
			if (!isNaN(parsed)) newDueDate = parsed;
		} else if (rawDue === null || rawDue === undefined) {
			newDueDate = undefined;
		}

		const rawStart = fm.start;
		let newStartDate: number | undefined = ticket.startDate;
		if (typeof rawStart === 'string' && rawStart.trim()) {
			const parsed = new Date(rawStart.trim()).getTime();
			if (!isNaN(parsed)) newStartDate = parsed;
		} else if (rawStart === null || rawStart === undefined) {
			newStartDate = undefined;
		}

		// Parse recurrence from frontmatter
		const validRecurRules = new Set(['daily', 'weekly', 'monthly', 'custom']);
		let newRecurrence = ticket.recurrence;
		if (typeof fm.recurrence === 'string' && validRecurRules.has(fm.recurrence)) {
			const rule = fm.recurrence as 'daily' | 'weekly' | 'monthly' | 'custom';
			const interval = typeof fm.recurrence_interval === 'number' ? Math.max(1, fm.recurrence_interval) : 1;
			let endDate: number | undefined;
			if (typeof fm.recurrence_end === 'string') {
				const p = new Date(fm.recurrence_end).getTime();
				if (!isNaN(p)) endDate = p;
			}
			newRecurrence = { rule, interval, endDate };
		} else if (fm.recurrence === null || fm.recurrence === undefined || fm.recurrence === 'none') {
			newRecurrence = undefined;
		}

		const changed =
			newTitle       !== ticket.title       ||
			newDescription !== ticket.description ||
			newStatus      !== ticket.status      ||
			newPriority    !== ticket.priority    ||
			newPoints      !== ticket.points      ||
			newDueDate     !== ticket.dueDate     ||
			newStartDate   !== ticket.startDate   ||
			JSON.stringify(newRecurrence) !== JSON.stringify(ticket.recurrence);

		if (!changed) return;

		await plugin.store.updateTicket(ticketId, {
			title:       newTitle,
			description: newDescription,
			status:      newStatus,
			priority:    newPriority,
			points:      newPoints,
			dueDate:     newDueDate,
			startDate:   newStartDate,
			recurrence:  newRecurrence,
		});

		plugin.markWriting(file.path);
		await generateTicketNote(plugin, ticketId);
		plugin.refreshAllViews();
	}

	private async syncRenameToStore(file: TFile, oldPath: string): Promise<void> {
		const { plugin } = this;
		const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm?.id) return;

		const ticketId = String(fm.id);
		const ticket = plugin.store.getTicket(ticketId);
		if (!ticket) return;

		const newPath = file.path;
		const inTicketsFolder = /\/Tickets\/[^/]+\.md$/.test(newPath);

		if (inTicketsFolder && (ticket.parentId ?? null) !== null) {
			await plugin.store.updateTicket(ticketId, { parentId: null });
		}

		plugin.markWriting(newPath);
		plugin.markWriting(oldPath);
		const canonicalPath = this.getCanonicalPath(ticketId);
		await generateTicketNote(plugin, ticketId, newPath !== canonicalPath ? newPath : undefined);
		plugin.refreshAllViews();
	}

	private getCanonicalPath(ticketId: string): string {
		const { plugin } = this;
		const ticket = plugin.store.getTicket(ticketId);
		if (!ticket) return '';
		const project = plugin.store.getProject(ticket.projectId);
		if (!project) return '';
		return ticketFilePath(plugin, project.name, ticket);
	}
}
