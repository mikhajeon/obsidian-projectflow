import { App, Modal, Setting } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { ProjectNotificationSettings, NotificationTriggerConfig } from '../types';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types';

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
			{ id: 'ticket_due_today', label: 'Due today' },
			{ id: 'ticket_due_approaching', label: 'Due date approaching', threshold: { key: 'daysBeforeDue', label: 'Days before', min: 1, max: 30 } },
			{ id: 'ticket_overdue', label: 'Overdue' },
			{ id: 'ticket_stale_in_progress', label: 'Stale in progress', threshold: { key: 'staleThresholdDays', label: 'Days', min: 1, max: 60 } },
			{ id: 'ticket_no_due_date', label: 'No due date set' },
			{ id: 'ticket_no_sprint', label: 'No sprint assigned' },
			{ id: 'ticket_reminder', label: 'Per-ticket reminders' },
		],
	},
	{
		heading: 'Sprint',
		rows: [
			{ id: 'sprint_ending_soon', label: 'Ending soon', threshold: { key: 'daysBeforeSprintEnd', label: 'Days before', min: 1, max: 14 } },
			{ id: 'sprint_ends_today', label: 'Ends today' },
			{ id: 'sprint_overdue', label: 'Overdue' },
			{ id: 'sprint_completed', label: 'Completed' },
			{ id: 'sprint_started', label: 'Started' },
			{ id: 'sprint_none_active', label: 'None active' },
		],
	},
	{
		heading: 'Project',
		rows: [
			{ id: 'project_overdue_tickets', label: 'Has overdue tickets' },
			{ id: 'project_idle', label: 'Idle project', threshold: { key: 'idleThresholdDays', label: 'Days', min: 1, max: 90 } },
			{ id: 'project_no_active_sprint', label: 'No active sprint' },
		],
	},
];

export class ProjectNotificationModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private projectId: string;
	private projectName: string;
	private settings: ProjectNotificationSettings;

	constructor(app: App, plugin: ProjectFlowPlugin, projectId: string, projectName: string) {
		super(app);
		this.plugin = plugin;
		this.projectId = projectId;
		this.projectName = projectName;
		this.settings = structuredClone(plugin.store.getProjectNotificationSettings(projectId));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(520px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		const header = contentEl.createDiv('pf-modal-header');
		header.createEl('span', { cls: 'pf-modal-label', text: `Notifications — ${this.projectName}` });
		header.createEl('button', { cls: 'pf-modal-close', text: '×' })
			.addEventListener('click', () => this.close());

		const body = contentEl.createDiv('pf-modal-body');

		new Setting(body)
			.setName('Use global settings')
			.setDesc('When on, this project inherits the plugin-wide notification settings.')
			.addToggle(t => {
				t.setValue(this.settings.useGlobal);
				t.onChange(val => {
					this.settings.useGlobal = val;
					overrideSection.style.display = val ? 'none' : 'block';
				});
			});

		const overrideSection = body.createDiv();
		overrideSection.style.display = this.settings.useGlobal ? 'none' : 'block';

		const globalTriggers = this.plugin.store.getNotificationSettings().triggers;

		for (const group of TRIGGER_GROUPS) {
			new Setting(overrideSection).setName(group.heading).setHeading();

			for (const row of group.rows) {
				const effective: NotificationTriggerConfig =
					this.settings.triggers[row.id] ?? globalTriggers[row.id] ?? { enabled: false };

				const s = new Setting(overrideSection).setName(row.label);

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
								if (!this.settings.triggers[row.id]) this.settings.triggers[row.id] = { ...effective };
								(this.settings.triggers[row.id] as unknown as Record<string, unknown>)[threshKey] = v;
							}
						});
					});
				}

				s.addToggle(t => {
					t.setValue(effective.enabled);
					t.onChange(val => {
						if (!this.settings.triggers[row.id]) this.settings.triggers[row.id] = { ...effective };
						this.settings.triggers[row.id]!.enabled = val;
					});
				});
			}
		}

		const footer = contentEl.createDiv('pf-modal-footer');
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Save' })
			.addEventListener('click', async () => {
				await this.plugin.store.saveProjectNotificationSettings(this.projectId, this.settings);
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
