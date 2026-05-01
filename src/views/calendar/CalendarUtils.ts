import type { Ticket } from '../../types';

export const TYPE_FILTER_OPTIONS: [string, string][] = [
	['all', 'All types'], ['task', 'Task'], ['bug', 'Bug'],
	['story', 'Story'], ['epic', 'Epic'], ['subtask', 'Subtask'],
];

export const PRIORITY_FILTER_OPTIONS: [string, string][] = [
	['all', 'All priorities'], ['critical', 'Critical'], ['high', 'High'],
	['medium', 'Medium'], ['low', 'Low'], ['none', 'None'],
];

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Pixels per hour in the week time-grid. */
export const HOUR_HEIGHT = 64;

/** Hours visible in the time grid (0–23). */
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Layout info for a single timed block in the week/day grid. */
export interface BlockLayout {
	colIndex: number;   // 0-based column within the overlap cluster
	colCount: number;   // total columns in this cluster
	hiddenChildren: Ticket[]; // child tickets hidden behind this parent's badge (empty if not a parent)
	insetLevel: number; // 0 = normal; 1+ = subtask inset on top of parent
}

/** Midnight timestamp for the calendar day of a Date (strips time). */
export function dateOnlyMs(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** True if the timestamp has a non-midnight time component. */
export function hasTime(ts: number): boolean {
	const d = new Date(ts);
	return d.getHours() !== 0 || d.getMinutes() !== 0;
}

export function isSameDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function getDayOfWeekIndex(d: Date): number { return (d.getDay() + 6) % 7; }

export function getWeekDays(anchor: Date): Date[] {
	const offset = (anchor.getDay() + 6) % 7;
	const monday = new Date(anchor);
	monday.setDate(anchor.getDate() - offset);
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		return d;
	});
}

export function getMonthWeeks(year: number, month: number): Date[][] {
	const firstDay = new Date(year, month, 1);
	const startOffset = (firstDay.getDay() + 6) % 7;
	const gridStart = new Date(year, month, 1 - startOffset);
	const lastDay = new Date(year, month + 1, 0);
	const endOffset = (6 - ((lastDay.getDay() + 6) % 7));
	const gridEnd = new Date(year, month + 1, 0 + endOffset);
	const weeks: Date[][] = [];
	const cursor = new Date(gridStart);
	while (cursor <= gridEnd) {
		const week: Date[] = [];
		for (let i = 0; i < 7; i++) { week.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
		weeks.push(week);
	}
	return weeks;
}

export function getWeekRangeLabel(currentDate: Date): string {
	const days = getWeekDays(currentDate);
	const start = days[0], end = days[6];
	if (start.getMonth() === end.getMonth())
		return `${start.toLocaleString('default', { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
	if (start.getFullYear() === end.getFullYear())
		return `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()} – ${end.toLocaleString('default', { month: 'short' })} ${end.getDate()}, ${start.getFullYear()}`;
	return `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()}, ${start.getFullYear()} – ${end.toLocaleString('default', { month: 'short' })} ${end.getDate()}, ${end.getFullYear()}`;
}

export function getVisibleRange(viewMode: string, currentDate: Date): { rangeStart: number; rangeEnd: number } {
	if (viewMode === 'month' || viewMode === 'agenda') {
		const y = currentDate.getFullYear(), m = currentDate.getMonth();
		return { rangeStart: new Date(y, m, 1).getTime(), rangeEnd: new Date(y, m + 2, 0).getTime() };
	} else if (viewMode === 'week') {
		const days = getWeekDays(currentDate);
		return { rangeStart: dateOnlyMs(days[0]), rangeEnd: dateOnlyMs(days[6]) + 86400000 };
	} else {
		return { rangeStart: dateOnlyMs(currentDate), rangeEnd: dateOnlyMs(currentDate) + 86400000 };
	}
}

/**
 * Computes overlap layout for a set of timed tickets on a given day.
 * Returns a Map<ticketId, BlockLayout>.
 *
 * Strategy (Option C):
 * 1. Sort tickets by start time on this day.
 * 2. Build overlap clusters (tickets whose time ranges intersect).
 * 3. Within each cluster: if a ticket is a parent of others in the cluster,
 *    it gets full width and its children get listed in hiddenChildren.
 * 4. Remaining unrelated overlapping tickets get column-split layout.
 */
export function buildOverlapLayout(tickets: Ticket[], day: Date): Map<string, BlockLayout> {
	const result = new Map<string, BlockLayout>();
	if (tickets.length === 0) return result;

	const PX_PER_MIN = HOUR_HEIGHT / 60;

	// Compute [topPx, bottomPx] for each ticket on this day
	const ranges = new Map<string, [number, number]>();
	for (const t of tickets) {
		const due = new Date(t.dueDate!);
		const dueMin = due.getHours() * 60 + due.getMinutes();
		let topMin: number, botMin: number;
		if (t.startDate === undefined) {
			topMin = Math.max(0, dueMin - 60); botMin = dueMin;
		} else {
			const start = new Date(t.startDate);
			const startOnDay = isSameDay(start, day);
			const dueOnDay   = isSameDay(due, day);
			if (startOnDay && dueOnDay) {
				topMin = start.getHours() * 60 + start.getMinutes(); botMin = dueMin;
			} else if (startOnDay) {
				topMin = start.getHours() * 60 + start.getMinutes(); botMin = 24 * 60;
			} else if (dueOnDay) {
				topMin = 0; botMin = dueMin;
			} else {
				topMin = 0; botMin = 24 * 60;
			}
		}
		ranges.set(t.id, [topMin * PX_PER_MIN, botMin * PX_PER_MIN]);
	}

	// Build overlap clusters
	const visited = new Set<string>();
	const clusters: Ticket[][] = [];
	for (const t of tickets) {
		if (visited.has(t.id)) continue;
		const cluster: Ticket[] = [t];
		visited.add(t.id);
		const [aTop, aBot] = ranges.get(t.id)!;
		for (const u of tickets) {
			if (visited.has(u.id)) continue;
			const [bTop, bBot] = ranges.get(u.id)!;
			if (aTop < bBot && bTop < aBot) { cluster.push(u); visited.add(u.id); }
		}
		clusters.push(cluster);
	}

	// Assign layout per cluster
	for (const cluster of clusters) {
		if (cluster.length === 1) {
			result.set(cluster[0].id, { colIndex: 0, colCount: 1, hiddenChildren: [], insetLevel: 0 });
			continue;
		}

		// Identify parent-child relationships within the cluster.
		// Children that overlap their parent render INSET (not hidden).
		const clusterIds = new Set(cluster.map(t => t.id));
		const insetChildIds = new Set<string>();

		for (const t of cluster) {
			if (t.parentId && clusterIds.has(t.parentId)) {
				insetChildIds.add(t.id);
			}
		}

		// Non-inset tickets (parents + unrelated) get column split
		const nonChildren = cluster.filter(t => !insetChildIds.has(t.id));
		const colCount = Math.max(1, nonChildren.length);
		nonChildren.forEach((t, idx) => {
			result.set(t.id, {
				colIndex: idx,
				colCount,
				hiddenChildren: [], // no badge — children render inset
				insetLevel: 0,
			});
		});

		// Inset children: occupy same column as parent, rendered on top
		for (const t of cluster) {
			if (!insetChildIds.has(t.id)) continue;
			// Find parent's colIndex so child aligns to the same column
			const parentLayout = result.get(t.parentId!);
			const parentColIndex = parentLayout?.colIndex ?? 0;
			result.set(t.id, {
				colIndex: parentColIndex,
				colCount,
				hiddenChildren: [],
				insetLevel: 1,
			});
		}
	}

	return result;
}

/** Returns true if a ticket is hidden as a child behind a parent badge. */
export function isHiddenChild(ticketId: string, layoutMap: Map<string, BlockLayout>): boolean {
	const layout = layoutMap.get(ticketId);
	return layout !== undefined && layout.colIndex === -1;
}

/** Ghost ticket type — same as Ticket but with isGhost flag and original id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function expandRecurrences(tickets: Ticket[], rangeStart: number, rangeEnd: number): (Ticket & { isGhost?: boolean; originalId?: string })[] {
	const result: (Ticket & { isGhost?: boolean; originalId?: string })[] = [...tickets];
	for (const t of tickets) {
		if (!t.recurrence || t.dueDate === undefined) continue;
		const { rule, interval, endDate, customDays } = t.recurrence;
		const end = Math.min(endDate ?? rangeEnd, rangeEnd);
		let cursor = new Date(t.dueDate);
		const duration = t.startDate !== undefined ? t.dueDate - t.startDate : 0;
		let safety = 0;
		while (safety++ < 365) {
			// Advance cursor
			if (rule === 'daily') {
				cursor = new Date(cursor.getTime() + interval * 86400000);
			} else if (rule === 'weekly') {
				cursor = new Date(cursor.getTime() + interval * 7 * 86400000);
			} else if (rule === 'monthly') {
				cursor = new Date(cursor.getFullYear(), cursor.getMonth() + interval, cursor.getDate(), cursor.getHours(), cursor.getMinutes());
			} else if (rule === 'custom' && customDays && customDays.length > 0) {
				// Advance day by day until we hit a customDay
				cursor = new Date(cursor.getTime() + 86400000);
				let tries = 0;
				while (!customDays.includes(cursor.getDay()) && tries++ < 7) {
					cursor = new Date(cursor.getTime() + 86400000);
				}
			} else {
				break;
			}
			const curMs = cursor.getTime();
			if (curMs > end) break;
			if (curMs < rangeStart) continue;
			const ghost: Ticket & { isGhost: boolean; originalId: string } = {
				...t,
				id: `${t.id}-ghost-${curMs}`,
				originalId: t.id,
				isGhost: true,
				dueDate: curMs,
				startDate: duration > 0 ? curMs - duration : undefined,
			};
			result.push(ghost);
		}
	}
	return result;
}
