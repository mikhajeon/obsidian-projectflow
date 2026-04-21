import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { StoredNotification, SnoozeInterval } from '../types';

export const NOTIFICATION_VIEW_TYPE = 'pf-notifications';

function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

function isToday(ms: number): boolean {
	const d = new Date(ms);
	const now = new Date();
	return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export class NotificationPanelView extends ItemView {
	private plugin: ProjectFlowPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return NOTIFICATION_VIEW_TYPE; }
	getDisplayText(): string { return 'Notification Flow'; }
	getIcon(): string { return 'bell'; }

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	refresh(): void {
		this.render();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-notif-panel');

		// Header
		const header = contentEl.createDiv('pf-notif-header');
		header.createEl('span', { cls: 'pf-notif-title', text: 'Notification Flow' });
		const actions = header.createDiv('pf-notif-header-actions');

		const markAllBtn = actions.createEl('button', { cls: 'pf-notif-btn-sm', text: 'Mark all read' });
		markAllBtn.addEventListener('click', async () => {
			await this.plugin.notificationManager?.markAllRead();
			this.render();
		});

		const clearBtn = actions.createEl('button', { cls: 'pf-notif-btn-sm', text: 'Clear dismissed' });
		clearBtn.addEventListener('click', async () => {
			await this.plugin.store.clearDismissed();
			this.plugin.notificationManager?.updateBadge();
			this.render();
		});

		// Summary banner
		this.renderSummaryBanner(contentEl);

		// Body
		const body = contentEl.createDiv('pf-notif-body');
		const now = Date.now();
		const all = this.plugin.store.getNotifications()
			.filter(n => !n.dismissed && (!n.snoozedUntil || n.snoozedUntil <= now))
			.sort((a, b) => b.createdAt - a.createdAt);

		if (all.length === 0) {
			const empty = body.createDiv('pf-notif-empty');
			const emptyIcon = empty.createEl('span', { cls: 'pf-notif-empty-icon' });
			setIcon(emptyIcon, 'bell');
			empty.createEl('p', { text: 'No notifications' });
			return;
		}

		const todayItems = all.filter(n => isToday(n.createdAt));
		const earlierItems = all.filter(n => !isToday(n.createdAt));

		if (todayItems.length > 0) {
			body.createEl('div', { cls: 'pf-notif-group-label', text: 'Today' });
			for (const n of todayItems) this.renderCard(body, n);
		}

		if (earlierItems.length > 0) {
			body.createEl('div', { cls: 'pf-notif-group-label', text: 'Earlier' });
			for (const n of earlierItems) this.renderCard(body, n);
		}
	}

	private renderSummaryBanner(parent: HTMLElement): void {
		const { overdue, dueToday, endingSoon } = this.plugin.notificationManager?.getSummaryStats()
			?? { overdue: 0, dueToday: 0, endingSoon: 0 };

		const banner = parent.createDiv('pf-notif-summary');

		if (overdue === 0 && dueToday === 0 && endingSoon === 0) {
			const clear = banner.createEl('span', { cls: 'pf-notif-summary-clear' });
			setIcon(clear.createEl('span', { cls: 'pf-notif-summary-icon' }), 'check-circle');
			clear.createEl('span', { text: 'All clear' });
			return;
		}

		const pills: { icon: string; count: number; label: string; mod: string }[] = [
			{ icon: 'alert-circle', count: overdue,    label: 'overdue',       mod: 'overdue' },
			{ icon: 'clock',        count: dueToday,   label: 'due today',     mod: 'today'   },
			{ icon: 'zap',          count: endingSoon, label: 'sprint ending', mod: 'sprint'  },
		];

		for (const pill of pills) {
			const el = banner.createEl('span', {
				cls: `pf-notif-summary-pill${pill.count > 0 ? ` pf-notif-summary-pill--${pill.mod}` : ''}`,
			});
			setIcon(el.createEl('span', { cls: 'pf-notif-summary-icon' }), pill.icon);
			el.createEl('span', { text: `${pill.count} ${pill.label}` });
		}
	}

	private renderCard(parent: HTMLElement, n: StoredNotification): void {
		const card = parent.createDiv({ cls: `pf-notif-card${n.read ? ' pf-notif-card--read' : ''}` });

		// Mark read on render if not already
		if (!n.read) {
			this.plugin.store.updateNotification(n.id, { read: true });
			this.plugin.notificationManager?.updateBadge();
		}

		// Colored dot
		const dot = card.createEl('span', { cls: 'pf-notif-card-dot' });
		if (n.projectId) {
			const project = this.plugin.store.getProject(n.projectId);
			if (project?.color) dot.style.background = project.color;
		}

		// Content wrapper (sits next to the dot)
		const content = card.createDiv('pf-notif-card-content');

		// Top row: title + timestamp
		const top = content.createDiv('pf-notif-card-top');
		top.createEl('span', { cls: 'pf-notif-card-title', text: n.title });
		top.createEl('span', { cls: 'pf-notif-card-time', text: timeAgo(n.createdAt) });

		// Project chip
		if (n.projectId) {
			const project = this.plugin.store.getProject(n.projectId);
			if (project) {
				const chip = content.createEl('span', { cls: 'pf-notif-chip', text: project.tag });
				if (project.color) chip.style.background = project.color + '33';
			}
		}

		// Body text
		content.createEl('p', { cls: 'pf-notif-card-body', text: n.body });

		// Actions
		const actionRow = content.createDiv('pf-notif-card-actions');

		if (n.ticketId) {
			const openBtn = actionRow.createEl('button', { cls: 'pf-notif-action-btn', text: 'Open ticket' });
			openBtn.addEventListener('click', () => {
				const ticket = this.plugin.store.getTicket(n.ticketId!);
				if (ticket) this.plugin.openTicketModal(ticket);
			});

			const boardBtn = actionRow.createEl('button', { cls: 'pf-notif-action-btn', text: 'Go to board' });
			boardBtn.addEventListener('click', () => {
				this.plugin.activateView('board');
			});
		}

		if (n.sprintId) {
			const sprintBtn = actionRow.createEl('button', { cls: 'pf-notif-action-btn', text: 'Open sprint' });
			sprintBtn.addEventListener('click', () => {
				this.plugin.activateView('board');
			});
		}

		// Snooze dropdown
		const snoozeIntervals = this.plugin.notificationManager?.resolveSnoozeIntervals(n) ?? [];
		if (snoozeIntervals.length > 0) {
			const snoozeWrap = actionRow.createDiv('pf-notif-snooze-wrap');
			const snoozeBtn = snoozeWrap.createEl('button', { cls: 'pf-notif-action-btn', text: 'Snooze ▾' });
			const snoozeMenu = snoozeWrap.createDiv('pf-notif-snooze-menu');
			snoozeMenu.style.display = 'none';

			for (const interval of snoozeIntervals) {
				const item = snoozeMenu.createEl('div', { cls: 'pf-notif-snooze-item', text: interval.label });
				item.addEventListener('click', async (e) => {
					e.stopPropagation();
					await this.plugin.notificationManager?.snooze(n.id, interval);
					this.render();
				});
			}

			snoozeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const isOpen = snoozeMenu.style.display !== 'none';
				snoozeMenu.style.display = isOpen ? 'none' : 'block';
			});

			document.addEventListener('click', () => { snoozeMenu.style.display = 'none'; }, { once: true });
		}

		// Dismiss
		const dismissBtn = actionRow.createEl('button', { cls: 'pf-notif-action-btn pf-notif-action-btn--dismiss', text: 'Dismiss' });
		dismissBtn.addEventListener('click', async () => {
			await this.plugin.notificationManager?.dismiss(n.id);
			this.render();
		});
	}
}
