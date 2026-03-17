import { TFile } from 'obsidian';
import type ProjectFlowPlugin from './main';
import type { TicketStatus, TicketPriority } from './types';
import { generateTicketNote, ticketFilePath } from './ticketNote';

/**
 * Registers vault event listeners that sync ticket note changes back into
 * the ProjectStore. Meant to be instantiated once in onload() and discarded
 * in onunload() (Obsidian auto-cleans registered events on plugin unload).
 */
export class NoteSyncWatcher {
	private plugin: ProjectFlowPlugin;
	private syncDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(plugin: ProjectFlowPlugin) {
		this.plugin = plugin;
	}

	register(): void {
		const { plugin } = this;

		// Watch ticket notes for edits made directly in Obsidian
		plugin.registerEvent(
			plugin.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				if (!file.path.startsWith(baseFolder + '/')) return;
				if (plugin.writingPaths.has(file.path)) return;

				// Debounce: wait 1.5s after the last keystroke before syncing
				const existing = this.syncDebounceTimers.get(file.path);
				if (existing) clearTimeout(existing);
				const timer = setTimeout(() => {
					this.syncDebounceTimers.delete(file.path);
					this.syncNoteToStore(file).catch(() => { /* silent */ });
				}, 1500);
				this.syncDebounceTimers.set(file.path, timer);
			})
		);

		// Watch for ticket note moves made directly in Obsidian (file explorer drag/rename)
		plugin.registerEvent(
			plugin.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				const prefix = baseFolder + '/';

				// Skip plugin-initiated renames (markWriting is set on both paths)
				if (plugin.writingPaths.has(file.path) || plugin.writingPaths.has(oldPath)) return;

				const movedInto = file.path.startsWith(prefix);
				const movedFrom = oldPath.startsWith(prefix);

				// File moved out of base folder entirely — treat as deletion
				if (movedFrom && !movedInto) {
					const fm = plugin.app.metadataCache.getCache(oldPath)?.frontmatter;
					if (!fm?.id) return;
					const ticketId = String(fm.id);
					if (plugin.deletingIds.has(ticketId)) return;
					const ticket = plugin.store.getTicket(ticketId);
					if (!ticket) return;
					plugin.store.deleteTicket(ticketId).then(() => plugin.refreshAllViews()).catch(() => { /* silent */ });
					return;
				}

				if (!movedInto) return; // neither path is in base folder

				// Debounce: metadataCache may not have updated yet for the new path
				const existing = this.syncDebounceTimers.get(file.path);
				if (existing) clearTimeout(existing);
				const timer = setTimeout(() => {
					this.syncDebounceTimers.delete(file.path);
					this.syncRenameToStore(file, oldPath).catch(() => { /* silent */ });
				}, 500);
				this.syncDebounceTimers.set(file.path, timer);
			})
		);

		// Watch for ticket note deletions made directly in Obsidian
		plugin.registerEvent(
			plugin.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const baseFolder = plugin.store.getBaseFolder();
				if (!file.path.startsWith(baseFolder + '/')) return;

				// metadataCache still has the entry at delete time
				const fm = plugin.app.metadataCache.getCache(file.path)?.frontmatter;
				if (!fm?.id) return;

				const ticketId = String(fm.id);
				if (plugin.deletingIds.has(ticketId)) return; // plugin-initiated delete, skip

				const ticket = plugin.store.getTicket(ticketId);
				if (!ticket) return;

				plugin.store.deleteTicket(ticketId).then(() => {
					plugin.refreshAllViews();
				}).catch(() => { /* silent */ });
			})
		);
	}

	private async syncNoteToStore(file: TFile): Promise<void> {
		const { plugin } = this;
		const cache = plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.id) return; // not a ProjectFlow ticket note

		const ticketId = String(fm.id);
		const ticket = plugin.store.getTicket(ticketId);
		if (!ticket) return;

		// Title comes from frontmatter; description is body text before the first ## section
		const newTitle: string = typeof fm.title === 'string' && fm.title.trim()
			? fm.title.trim()
			: ticket.title;

		const content = await plugin.app.vault.read(file);
		const bodyStart = content.indexOf('\n---\n', content.indexOf('---')) + 5;
		const body = bodyStart > 4 ? content.slice(bodyStart) : content;

		const nextSection = body.search(/^##\s/m);
		const newDescription = (nextSection === -1 ? body : body.slice(0, nextSection)).trim();

		// Parse editable frontmatter fields
		const validStatuses = new Set(['todo', 'in-progress', 'in-review', 'done']);
		const validPriorities = new Set(['low', 'medium', 'high', 'critical']);
		const newStatus: TicketStatus = validStatuses.has(fm.status) ? fm.status : ticket.status;
		const newPriority: TicketPriority = validPriorities.has(fm.priority) ? fm.priority : ticket.priority;
		const rawPoints = fm.points;
		const newPoints: number | undefined = typeof rawPoints === 'number' && rawPoints >= 0
			? Math.round(rawPoints)
			: ticket.points;

		// Only update if something actually changed
		const changed =
			newTitle !== ticket.title ||
			newDescription !== ticket.description ||
			newStatus !== ticket.status ||
			newPriority !== ticket.priority ||
			newPoints !== ticket.points;

		if (!changed) return;

		await plugin.store.updateTicket(ticketId, {
			title: newTitle,
			description: newDescription,
			status: newStatus,
			priority: newPriority,
			points: newPoints,
		});

		// Re-generate the note to keep frontmatter consistent, suppressing the feedback loop
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

		// Infer intended hierarchy from the new path
		const newPath = file.path;
		const inTicketsFolder = /\/Tickets\/[^/]+\.md$/.test(newPath);

		if (inTicketsFolder && (ticket.parentId ?? null) !== null) {
			// User moved to Tickets/ — unparent the ticket
			await plugin.store.updateTicket(ticketId, { parentId: null });
		}
		// For all other moves (within Epics/ subtree), leave parentId unchanged.
		// The canonical path may now differ from where the user moved it,
		// so regenerate to move the file back to the correct canonical location.
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
