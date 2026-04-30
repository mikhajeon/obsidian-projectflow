import { App, Modal, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { CalendarCardAppearance, CalendarViewMode, CalendarViewAppearance } from '../types';

type TabId = CalendarViewMode;

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: 'month',  label: 'Month',  icon: 'calendar' },
	{ id: 'week',   label: 'Week',   icon: 'calendar-days' },
	{ id: 'day',    label: 'Day',    icon: 'calendar-check' },
	{ id: 'agenda', label: 'Agenda', icon: 'list' },
];

const TOGGLES_CHIP: { key: keyof CalendarCardAppearance; label: string; desc: string }[] = [
	{ key: 'typeBadge',      label: 'Type badge',      desc: 'T / B / S letter indicating ticket type' },
	{ key: 'priorityEdge',   label: 'Priority edge',   desc: 'Colored left border based on priority' },
	{ key: 'timeDisplay',    label: 'Time display',    desc: 'Due time on ticket cards' },
	{ key: 'projectDot',     label: 'Project dot',     desc: 'Colored dot when multiple projects are shown' },
	{ key: 'recurrenceIcon', label: 'Recurrence icon', desc: '↻ symbol on recurring tickets' },
];

const TOGGLES_AGENDA: { key: keyof CalendarCardAppearance; label: string; desc: string }[] = [
	{ key: 'typeBadge',    label: 'Type badge',    desc: 'T / B / S letter indicating ticket type' },
	{ key: 'priorityEdge', label: 'Priority edge', desc: 'Colored left border based on priority' },
	{ key: 'timeDisplay',  label: 'Time display',  desc: 'Due time on agenda items' },
	{ key: 'ticketKey',    label: 'Ticket key',    desc: 'Project tag + number (e.g. DBA-42)' },
	{ key: 'statusBadge',  label: 'Status badge',  desc: 'Status label pill' },
];

export class CalendarSettingsModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private onUpdate: () => void;
	private static lastTab: TabId = 'month';
	private activeTab: TabId;

	constructor(app: App, plugin: ProjectFlowPlugin, onUpdate: () => void, initialTab?: CalendarViewMode) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate;
		this.activeTab = initialTab ?? CalendarSettingsModal.lastTab;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal', 'pf-cal-settings-modal');

		const tabBar = contentEl.createEl('div', { cls: 'pf-cal-settings-tabs' });
		const contentArea = contentEl.createEl('div', { cls: 'pf-cal-settings-content' });

		const showTab = (id: TabId) => {
			this.activeTab = id;
			CalendarSettingsModal.lastTab = id;
			tabBar.querySelectorAll('.pf-cal-settings-tab').forEach(el => el.removeClass('active'));
			tabBar.querySelector(`[data-tab="${id}"]`)?.addClass('active');
			contentArea.empty();
			this.renderViewTab(id, contentArea);
		};

		for (const tab of TABS) {
			const btn = tabBar.createEl('button', {
				cls: 'pf-cal-settings-tab' + (tab.id === this.activeTab ? ' active' : ''),
				attr: { 'data-tab': tab.id },
			});
			const iconEl = btn.createEl('span', { cls: 'pf-cal-settings-tab-icon' });
			setIcon(iconEl, tab.icon);
			btn.createEl('span', { text: tab.label });
			btn.addEventListener('click', () => showTab(tab.id));
		}

		this.renderViewTab(this.activeTab, contentArea);
	}

	private renderViewTab(viewMode: TabId, container: HTMLElement): void {
		const allAppearance = this.plugin.store.getCalendarCardAppearance();
		const appearance = allAppearance[viewMode];
		const toggles = viewMode === 'agenda' ? TOGGLES_AGENDA : TOGGLES_CHIP;

		const section = container.createEl('div', { cls: 'pf-cal-settings-section' });
		section.createEl('p', { cls: 'pf-cal-settings-section-desc', text: 'Show or hide elements on calendar ticket cards.' });

		for (const { key, label, desc } of toggles) {
			const row = section.createEl('div', { cls: 'pf-cal-settings-toggle-row' });
			const left = row.createEl('div', { cls: 'pf-cal-settings-toggle-left' });
			left.createEl('span', { cls: 'pf-cal-settings-toggle-label', text: label });
			left.createEl('span', { cls: 'pf-cal-settings-toggle-desc', text: desc });

			const toggle = row.createEl('div', { cls: 'pf-cal-settings-toggle' + (appearance[key] ? ' active' : '') });
			toggle.addEventListener('click', () => {
				const current = this.plugin.store.getCalendarCardAppearance();
				const updated: CalendarViewAppearance = {
					...current,
					[viewMode]: { ...current[viewMode], [key]: !current[viewMode][key] },
				};
				toggle.toggleClass('active', updated[viewMode][key]);
				this.plugin.store.setCalendarCardAppearance(updated).catch(() => {});
				this.onUpdate();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
