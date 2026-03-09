import { App, Modal, Setting, Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Sprint, SprintStatus } from '../types';

type OnSave = (sprintId?: string | null) => void;

export class SprintModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private projectId: string;
	private sprint: Sprint | null;
	private onSave: OnSave;

	private name = '';
	private startDate = '';
	private endDate = '';
	private status: SprintStatus = 'planning';

	constructor(
		app: App,
		plugin: ProjectFlowPlugin,
		projectId: string,
		sprint: Sprint | null,
		onSave: OnSave
	) {
		super(app);
		this.plugin = plugin;
		this.projectId = projectId;
		this.sprint = sprint;
		this.onSave = onSave;

		const today = new Date();

		if (sprint) {
			this.name = sprint.name;
			this.startDate = this.toDateString(sprint.startDate);
			this.endDate = this.toDateString(sprint.endDate);
			this.status = sprint.status;
		} else {
			const project = plugin.store.getProject(projectId);
			const cycleDays = project?.cycleDays ?? 14;
			const end = new Date(today);
			end.setDate(end.getDate() + cycleDays);
			this.startDate = this.toDateString(today.getTime());
			this.endDate = this.toDateString(end.getTime());
			// Auto-name based on sprint count
			const sprints = plugin.store.getSprints(projectId);
			this.name = `Sprint ${sprints.length + 1}`;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');

		contentEl.createEl('h2', { text: this.sprint ? 'Edit sprint' : 'New sprint' });

		new Setting(contentEl)
			.setName('Sprint name')
			.addText(text => {
				text.setPlaceholder('Sprint 1').setValue(this.name);
				text.inputEl.addClass('pf-input-full');
				text.onChange(val => { this.name = val; });
				setTimeout(() => text.inputEl.focus(), 50);
			});

		let endInputEl: HTMLInputElement | null = null;

		new Setting(contentEl)
			.setName('Start date')
			.addText(text => {
				text.inputEl.type = 'date';
				text.inputEl.value = this.startDate;
				text.inputEl.addEventListener('change', () => {
					this.startDate = text.inputEl.value;
					// Recalculate end date from cycle
					const project = this.plugin.store.getProject(this.projectId);
					if (project && !this.sprint && endInputEl) {
						const start = new Date(this.startDate);
						const end = new Date(start);
						end.setDate(end.getDate() + project.cycleDays);
						this.endDate = this.toDateString(end.getTime());
						endInputEl.value = this.endDate;
					}
				});
			});

		new Setting(contentEl)
			.setName('End date')
			.addText(text => {
				text.inputEl.type = 'date';
				text.inputEl.value = this.endDate;
				endInputEl = text.inputEl as HTMLInputElement;
				text.inputEl.addEventListener('change', () => { this.endDate = text.inputEl.value; });
			});

		if (this.sprint) {
			new Setting(contentEl)
				.setName('Status')
				.addDropdown(drop => {
					drop.addOption('planning', 'Planning');
					drop.addOption('active', 'Active');
					drop.addOption('completed', 'Completed');
					drop.setValue(this.status);
					drop.onChange(val => { this.status = val as SprintStatus; });
				});
		}

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });

		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());

		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: this.sprint ? 'Save' : 'Create' })
			.addEventListener('click', () => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.name.trim()) {
			new Notice('Sprint name is required.');
			return;
		}
		if (!this.startDate || !this.endDate) {
			new Notice('Start and end dates are required.');
			return;
		}

		const startTs = new Date(this.startDate).getTime();
		const endTs = new Date(this.endDate).getTime();

		if (endTs <= startTs) {
			new Notice('End date must be after start date.');
			return;
		}

		if (this.sprint) {
			await this.plugin.store.updateSprint(this.sprint.id, {
				name: this.name.trim(),
				startDate: startTs,
				endDate: endTs,
				status: this.status,
			});
			new Notice('Sprint updated.');
			this.close();
			this.onSave(null);
		} else {
			const sprint = await this.plugin.store.createSprint({
				projectId: this.projectId,
				name: this.name.trim(),
				startDate: startTs,
				endDate: endTs,
				status: 'planning',
			});
			new Notice('Sprint created.');
			this.close();
			this.onSave(sprint.id);
		}
	}

	private toDateString(ts: number): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
}
