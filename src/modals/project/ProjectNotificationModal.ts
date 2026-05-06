import { App, Modal, Setting } from 'obsidian';
import type ProjectFlowPlugin from '../../main';
import type { ProjectNotificationSettings, NotificationTriggerConfig, NotificationSettings } from '../../types';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../types';

interface TriggerRow {
	id: keyof typeof DEFAULT_NOTIFICATION_SETTINGS.triggers;
	label: string;
	desc?: string;
	threshold?: { key: keyof NotificationTriggerConfig; label: string; min: number; max: number };
}

const TRIGGER_GROUPS: { heading: string; rows: TriggerRow[] }[] = [
	{
		heading: 'Ticket',
		rows: [
			{ id: 'ticket_due_today', label: 'Due today', desc: 'Alert when a ticket\'s due date is today.' },
			{ id: 'ticket_due_approaching', label: 'Due date approaching', desc: 'Warn N days before a ticket\'s due date arrives.', threshold: { key: 'daysBeforeDue', label: 'Days before', min: 1, max: 30 } },
			{ id: 'ticket_overdue', label: 'Overdue', desc: 'Alert when a ticket has passed its due date without being completed.' },
			{ id: 'ticket_stale_in_progress', label: 'Stale in progress', desc: 'Flag tickets stuck in "In Progress" for longer than N days.', threshold: { key: 'staleThresholdDays', label: 'Days', min: 1, max: 60 } },
			{ id: 'ticket_no_due_date', label: 'No due date set', desc: 'Remind you to add a due date to tickets that are missing one.' },
			{ id: 'ticket_no_sprint', label: 'No sprint assigned', desc: 'Notify when a ticket exists outside any sprint.' },
			{ id: 'ticket_reminder', label: 'Per-ticket reminders', desc: 'Fire reminders that have been manually set on individual tickets.' },
		],
	},
	{
		heading: 'Sprint',
		rows: [
			{ id: 'sprint_ending_soon', label: 'Ending soon', desc: 'Warn N days before the active sprint\'s end date.', threshold: { key: 'daysBeforeSprintEnd', label: 'Days before', min: 1, max: 14 } },
			{ id: 'sprint_ends_today', label: 'Ends today', desc: 'Alert when the active sprint ends today.' },
			{ id: 'sprint_overdue', label: 'Overdue', desc: 'Notify when a sprint has passed its end date without being completed.' },
			{ id: 'sprint_completed', label: 'Completed', desc: 'Confirm when a sprint is marked as complete.' },
			{ id: 'sprint_started', label: 'Started', desc: 'Confirm when a new sprint is kicked off.' },
			{ id: 'sprint_none_active', label: 'None active', desc: 'Notify when a project has no active sprint running.' },
		],
	},
	{
		heading: 'Project',
		rows: [
			{ id: 'project_overdue_tickets', label: 'Has overdue tickets', desc: 'Alert when any ticket in the project is past its due date.' },
			{ id: 'project_idle', label: 'Idle project', desc: 'Flag projects with no ticket activity in the last N days.', threshold: { key: 'idleThresholdDays', label: 'Days', min: 1, max: 90 } },
			{ id: 'project_no_active_sprint', label: 'No active sprint', desc: 'Notify when a project has been without an active sprint for a while.' },
		],
	},
];

export class ProjectNotificationModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private projectId: string;
	private projectName: string;
	private projectSettings: ProjectNotificationSettings;
	private globalSettings: NotificationSettings;

	constructor(app: App, plugin: ProjectFlowPlugin, projectId: string, projectName: string) {
		super(app);
		this.plugin = plugin;
		this.projectId = projectId;
		this.projectName = projectName;
		this.projectSettings = structuredClone(plugin.store.getProjectNotificationSettings(projectId));
		this.globalSettings = structuredClone(plugin.store.getNotificationSettings());
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(560px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		const header = contentEl.createDiv('pf-modal-header');
		header.createEl('span', { cls: 'pf-modal-label', text: `Notifications — ${this.projectName}` });
		header.createEl('button', { cls: 'pf-modal-close', text: '×' })
			.addEventListener('click', () => this.close());

		const body = contentEl.createDiv('pf-modal-body');

		// Tab bar
		const tabBar = body.createDiv('pf-modal-tab-bar');
		const globalTabBtn = tabBar.createEl('button', { cls: 'pf-modal-tab pf-modal-tab--active', text: 'Global' });
		const projectTabBtn = tabBar.createEl('button', { cls: 'pf-modal-tab', text: 'Project-specific' });

		const globalPane = body.createDiv('pf-modal-tab-pane');
		const projectPane = body.createDiv('pf-modal-tab-pane');
		projectPane.style.display = 'none';

		globalTabBtn.addEventListener('click', () => {
			globalTabBtn.addClass('pf-modal-tab--active');
			projectTabBtn.removeClass('pf-modal-tab--active');
			globalPane.style.display = 'block';
			projectPane.style.display = 'none';
		});
		projectTabBtn.addEventListener('click', () => {
			projectTabBtn.addClass('pf-modal-tab--active');
			globalTabBtn.removeClass('pf-modal-tab--active');
			projectPane.style.display = 'block';
			globalPane.style.display = 'none';
		});

		this.renderGlobalTab(globalPane);
		this.renderProjectTab(projectPane);

		const footer = contentEl.createDiv('pf-modal-footer');
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Save' })
			.addEventListener('click', async () => {
				await this.plugin.store.saveNotificationSettings(this.globalSettings);
				await this.plugin.store.saveProjectNotificationSettings(this.projectId, this.projectSettings);
				this.plugin.notificationManager?.updateBadge();
				this.close();
			});
	}

	private renderGlobalTab(container: HTMLElement): void {
		const settings = this.globalSettings;

		// Snooze intervals
		new Setting(container).setName('Snooze intervals').setHeading();

		const snoozeContainer = container.createDiv('pf-notif-settings-snooze');
		const renderSnoozeRows = () => {
			snoozeContainer.empty();
			settings.snoozeIntervals.forEach((interval, i) => {
				const row = snoozeContainer.createDiv('pf-notif-snooze-row');
				const labelInput = row.createEl('input', { type: 'text', cls: 'pf-input pf-notif-snooze-label' });
				labelInput.value = interval.label;
				labelInput.placeholder = 'Label';
				labelInput.addEventListener('input', () => { settings.snoozeIntervals[i].label = labelInput.value; });

				const minInput = row.createEl('input', { type: 'number', cls: 'pf-input pf-input-short pf-notif-snooze-min' });
				minInput.value = String(interval.minutes);
				minInput.min = '0';
				minInput.placeholder = 'min';
				minInput.title = '0 = tomorrow (next midnight)';
				minInput.addEventListener('input', () => {
					const v = parseInt(minInput.value, 10);
					if (!isNaN(v) && v >= 0) settings.snoozeIntervals[i].minutes = v;
				});

				row.createEl('span', { cls: 'pf-notif-snooze-unit', text: 'min' });

				if (settings.snoozeIntervals.length > 1) {
					row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' })
						.addEventListener('click', () => {
							settings.snoozeIntervals.splice(i, 1);
							renderSnoozeRows();
						});
				}
			});

			snoozeContainer.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add interval' })
				.addEventListener('click', () => {
					settings.snoozeIntervals.push({ label: 'Custom', minutes: 60 });
					renderSnoozeRows();
				});
		};
		renderSnoozeRows();

		// Trigger groups
		for (const group of TRIGGER_GROUPS) {
			new Setting(container).setName(group.heading).setHeading();
			for (const row of group.rows) {
				const cfg = settings.triggers[row.id] ?? DEFAULT_NOTIFICATION_SETTINGS.triggers[row.id];
				const s = new Setting(container).setName(row.label);
				if (row.desc) s.setDesc(row.desc);
				if (row.threshold) {
					s.addText(text => {
						text.inputEl.type = 'number';
						text.inputEl.addClass('pf-input-short');
						text.inputEl.min = String(row.threshold!.min);
						text.inputEl.max = String(row.threshold!.max);
						text.inputEl.value = String((cfg as unknown as Record<string, unknown>)[row.threshold!.key] ?? '');
						text.inputEl.placeholder = row.threshold!.label;
						text.inputEl.addEventListener('input', () => {
							const v = parseInt(text.inputEl.value, 10);
							if (!isNaN(v)) (settings.triggers[row.id] as unknown as Record<string, unknown>)[row.threshold!.key] = v;
						});
					});
				}
				s.addToggle(t => {
					t.setValue(cfg?.enabled ?? false);
					t.onChange(val => { settings.triggers[row.id].enabled = val; });
				});
			}
		}
	}

	private renderProjectTab(container: HTMLElement): void {
		const globalTriggers = this.globalSettings.triggers;

		new Setting(container)
			.setName('Use global settings')
			.setDesc('When on, this project inherits the global notification trigger settings.')
			.addToggle(t => {
				t.setValue(this.projectSettings.useGlobal);
				t.onChange(val => {
					this.projectSettings.useGlobal = val;
					overrideSection.style.display = val ? 'none' : 'block';
				});
			});

		const overrideSection = container.createDiv();
		overrideSection.style.display = this.projectSettings.useGlobal ? 'none' : 'block';

		for (const group of TRIGGER_GROUPS) {
			new Setting(overrideSection).setName(group.heading).setHeading();
			for (const row of group.rows) {
				const effective: NotificationTriggerConfig =
					this.projectSettings.triggers[row.id] ?? globalTriggers[row.id] ?? { enabled: false };

				const s = new Setting(overrideSection).setName(row.label);
				if (row.desc) s.setDesc(row.desc);

				if (row.threshold) {
					const threshKey = row.threshold.key;
					s.addText(text => {
						text.inputEl.type = 'number';
						text.inputEl.min = String(row.threshold!.min);
						text.inputEl.max = String(row.threshold!.max);
						text.inputEl.addClass('pf-input-short');
						text.inputEl.value = String((effective as unknown as Record<string, unknown>)[threshKey] ?? '');
						text.inputEl.placeholder = row.threshold!.label;
						text.inputEl.addEventListener('input', () => {
							const v = parseInt(text.inputEl.value, 10);
							if (!isNaN(v)) {
								if (!this.projectSettings.triggers[row.id]) this.projectSettings.triggers[row.id] = { ...effective };
								(this.projectSettings.triggers[row.id] as unknown as Record<string, unknown>)[threshKey] = v;
							}
						});
					});
				}

				s.addToggle(t => {
					t.setValue(effective.enabled);
					t.onChange(val => {
						if (!this.projectSettings.triggers[row.id]) this.projectSettings.triggers[row.id] = { ...effective };
						this.projectSettings.triggers[row.id]!.enabled = val;
					});
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
