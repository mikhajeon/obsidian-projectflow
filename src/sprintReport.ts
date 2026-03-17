import { normalizePath, Notice, TFile } from 'obsidian';
import type ProjectFlowPlugin from './main';
import type { Ticket } from './types';
import { ensureFolder, safeFileName } from './ticketNote';

export async function generateSprintReport(plugin: ProjectFlowPlugin, sprintId: string): Promise<void> {
	const store = plugin.store;
	const sprint = store.getSprint(sprintId);
	if (!sprint) return;

	const project = store.getProject(sprint.projectId);
	if (!project) return;

	const tickets = store.getTickets({ sprintId });
	const progress = store.getSprintProgress(sprintId);

	const startStr = new Date(sprint.startDate).toLocaleDateString();
	const endStr = new Date(sprint.endDate).toLocaleDateString();
	const completedStr = new Date().toLocaleDateString();

	const byStatus: Record<string, Ticket[]> = {
		done: tickets.filter(t => t.status === 'done'),
		'in-review': tickets.filter(t => t.status === 'in-review'),
		'in-progress': tickets.filter(t => t.status === 'in-progress'),
		todo: tickets.filter(t => t.status === 'todo'),
	};

	const ticketTable = (list: Ticket[]): string => {
		if (list.length === 0) return '_None_\n';
		const rows = list.map(t => {
			const pts = t.points !== undefined ? String(t.points) : '-';
			return `| ${t.title} | ${t.type} | ${t.priority} | ${pts} |`;
		}).join('\n');
		return `| Title | Type | Priority | Pts |\n|-------|------|----------|-----|\n${rows}\n`;
	};

	const doneTicketsWithPoints = byStatus['done'].filter(t => t.points !== undefined);
	const velocity = doneTicketsWithPoints.reduce((sum, t) => sum + (t.points ?? 0), 0);

	const summaryLines = [
		`- Total tickets: ${progress.total}`,
		`- Done: ${progress.done} (${progress.percent}%)`,
		`- Not completed: ${progress.total - progress.done}`,
	];
	if (doneTicketsWithPoints.length > 0) {
		summaryLines.push(`- Velocity: ${velocity} pts completed`);
	}

	const lines: string[] = [
		`# Sprint History: ${sprint.name}`,
		'',
		`**Project:** ${project.name}  `,
		`**Period:** ${startStr} – ${endStr}  `,
		`**Completed:** ${completedStr}  `,
	];

	if (sprint.goal) {
		lines.push(`**Goal:** ${sprint.goal}  `);
	}

	lines.push(
		'',
		'## Summary',
		'',
		...summaryLines,
		'',
		'## Done [x]',
		'',
		ticketTable(byStatus['done']),
		'## In Review [~]',
		'',
		ticketTable(byStatus['in-review']),
		'## In Progress [>]',
		'',
		ticketTable(byStatus['in-progress']),
		'## To Do [ ]',
		'',
		ticketTable(byStatus['todo']),
	);

	if (sprint.retroNotes) {
		lines.push(
			'## Retrospective',
			'',
			sprint.retroNotes,
			'',
		);
	}

	const content = lines.join('\n');

	const folderPath = normalizePath(`${store.getBaseFolder()}/${safeFileName(project.name)}/Sprint Histories`);
	const filePath = normalizePath(`${folderPath}/${safeFileName(sprint.name)}.md`);

	await ensureFolder(plugin, folderPath);

	const existing = plugin.app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		await plugin.app.vault.process(existing, () => content);
	} else {
		await plugin.app.vault.create(filePath, content);
	}

	new Notice(`Sprint history saved: ${filePath}`);
}
