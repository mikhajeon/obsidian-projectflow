import { App, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';
import type ProjectFlowPlugin from './main';
import { ProjectModal } from './modals/ProjectModal';
import { ConfirmModal } from './modals/ConfirmModal';
import { ticketFilePath } from './ticketNote';
import type { NotificationSettings, SnoozeInterval } from './types';
import { DEFAULT_NOTIFICATION_SETTINGS } from './types';

export class ProjectFlowSettingTab extends PluginSettingTab {
	plugin: ProjectFlowPlugin;

	constructor(app: App, plugin: ProjectFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Notifications ─────────────────────────────────────────────────────
		this.renderNotificationSettings(containerEl);

		// ── Storage ──────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Storage').setHeading();

		new Setting(containerEl)
			.setName('Base folder')
			.setDesc('Vault folder that contains all ProjectFlow data. Files are stored under {Base folder}/{Project}/Tickets/ and {Base folder}/{Project}/Sprint Histories/.')
			.addText(text => {
				text
					.setPlaceholder('ProjectFlow')
					.setValue(this.plugin.store.getBaseFolder());
				text.inputEl.addClass('pf-input-full');
				text.inputEl.addEventListener('blur', async () => {
					const val = text.getValue().trim();
					if (val) {
						new Notice('Note: Renaming the base folder does not move existing vault files. You may need to move them manually.');
						await this.plugin.store.setBaseFolder(val);
					}
				});
			});

		// ── Projects ──────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Projects').setHeading();

		const projects = this.plugin.store.getProjects();
		const activeId = this.plugin.store.getActiveProjectId();

		new Setting(containerEl)
			.setName('New project')
			.setDesc('Create a new project with sprint cycle settings.')
			.addButton(btn =>
				btn
					.setButtonText('Create project')
					.setCta()
					.onClick(() => {
						new ProjectModal(this.app, this.plugin, null, () => this.display()).open();
					})
			);

		if (projects.length === 0) {
			containerEl.createEl('p', {
				cls: 'pf-settings-empty',
				text: 'No projects yet. Create one above.',
			});
			return;
		}

		new Setting(containerEl)
			.setName('Active project')
			.setDesc('The project shown in the board and sprint views.')
			.addDropdown(drop => {
				for (const p of projects) {
					drop.addOption(p.id, p.name);
				}
				drop.setValue(activeId ?? '');
				drop.onChange(async (val) => {
					await this.plugin.store.setActiveProject(val);
					this.plugin.refreshAllViews();
				});
			});

		new Setting(containerEl).setName('Manage projects').setHeading();

		for (const project of projects) {
			const sprints = this.plugin.store.getSprints(project.id);
			const tickets = this.plugin.store.getTickets({ projectId: project.id });

			new Setting(containerEl)
				.setName(project.name)
				.setDesc(
					`${project.description || 'No description'} · ${project.cycleDays}-day cycles · ${sprints.length} sprint(s) · ${tickets.length} ticket(s)`
				)
				.addButton(btn =>
					btn.setButtonText('Edit').onClick(() => {
						new ProjectModal(this.app, this.plugin, project, () => this.display()).open();
					})
				)
				.addButton(btn =>
					btn.setButtonText('Archive').onClick(() => {
						new ConfirmModal(this.app, `Archive project "${project.name}"? It will be hidden from all views but can be restored below.`, async () => {
							await this.plugin.store.archiveProject(project.id);
							new Notice(`Project "${project.name}" archived.`);
							this.display();
							this.plugin.refreshAllViews();
						}).open();
					})
				)
				.addButton(btn =>
					btn
						.setButtonText('Delete')
						.setWarning()
						.onClick(() => {
							new ConfirmModal(this.app, `Delete project "${project.name}"? All sprints and tickets will be permanently removed.`, async () => {
								// Include archived tickets so their note files are also cleaned up
								const projectTickets = this.plugin.store.getAllTicketsForProject(project.id);
								for (const ticket of projectTickets) {
									const tfile = this.app.vault.getAbstractFileByPath(ticketFilePath(this.plugin, project.name, ticket));
									if (tfile instanceof TFile) {
										this.plugin.markDeleting(ticket.id);
										await this.app.fileManager.trashFile(tfile);
									}
								}
								await this.plugin.store.deleteProject(project.id);
								new Notice(`Project "${project.name}" deleted.`);
								this.display();
								this.plugin.refreshAllViews();
							}).open();
						})
				);
		}

		// ── Archived projects ─────────────────────────────────────────────────
		const archivedProjects = this.plugin.store.getArchivedProjects();
		if (archivedProjects.length > 0) {
			new Setting(containerEl).setName('Archived projects').setHeading();

			for (const project of archivedProjects) {
				const archivedDate = project.archivedAt
					? new Date(project.archivedAt).toLocaleDateString()
					: 'Unknown date';

				new Setting(containerEl)
					.setName(project.name)
					.setDesc(`Archived on ${archivedDate}${project.description ? ' · ' + project.description : ''}`)
					.addButton(btn =>
						btn.setButtonText('Restore').onClick(async () => {
							await this.plugin.store.unarchiveProject(project.id);
							new Notice(`Project "${project.name}" restored.`);
							this.display();
							this.plugin.refreshAllViews();
						})
					)
					.addButton(btn =>
						btn
							.setButtonText('Delete permanently')
							.setWarning()
							.onClick(() => {
								new ConfirmModal(this.app, `Permanently delete archived project "${project.name}"? All sprints and tickets will be removed.`, async () => {
									const projectTickets = this.plugin.store.getAllTicketsForProject(project.id);
									for (const ticket of projectTickets) {
										const tfile = this.app.vault.getAbstractFileByPath(ticketFilePath(this.plugin, project.name, ticket));
										if (tfile instanceof TFile) {
											this.plugin.markDeleting(ticket.id);
											await this.app.fileManager.trashFile(tfile);
										}
									}
									await this.plugin.store.deleteProject(project.id);
									new Notice(`Project "${project.name}" permanently deleted.`);
									this.display();
									this.plugin.refreshAllViews();
								}).open();
							})
					);
			}
		}
	}

	private renderNotificationSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Notifications').setHeading();

		const settings: NotificationSettings = structuredClone(this.plugin.store.getNotificationSettings());

		const save = async () => {
			await this.plugin.store.saveNotificationSettings(settings);
			this.plugin.notificationManager?.updateBadge();
		};

		new Setting(containerEl)
			.setName('Enable notifications')
			.setDesc('Master toggle for all ProjectFlow notifications.')
			.addToggle(t => {
				t.setValue(settings.enabled);
				t.onChange(async val => { settings.enabled = val; await save(); });
			});

		// ── Snooze intervals ─────────────────────────────────────────────────
		new Setting(containerEl).setName('Snooze intervals').setHeading();

		const snoozeContainer = containerEl.createDiv('pf-notif-settings-snooze');
		const renderSnoozeRows = () => {
			snoozeContainer.empty();
			settings.snoozeIntervals.forEach((interval, i) => {
				const row = snoozeContainer.createDiv('pf-notif-snooze-row');
				const labelInput = row.createEl('input', { type: 'text', cls: 'pf-input pf-notif-snooze-label' });
				labelInput.value = interval.label;
				labelInput.placeholder = 'Label';
				labelInput.addEventListener('input', () => { settings.snoozeIntervals[i].label = labelInput.value; save(); });

				const minInput = row.createEl('input', { type: 'number', cls: 'pf-input pf-input-short pf-notif-snooze-min' });
				minInput.value = String(interval.minutes);
				minInput.min = '0';
				minInput.placeholder = 'min';
				minInput.title = '0 = tomorrow (next midnight)';
				minInput.addEventListener('input', () => {
					const v = parseInt(minInput.value, 10);
					if (!isNaN(v) && v >= 0) { settings.snoozeIntervals[i].minutes = v; save(); }
				});

				row.createEl('span', { cls: 'pf-notif-snooze-unit', text: 'min' });

				if (settings.snoozeIntervals.length > 1) {
					const removeBtn = row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' });
					removeBtn.addEventListener('click', async () => {
						settings.snoozeIntervals.splice(i, 1);
						await save();
						renderSnoozeRows();
					});
				}
			});

			const addBtn = snoozeContainer.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add interval' });
			addBtn.addEventListener('click', async () => {
				settings.snoozeIntervals.push({ label: 'Custom', minutes: 60 });
				await save();
				renderSnoozeRows();
			});
		};
		renderSnoozeRows();

		// ── Trigger groups ────────────────────────────────────────────────────
		const triggerGroups: { heading: string; rows: { id: keyof typeof DEFAULT_NOTIFICATION_SETTINGS.triggers; label: string; thresholdKey?: keyof import('./types').NotificationTriggerConfig; thresholdLabel?: string; min?: number; max?: number }[] }[] = [
			{
				heading: 'Ticket notifications', rows: [
					{ id: 'ticket_due_today', label: 'Due today' },
					{ id: 'ticket_due_approaching', label: 'Due date approaching', thresholdKey: 'daysBeforeDue', thresholdLabel: 'Days before', min: 1, max: 30 },
					{ id: 'ticket_overdue', label: 'Overdue' },
					{ id: 'ticket_stale_in_progress', label: 'Stale in progress', thresholdKey: 'staleThresholdDays', thresholdLabel: 'Days', min: 1, max: 60 },
					{ id: 'ticket_no_due_date', label: 'No due date set' },
					{ id: 'ticket_no_sprint', label: 'No sprint assigned' },
					{ id: 'ticket_reminder', label: 'Per-ticket reminders' },
				],
			},
			{
				heading: 'Sprint notifications', rows: [
					{ id: 'sprint_ending_soon', label: 'Ending soon', thresholdKey: 'daysBeforeSprintEnd', thresholdLabel: 'Days before', min: 1, max: 14 },
					{ id: 'sprint_ends_today', label: 'Ends today' },
					{ id: 'sprint_overdue', label: 'Overdue' },
					{ id: 'sprint_completed', label: 'Completed' },
					{ id: 'sprint_started', label: 'Started' },
					{ id: 'sprint_none_active', label: 'None active' },
				],
			},
			{
				heading: 'Project notifications', rows: [
					{ id: 'project_overdue_tickets', label: 'Has overdue tickets' },
					{ id: 'project_idle', label: 'Idle project', thresholdKey: 'idleThresholdDays', thresholdLabel: 'Days', min: 1, max: 90 },
					{ id: 'project_no_active_sprint', label: 'No active sprint' },
				],
			},
		];

		for (const group of triggerGroups) {
			new Setting(containerEl).setName(group.heading).setHeading();
			for (const row of group.rows) {
				const cfg = settings.triggers[row.id] ?? DEFAULT_NOTIFICATION_SETTINGS.triggers[row.id];
				const s = new Setting(containerEl).setName(row.label);
				if (row.thresholdKey) {
					s.addText(text => {
						text.inputEl.type = 'number';
						text.inputEl.addClass('pf-input-short');
						text.inputEl.min = String(row.min ?? 1);
						text.inputEl.max = String(row.max ?? 99);
						text.inputEl.value = String((cfg as unknown as Record<string, unknown>)[row.thresholdKey!] ?? '');
						text.inputEl.placeholder = row.thresholdLabel ?? '';
						text.inputEl.addEventListener('input', () => {
							const v = parseInt(text.inputEl.value, 10);
							if (!isNaN(v)) { (settings.triggers[row.id] as unknown as Record<string, unknown>)[row.thresholdKey!] = v; save(); }
						});
					});
				}
				s.addToggle(t => {
					t.setValue(cfg?.enabled ?? false);
					t.onChange(async val => { settings.triggers[row.id].enabled = val; await save(); });
				});
			}
		}
	}

}
