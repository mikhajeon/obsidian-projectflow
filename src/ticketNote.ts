import { normalizePath, TFile } from 'obsidian';
import type ProjectFlowPlugin from './main';
import type { Ticket } from './types';
import { ensureFolder, safeFileName } from './fileUtils';

export { ensureFolder, safeFileName };

/**
 * Walks up the parentId chain to find the ancestor epic, if any.
 * Returns the chain from epic down to (but not including) the ticket itself.
 */
function getAncestorChain(plugin: ProjectFlowPlugin, ticket: Ticket): Ticket[] {
	const chain: Ticket[] = [];
	let current = ticket;
	while (current.parentId) {
		const parent = plugin.store.getTicket(current.parentId);
		if (!parent) break;
		chain.unshift(parent);
		current = parent;
	}
	return chain;
}

/** Returns the stable filename stem for a ticket, e.g. "DBA-42". */
export function ticketFileStem(plugin: ProjectFlowPlugin, ticket: Ticket): string {
	const project = plugin.store.getProject(ticket.projectId);
	const tag = project?.tag ?? 'TKT';
	const num = ticket.ticketNumber ?? 0;
	return `${tag}-${num}`;
}

export function ticketFilePath(plugin: ProjectFlowPlugin, projectName: string, ticket: Ticket): string {
	const base = plugin.store.getBaseFolder();
	const projectDir = safeFileName(projectName);
	const stem = ticketFileStem(plugin, ticket);

	// Epic itself
	if (ticket.type === 'epic') {
		return normalizePath(`${base}/${projectDir}/Epics/${stem}.md`);
	}

	// Check if this ticket is a descendant of an epic
	const chain = getAncestorChain(plugin, ticket);
	if (chain.length > 0 && chain[0].type === 'epic') {
		// Child of epic (task/story level)
		if (chain.length === 1) {
			return normalizePath(`${base}/${projectDir}/Epics/Tasks/${stem}.md`);
		}
		// Grandchild of epic (subtask level)
		if (chain.length >= 2) {
			return normalizePath(`${base}/${projectDir}/Epics/Tasks/Subtasks/${stem}.md`);
		}
	}

	// Non-epic ticket: standard path
	return normalizePath(`${base}/${projectDir}/Tickets/${stem}.md`);
}

/** @deprecated Use ticketFilePath(plugin, projectName, ticket) instead */
export function legacyTicketFilePath(plugin: ProjectFlowPlugin, projectName: string, ticketTitle: string): string {
	const base = plugin.store.getBaseFolder();
	return normalizePath(`${base}/${safeFileName(projectName)}/Tickets/${safeFileName(ticketTitle)}.md`);
}

/**
 * Generates or updates the note for a ticket, and trashes the old note if
 * the file path has changed (e.g. after re-parenting or renaming).
 * Pass oldFilePath to enable the move behaviour.
 */
export async function generateTicketNote(plugin: ProjectFlowPlugin, ticketId: string, oldFilePath?: string): Promise<void> {
	const store = plugin.store;
	const ticket = store.getTicket(ticketId);
	if (!ticket) return;

	const project = store.getProject(ticket.projectId);
	if (!project) return;

	const sprint = ticket.sprintId ? store.getSprint(ticket.sprintId) : null;
	const sprintName = sprint ? sprint.name : 'Backlog';

	// Find parent info for frontmatter
	const parent = ticket.parentId ? store.getTicket(ticket.parentId) : null;
	const chain = getAncestorChain(plugin, ticket);
	const epicAncestor = chain.length > 0 && chain[0].type === 'epic' ? chain[0] : null;

	const projectSlug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	const createdStr = new Date(ticket.createdAt).toISOString().split('T')[0];
	const updatedStr = new Date(ticket.updatedAt).toISOString().split('T')[0];

	const tags = [projectSlug, ticket.type, ticket.priority, ticket.status];
	if (epicAncestor) tags.push('epic-' + epicAncestor.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
	const tagsYaml = tags.map(t => `  - ${t}`).join('\n');

	const frontmatterLines = [
		'---',
		`id: "${ticket.id}"`,
		`key: "${project.tag}-${ticket.ticketNumber}"`,
		`title: "${ticket.title.replace(/"/g, '\\"')}"`,
		`project: "${project.name.replace(/"/g, '\\"')}"`,
		`sprint: "${sprintName}"`,
		`status: ${ticket.status}`,
		`priority: ${ticket.priority}`,
		`type: ${ticket.type}`,
	];

	if (ticket.points !== undefined) {
		frontmatterLines.push(`points: ${ticket.points}`);
	}

	if (ticket.parentId && parent) {
		frontmatterLines.push(`parent: "${parent.title.replace(/"/g, '\\"')}"`);
	}

	if (epicAncestor && epicAncestor.id !== ticket.id) {
		frontmatterLines.push(`epic: "${epicAncestor.title.replace(/"/g, '\\"')}"`);
	}

	frontmatterLines.push(
		'tags:',
		tagsYaml,
		`created: ${createdStr}`,
		`updated: ${updatedStr}`,
		'---',
	);

	const bodyLines = [
		'',
		ticket.description || '',
	];

	if (ticket.checklist && ticket.checklist.length > 0) {
		bodyLines.push('', '## Subtasks', '');
		for (const item of ticket.checklist) {
			bodyLines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
		}
	}

	// Show child tickets as links for epics and tasks with children
	const children = store.getChildTickets(ticket.id);
	if (children.length > 0) {
		const sectionTitle = ticket.type === 'epic' ? '## Stories / Tasks' : '## Subtasks';
		bodyLines.push('', sectionTitle, '');
		for (const child of children) {
			const childPath = ticketFilePath(plugin, project.name, child);
			bodyLines.push(`- [[${childPath}|${child.title}]] (${child.status})`);
		}
	}

	const content = [...frontmatterLines, ...bodyLines].join('\n');

	// Determine folder and file path
	const filePath = ticketFilePath(plugin, project.name, ticket);
	const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
	await ensureFolder(plugin, folderPath);

	// Suppress sync feedback loop for this write
	plugin.markWriting(filePath);

	// If the file has moved to a new path, rename (move) it rather than trash + create
	if (oldFilePath && oldFilePath !== filePath) {
		const oldFile = plugin.app.vault.getAbstractFileByPath(oldFilePath);
		if (oldFile instanceof TFile) {
			plugin.markWriting(oldFilePath);
			await plugin.app.vault.rename(oldFile, filePath);
		}
	}

	const existing = plugin.app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		await plugin.app.vault.process(existing, () => content);
	} else {
		await plugin.app.vault.create(filePath, content);
	}
}

export async function deleteTicketNote(plugin: ProjectFlowPlugin, ticketId: string): Promise<void> {
	const store = plugin.store;
	const ticket = store.getTicket(ticketId);
	if (!ticket) return;

	const project = store.getProject(ticket.projectId);
	if (!project) return;

	// Delete child notes recursively first
	const children = store.getChildTickets(ticketId);
	for (const child of children) {
		await deleteTicketNote(plugin, child.id);
	}

	const filePath = ticketFilePath(plugin, project.name, ticket);
	const file = plugin.app.vault.getAbstractFileByPath(filePath);
	if (file instanceof TFile) {
		plugin.markDeleting(ticketId);
		await plugin.app.fileManager.trashFile(file);
	}
}
