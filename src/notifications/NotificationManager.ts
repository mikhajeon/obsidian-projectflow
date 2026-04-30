import { Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { StoredNotification, NotificationTriggerConfig, SnoozeInterval, Ticket } from '../types';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types';
import { ALL_PROJECT_RULES, ProjectCheckContext } from './NotificationRules';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function uid(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function startOfTomorrow(): number {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function snoozedUntilFromInterval(interval: SnoozeInterval): number {
	if (interval.minutes === 0) return startOfTomorrow();
	return Date.now() + interval.minutes * 60 * 1000;
}

export interface NotificationSummaryStats {
	overdue: number;
	dueToday: number;
	endingSoon: number;
}

export class NotificationManager {
	private plugin: ProjectFlowPlugin;
	private intervalId: number | null = null;
	private badgeEls: HTMLElement[] = [];
	private _summaryStats: NotificationSummaryStats = { overdue: 0, dueToday: 0, endingSoon: 0 };
	private _suppressRefresh = false;

	constructor(plugin: ProjectFlowPlugin) {
		this.plugin = plugin;
	}

	addBadge(el: HTMLElement): void {
		this.badgeEls.push(el);
	}

	removeBadge(el: HTMLElement): void {
		this.badgeEls = this.badgeEls.filter(b => b !== el);
	}

	start(): void {
		this.requestOsPermission();
		this.checkAll(true);
		this.intervalId = window.setInterval(() => this.checkAll(false), INTERVAL_MS);
	}

	stop(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	// ── Public actions ────────────────────────────────────────────────────────

	async snooze(id: string, interval: SnoozeInterval): Promise<void> {
		await this.plugin.store.updateNotification(id, { snoozedUntil: snoozedUntilFromInterval(interval) });
		this.updateBadge();
	}

	async dismiss(id: string): Promise<void> {
		await this.plugin.store.updateNotification(id, { dismissed: true });
		this.updateBadge();
	}

	async markRead(id: string): Promise<void> {
		await this.plugin.store.updateNotification(id, { read: true });
		this.updateBadge();
	}

	async markAllRead(): Promise<void> {
		const notifications = this.plugin.store.getNotifications();
		for (const n of notifications.filter(n => !n.read && !n.dismissed)) {
			await this.plugin.store.updateNotification(n.id, { read: true });
		}
		this.updateBadge();
	}

	resolveSnoozeIntervals(notification: StoredNotification): SnoozeInterval[] {
		const settings = this.plugin.store.getNotificationSettings();
		if (notification.ticketId) {
			const ticket = this.plugin.store.getTicket(notification.ticketId);
			if (ticket) {
				if (notification.reminderId) {
					const reminder = ticket.reminders?.find(r => r.id === notification.reminderId);
					if (reminder?.snoozeIntervals?.length) return reminder.snoozeIntervals;
				}
				if (ticket.snoozeIntervals?.length) return ticket.snoozeIntervals;
			}
		}
		return settings.snoozeIntervals?.length ? settings.snoozeIntervals : DEFAULT_NOTIFICATION_SETTINGS.snoozeIntervals;
	}

	/** Returns the last computed summary stats (overdue/dueToday/endingSoon). */
	getSummaryStats(): NotificationSummaryStats {
		return this._summaryStats;
	}

	/**
	 * Run an immediate check (e.g. when the notification panel opens).
	 * Suppresses the panel refresh callback to avoid re-entrant renders.
	 */
	checkNow(): void {
		this._suppressRefresh = true;
		try {
			this.checkAll(false);
		} finally {
			this._suppressRefresh = false;
		}
	}

	/** Returns actual ticket arrays for overdue/dueToday, plus endingSoon count. */
	getDetailedSummary(): { overdueTickets: Ticket[], dueTodayTickets: Ticket[], endingSoon: number } {
		const now = Date.now();
		const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
		const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
		const overdueTickets: Ticket[] = [];
		const dueTodayTickets: Ticket[] = [];
		let endingSoon = 0;
		for (const project of this.plugin.store.getProjects()) {
			const projectStatuses = this.plugin.store.getProjectStatuses(project.id);
			const doneIds = new Set(projectStatuses.filter(s => s.universalId === 'done').map(s => s.id));
			const tickets = this.plugin.store.getTickets({ projectId: project.id })
				.filter(t => !t.archived && !doneIds.has(t.status));
			overdueTickets.push(...tickets.filter(t => t.dueDate && t.dueDate < todayStart.getTime()));
			dueTodayTickets.push(...tickets.filter(t => t.dueDate && t.dueDate >= todayStart.getTime() && t.dueDate <= todayEnd.getTime()));
			const sprint = this.plugin.store.getSprints(project.id).find(s => s.status === 'active');
			if (sprint && sprint.endDate - now <= 2 * 86400000 && sprint.endDate > now) endingSoon++;
		}
		return { overdueTickets, dueTodayTickets, endingSoon };
	}

	// ── Core check ────────────────────────────────────────────────────────────

	private checkAll(_isStartup: boolean): void {
		const settings = this.plugin.store.getNotificationSettings();
		if (!settings.enabled) return;

		const projects = this.plugin.store.getProjects();
		const now = Date.now();
		const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
		const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

		// Accumulate summary stats while iterating projects
		let overdue = 0, dueToday = 0, endingSoon = 0;

		for (const project of projects) {
			const projectSettings = this.plugin.store.getProjectNotificationSettings(project.id);
			const effectiveTriggers = projectSettings.useGlobal
				? settings.triggers
				: { ...settings.triggers, ...projectSettings.triggers };

			this.checkProject(project.id, effectiveTriggers);

			// Accumulate summary stats
			const projectStatuses = this.plugin.store.getProjectStatuses(project.id);
			const doneIds = new Set(projectStatuses.filter(s => s.universalId === 'done').map(s => s.id));
			const tickets = this.plugin.store.getTickets({ projectId: project.id })
				.filter(t => !t.archived && !doneIds.has(t.status));
			overdue   += tickets.filter(t => t.dueDate && t.dueDate < todayStart.getTime()).length;
			dueToday  += tickets.filter(t => t.dueDate && t.dueDate >= todayStart.getTime() && t.dueDate <= todayEnd.getTime()).length;
			const sprint = this.plugin.store.getSprints(project.id).find(s => s.status === 'active');
			if (sprint && sprint.endDate - now <= 2 * 86400000 && sprint.endDate > now) endingSoon++;
		}

		this._summaryStats = { overdue, dueToday, endingSoon };

		this.checkTicketReminders();
		this.updateBadge();
		this.refreshPanel();
	}

	private checkProject(projectId: string, triggers: Record<string, NotificationTriggerConfig>): void {
		const now = Date.now();
		const today = new Date(); today.setHours(0, 0, 0, 0);

		const project = this.plugin.store.getProject(projectId);
		const projectStatuses = this.plugin.store.getProjectStatuses(projectId);
		const doneStatusIds = new Set(projectStatuses.filter(s => s.universalId === 'done').map(s => s.id));
		const allTickets = this.plugin.store.getTickets({ projectId }).filter(t => !t.archived);
		const tickets = allTickets.filter(t => !doneStatusIds.has(t.status));
		const sprints = this.plugin.store.getSprints(projectId);
		const activeSprint = sprints.find(s => s.status === 'active') ?? null;
		const useSprints = this.plugin.store.getProjectUseSprints(projectId);

		const ctx: ProjectCheckContext = {
			projectId,
			projectName: project?.name ?? projectId,
			projectTag:  project?.tag  ?? '',
			now,
			todayMs: today.getTime(),
			tickets,
			allTickets,
			activeSprint,
			useSprints,
			triggers,
		};

		for (const rule of ALL_PROJECT_RULES) {
			if (!triggers[rule.type]?.enabled) continue;
			for (const partial of rule.check(ctx)) {
				this.maybeAdd({ id: uid(), createdAt: now, dismissed: false, read: false, ...partial });
			}
		}
	}

	private checkTicketReminders(): void {
		const now = Date.now();
		const settings = this.plugin.store.getNotificationSettings();
		if (!settings.triggers['ticket_reminder']?.enabled) return;

		const allTickets = this.plugin.store.getProjects().flatMap(p => {
			const pStatuses = this.plugin.store.getProjectStatuses(p.id);
			const pDoneIds = new Set(pStatuses.filter(s => s.universalId === 'done').map(s => s.id));
			return this.plugin.store.getTickets({ projectId: p.id }).filter(t => !t.archived && !pDoneIds.has(t.status));
		});

		for (const ticket of allTickets) {
			if (!ticket.reminders?.length) continue;
			for (const reminder of ticket.reminders) {
				const anchorTime = reminder.anchor === 'start' ? ticket.startDate : ticket.dueDate;
				if (!anchorTime) continue;
				const fireAt = anchorTime - reminder.offsetMinutes * 60000;
				if (now < fireAt) continue;

				const offsetLabel = reminder.offsetMinutes >= 60
					? `${reminder.offsetMinutes / 60}h`
					: `${reminder.offsetMinutes}min`;

				this.maybeAdd({
					id: uid(),
					projectId: ticket.projectId,
					ticketId: ticket.id,
					reminderId: reminder.id,
					type: 'ticket_reminder',
					title: `Reminder: ${ticket.title}`,
					body: `${offsetLabel} before ${reminder.anchor === 'start' ? 'start' : 'due'} time.`,
					createdAt: now,
					dismissed: false,
					read: false,
				});
			}
		}
	}

	// ── Dedup + persist ───────────────────────────────────────────────────────

	private maybeAdd(notification: StoredNotification): void {
		const existing = this.plugin.store.getNotifications();
		const now = Date.now();

		const duplicate = existing.find(n => {
			if (n.dismissed) return false;
			if (n.type !== notification.type) return false;
			if (n.projectId !== notification.projectId) return false;
			if (n.ticketId !== notification.ticketId) return false;
			if (n.sprintId !== notification.sprintId) return false;
			if (n.reminderId !== notification.reminderId) return false;
			return now - n.createdAt < DEDUP_WINDOW_MS;
		});

		if (duplicate) return;

		this.plugin.store.addNotification(notification);
		this.fireOS(notification);
	}

	private fireOS(notification: StoredNotification): void {
		if (typeof window === 'undefined') return;
		if (!('Notification' in window)) return;
		if (window.Notification.permission !== 'granted') return;
		new window.Notification(`ProjectFlow: ${notification.title}`, { body: notification.body, silent: false, tag: 'projectflow' });
	}

	private requestOsPermission(): void {
		if (typeof window === 'undefined') return;
		if (!('Notification' in window)) return;
		if (window.Notification.permission === 'default') {
			window.Notification.requestPermission();
		}
	}

	// ── Badge ─────────────────────────────────────────────────────────────────

	updateBadge(): void {
		if (this.badgeEls.length === 0) return;
		const now = Date.now();
		const count = this.plugin.store.getNotifications().filter(n =>
			!n.dismissed && !n.read && (!n.snoozedUntil || n.snoozedUntil <= now)
		).length;
		const text = count > 0 ? String(count > 99 ? '99+' : count) : '';
		const display = count > 0 ? 'flex' : 'none';
		for (const el of this.badgeEls) {
			el.setText(text);
			el.style.display = display;
		}
	}

	// ── Panel refresh callback ────────────────────────────────────────────────

	refreshPanel(): void {
		if (this._suppressRefresh) return;
		this.plugin.refreshNotificationPanel();
	}
}
