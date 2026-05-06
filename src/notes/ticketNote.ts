import { normalizePath, TFile } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket } from '../types';
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
	const fmtDateTime = (ms: number) => {
		const d = new Date(ms);
		const yr = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), dy = String(d.getDate()).padStart(2, '0');
		const h = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0');
		return `${yr}-${mo}-${dy} ${h}:${mi}`;
	};
	const fmtDate = (ms: number) => {
		const d = new Date(ms);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const fmtTime = (ms: number) => {
		const d = new Date(ms);
		const h = d.getHours(), m = d.getMinutes();
		return h !== 0 || m !== 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '';
	};
	const createdStr = fmtDateTime(ticket.createdAt);
	const updatedStr = fmtDateTime(ticket.updatedAt);

	const tags = [projectSlug, ticket.type, ticket.priority, ticket.status];
	if (epicAncestor) tags.push('epic-' + epicAncestor.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
	const tagsYaml = tags.map(t => `  - ${t}`).join('\n');

	// Pre-compute date strings so frontmatter is a flat array
	const startDateStr = ticket.startDate !== undefined ? fmtDate(ticket.startDate) : '';
	const startTimeStr = ticket.startDate !== undefined ? fmtTime(ticket.startDate) : '';
	const endDateStr   = ticket.endDate   !== undefined ? fmtDate(ticket.endDate)   : '';
	const endTimeStr   = ticket.endDate   !== undefined ? fmtTime(ticket.endDate)   : '';

	const recur = ticket.recurrence;
	const recurRule     = recur ? recur.rule : '';
	const recurInterval = recur ? String(recur.interval ?? 1) : '';
	const recurEnd      = recur?.endDate ? fmtDate(recur.endDate) : '';
	const recurDays     = recur?.customDays && recur.customDays.length > 0
		? `[${recur.customDays.join(', ')}]`
		: '[]';

	const parentTitle = parent ? parent.title.replace(/"/g, '\\"') : '';
	const epicTitle   = epicAncestor && epicAncestor.id !== ticket.id
		? epicAncestor.title.replace(/"/g, '\\"') : '';

	const frontmatterLines = [
		'---',
		// ── Identity ───────────────────────────────────────────
		`id: "${ticket.id}"`,
		`key: "${project.tag}-${ticket.ticketNumber}"`,
		`ticket_number: ${ticket.ticketNumber}`,
		`project: "${project.name.replace(/"/g, '\\"')}"`,
		`project_id: "${ticket.projectId}"`,
		// ── State ─────────────────────────────────────────────
		`title: "${ticket.title.replace(/"/g, '\\"')}"`,
		`status: ${ticket.status}`,
		`priority: ${ticket.priority}`,
		`type: ${ticket.type}`,
		`points: ${ticket.points !== undefined ? ticket.points : '""'}`,
		`sprint: "${sprintName}"`,
		`sprint_id: "${ticket.sprintId ?? ''}"`,
		// ── Hierarchy ─────────────────────────────────────────
		`parent: "${parentTitle}"`,
		`parent_id: "${ticket.parentId ?? ''}"`,
		`epic: "${epicTitle}"`,
		// ── Dates ─────────────────────────────────────────────
		`start_date: ${startDateStr ? startDateStr : '""'}`,
		`start_time: ${startTimeStr ? `"${startTimeStr}"` : '""'}`,
		`end_date: ${endDateStr ? endDateStr : '""'}`,
		`end_time: ${endTimeStr ? `"${endTimeStr}"` : '""'}`,
		`completed_at: ${ticket.completedAt ? fmtDateTime(ticket.completedAt) : '""'}`,
		`created: ${createdStr}`,
		`updated: ${updatedStr}`,
		// ── Recurrence ────────────────────────────────────────
		`recurrence: ${recurRule ? recurRule : '""'}`,
		`recurrence_interval: ${recurInterval ? recurInterval : '""'}`,
		`recurrence_end: ${recurEnd ? recurEnd : '""'}`,
		`recurrence_custom_days: ${recurDays}`,
		// ── Archive ───────────────────────────────────────────
		`archived: ${ticket.archived === true}`,
		`archived_at: ${ticket.archivedAt ? fmtDateTime(ticket.archivedAt) : '""'}`,
		// ── Ordering ──────────────────────────────────────────
		`order: ${ticket.order}`,
		`backlog_order: ${ticket.backlogOrder}`,
	];

	// ── Reminders ─────────────────────────────────────────────
	if (ticket.reminders && ticket.reminders.length > 0) {
		frontmatterLines.push('reminders:');
		for (const r of ticket.reminders) {
			frontmatterLines.push(`  - anchor: ${r.anchor}`);
			frontmatterLines.push(`    offset_minutes: ${r.offsetMinutes}`);
		}
	} else {
		frontmatterLines.push('reminders: []');
	}

	frontmatterLines.push(
		'tags:',
		tagsYaml,
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
