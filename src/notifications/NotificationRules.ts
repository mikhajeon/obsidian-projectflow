import type { Ticket, Sprint, StoredNotification, NotificationTriggerConfig, NotificationTriggerType } from '../types';

// Partial notification — id/createdAt/dismissed/read are stamped by maybeAdd
export type PartialNotif = Omit<StoredNotification, 'id' | 'createdAt' | 'dismissed' | 'read'>;

export interface ProjectCheckContext {
	projectId: string;
	projectName: string;
	projectTag: string;
	now: number;
	todayMs: number;
	/** Non-archived, non-done tickets */
	tickets: Ticket[];
	/** Non-archived tickets (includes done — used for project_idle) */
	allTickets: Ticket[];
	activeSprint: Sprint | null;
	useSprints: boolean;
	triggers: Record<string, NotificationTriggerConfig>;
}

export interface TriggerRule {
	type: NotificationTriggerType;
	check(ctx: ProjectCheckContext): PartialNotif[];
}

// ── Ticket rules ───────────────────────────────────────────────────────────

const ticketDueToday: TriggerRule = {
	type: 'ticket_due_today',
	check({ projectId, projectTag, now: _now, todayMs, tickets, triggers }) {
		const out: PartialNotif[] = [];
		for (const t of tickets.filter(t => t.dueDate)) {
			const dueDay = new Date(t.dueDate!); dueDay.setHours(0, 0, 0, 0);
			if (dueDay.getTime() === todayMs) {
				out.push({
					projectId, ticketId: t.id, type: 'ticket_due_today',
					title: `Due today: ${t.title}`,
					body: `Ticket ${projectTag}-${t.ticketNumber} is due today.`,
				});
			}
		}
		return out;
	},
};

const ticketDueApproaching: TriggerRule = {
	type: 'ticket_due_approaching',
	check({ projectId, now, tickets, triggers }) {
		const days = triggers['ticket_due_approaching']?.daysBeforeDue ?? 2;
		const windowMs = days * 86400000;
		const out: PartialNotif[] = [];
		for (const t of tickets.filter(t => t.dueDate)) {
			const diff = t.dueDate! - now;
			if (diff > 0 && diff <= windowMs) {
				const daysLeft = Math.ceil(diff / 86400000);
				out.push({
					projectId, ticketId: t.id, type: 'ticket_due_approaching',
					title: `Due in ${daysLeft}d: ${t.title}`,
					body: `Ticket is due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
				});
			}
		}
		return out;
	},
};

const ticketOverdue: TriggerRule = {
	type: 'ticket_overdue',
	check({ projectId, now, tickets }) {
		return tickets
			.filter(t => t.dueDate && t.dueDate < now)
			.map(t => ({
				projectId, ticketId: t.id, type: 'ticket_overdue' as const,
				title: `Overdue: ${t.title}`,
				body: `This ticket passed its due date.`,
			}));
	},
};

const ticketStaleInProgress: TriggerRule = {
	type: 'ticket_stale_in_progress',
	check({ projectId, now, tickets, triggers }) {
		const days = triggers['ticket_stale_in_progress']?.staleThresholdDays ?? 5;
		const thresholdMs = days * 86400000;
		const out: PartialNotif[] = [];
		for (const t of tickets.filter(t => t.status === 'in-progress' && t.updatedAt)) {
			if (now - t.updatedAt > thresholdMs) {
				out.push({
					projectId, ticketId: t.id, type: 'ticket_stale_in_progress',
					title: `Stale: ${t.title}`,
					body: `In progress for more than ${days} days with no update.`,
				});
			}
		}
		return out;
	},
};

const ticketNoDueDate: TriggerRule = {
	type: 'ticket_no_due_date',
	check({ projectId, tickets }) {
		return tickets
			.filter(t => !t.dueDate)
			.map(t => ({
				projectId, ticketId: t.id, type: 'ticket_no_due_date' as const,
				title: `No due date: ${t.title}`,
				body: `This ticket has no due date set.`,
			}));
	},
};

const ticketNoSprint: TriggerRule = {
	type: 'ticket_no_sprint',
	check({ projectId, tickets, useSprints }) {
		if (!useSprints) return [];
		return tickets
			.filter(t => !t.sprintId)
			.map(t => ({
				projectId, ticketId: t.id, type: 'ticket_no_sprint' as const,
				title: `No sprint: ${t.title}`,
				body: `This ticket is not assigned to any sprint.`,
			}));
	},
};

// ── Sprint rules ───────────────────────────────────────────────────────────

const sprintNoneActive: TriggerRule = {
	type: 'sprint_none_active',
	check({ projectId, projectName, activeSprint, useSprints }) {
		if (!useSprints || activeSprint) return [];
		return [{
			projectId, type: 'sprint_none_active',
			title: `No active sprint`,
			body: `Project "${projectName}" has no active sprint.`,
		}];
	},
};

const sprintEndingSoon: TriggerRule = {
	type: 'sprint_ending_soon',
	check({ projectId, now, activeSprint, triggers }) {
		if (!activeSprint) return [];
		const days = triggers['sprint_ending_soon']?.daysBeforeSprintEnd ?? 2;
		const diff = activeSprint.endDate - now;
		if (diff <= 0 || diff > days * 86400000) return [];
		const daysLeft = Math.ceil(diff / 86400000);
		return [{
			projectId, sprintId: activeSprint.id, type: 'sprint_ending_soon',
			title: `Sprint ending in ${daysLeft}d`,
			body: `"${activeSprint.name}" ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
		}];
	},
};

const sprintEndsToday: TriggerRule = {
	type: 'sprint_ends_today',
	check({ projectId, todayMs, activeSprint }) {
		if (!activeSprint) return [];
		const endDay = new Date(activeSprint.endDate); endDay.setHours(0, 0, 0, 0);
		if (endDay.getTime() !== todayMs) return [];
		return [{
			projectId, sprintId: activeSprint.id, type: 'sprint_ends_today',
			title: `Sprint ends today`,
			body: `"${activeSprint.name}" ends today.`,
		}];
	},
};

const sprintOverdue: TriggerRule = {
	type: 'sprint_overdue',
	check({ projectId, now, activeSprint }) {
		if (!activeSprint || activeSprint.endDate >= now) return [];
		return [{
			projectId, sprintId: activeSprint.id, type: 'sprint_overdue',
			title: `Sprint overdue`,
			body: `"${activeSprint.name}" has passed its end date.`,
		}];
	},
};

// ── Project rules ──────────────────────────────────────────────────────────

const projectOverdueTickets: TriggerRule = {
	type: 'project_overdue_tickets',
	check({ projectId, projectName, now, tickets }) {
		const overdueCount = tickets.filter(t => t.dueDate && t.dueDate < now).length;
		if (overdueCount === 0) return [];
		return [{
			projectId, type: 'project_overdue_tickets',
			title: `${overdueCount} overdue ticket${overdueCount !== 1 ? 's' : ''}`,
			body: `Project "${projectName}" has ${overdueCount} overdue ticket${overdueCount !== 1 ? 's' : ''}.`,
		}];
	},
};

const projectIdle: TriggerRule = {
	type: 'project_idle',
	check({ projectId, projectName, now, allTickets, triggers }) {
		const days = triggers['project_idle']?.idleThresholdDays ?? 7;
		const lastActivity = allTickets.reduce((max, t) => Math.max(max, t.updatedAt ?? 0), 0);
		if (lastActivity === 0 || now - lastActivity <= days * 86400000) return [];
		return [{
			projectId, type: 'project_idle',
			title: `Project idle for ${days}+ days`,
			body: `No ticket activity in "${projectName}" for over ${days} days.`,
		}];
	},
};

// project_no_active_sprint is intentionally omitted — it fires for the same
// condition as sprint_none_active, producing duplicate notifications. The type
// is kept in NotificationTriggerType for backwards compat with stored settings,
// but no rule fires for it.

// ── Rule registry ──────────────────────────────────────────────────────────

export const ALL_PROJECT_RULES: TriggerRule[] = [
	ticketDueToday,
	ticketDueApproaching,
	ticketOverdue,
	ticketStaleInProgress,
	ticketNoDueDate,
	ticketNoSprint,
	sprintNoneActive,
	sprintEndingSoon,
	sprintEndsToday,
	sprintOverdue,
	projectOverdueTickets,
	projectIdle,
];
