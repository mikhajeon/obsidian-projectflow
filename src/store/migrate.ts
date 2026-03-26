import type { AppData, Project, Ticket } from '../types';
import { DEFAULT_DATA } from '../types';
import { DEFAULT_STATUSES } from '../statusConfig';

/** Derive a default tag from a project name: first letter of each word, uppercased, max 5 chars. */
export function defaultTagFromName(name: string): string {
	return name
		.trim()
		.split(/\s+/)
		.map(w => w[0] ?? '')
		.join('')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 5) || 'PRJ';
}

/** Raw persisted shape before migrations are applied. */
type RawData = Partial<AppData & {
	sprintHistoryFolder?: string;
	ticketsFolder?: string;
}>;

/**
 * Applies all data migrations to raw persisted data and returns a fully
 * populated AppData object ready for use.
 */
export function migrateAppData(saved: RawData | null): AppData {
	// Migrate from old separate folder settings
	const legacyBase = saved?.sprintHistoryFolder?.replace(/\/Sprint Histories$/, '')
		?? saved?.ticketsFolder?.replace(/\/Tickets$/, '')
		?? DEFAULT_DATA.baseFolder;

	const rawProjects: Project[] = saved?.projects ?? [];
	const rawTickets: Ticket[] = saved?.tickets ?? [];

	// Migrate projects: assign tag, ticketCounter, and statuses if missing
	const projects = rawProjects.map(p => ({
		...p,
		tag: (p as Project & { tag?: string }).tag || defaultTagFromName(p.name),
		ticketCounter: (p as Project & { ticketCounter?: number }).ticketCounter ?? 0,
		statuses: (p as Project).statuses ?? DEFAULT_STATUSES.map(s => ({ ...s })),
	}));

	// Migrate tickets: assign ticketNumber and backlogOrder if missing
	const counterByProject: Record<string, number> = {};
	const backlogOrderByBucket: Record<string, number> = {};
	const tickets = rawTickets.map(t => {
		const withNumber = (() => {
			const existing = (t as Ticket & { ticketNumber?: number }).ticketNumber;
			if (existing !== undefined) return t;
			counterByProject[t.projectId] = (counterByProject[t.projectId] ?? 0) + 1;
			return { ...t, ticketNumber: counterByProject[t.projectId] };
		})();
		const withBacklog = (() => {
			if ((withNumber as Ticket & { backlogOrder?: number }).backlogOrder !== undefined) return withNumber;
			const bucket = `${withNumber.projectId}:${withNumber.sprintId ?? 'none'}`;
			backlogOrderByBucket[bucket] = (backlogOrderByBucket[bucket] ?? -1) + 1;
			return { ...withNumber, backlogOrder: backlogOrderByBucket[bucket] };
		})();
		return withBacklog;
	});

	// Ensure project ticketCounters are at least as high as the max ticketNumber of their tickets
	for (const p of projects) {
		const maxNum = tickets
			.filter(t => t.projectId === p.id)
			.reduce((m, t) => Math.max(m, t.ticketNumber ?? 0), 0);
		if (p.ticketCounter < maxNum) p.ticketCounter = maxNum;
	}

	// Migrate 'epics' view key to 'list' in tabOrder and colWidths
	// Add 'parent' tab for existing users who don't have it yet
	// Add 'archive' tab for existing users who don't have it yet
	const rawTabOrder: string[] = saved?.tabOrder ?? ['board', 'parent', 'backlog', 'epics'];
	const migratedTabOrder = rawTabOrder.map(t => t === 'epics' ? 'list' : t);
	const withParent = migratedTabOrder.includes('parent')
		? migratedTabOrder
		: ['board', 'parent', ...migratedTabOrder.filter(t => t !== 'board')];
	const tabOrder = withParent.includes('archive')
		? withParent
		: [...withParent, 'archive'];

	const rawColWidths: Record<string, Record<string, number>> = saved?.colWidths ?? {};
	const colWidths = { ...rawColWidths };
	if ('epics' in colWidths && !('list' in colWidths)) {
		colWidths['list'] = colWidths['epics'];
		delete colWidths['epics'];
	}

	return {
		projects,
		sprints: saved?.sprints ?? [],
		tickets,
		activeProjectId: saved?.activeProjectId ?? null,
		baseFolder: saved?.baseFolder ?? legacyBase,
		colWidths,
		tabOrder,
		sortOrders: saved?.sortOrders ?? {},
		boardGrouping: saved?.boardGrouping ?? 'default',
		filterStates: saved?.filterStates ?? {},
	};
}
