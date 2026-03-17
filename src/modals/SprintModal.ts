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
	private goal = '';
	private startInputEl: HTMLInputElement | null = null;
	private endInputEl: HTMLInputElement | null = null;

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
			this.goal = sprint.goal ?? '';
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

		const body = contentEl.createEl('div', { cls: 'pf-modal-body' });
		body.createEl('h2', { text: this.sprint ? 'Edit sprint' : 'New sprint', cls: 'pf-modal-title' });

		new Setting(body)
			.setName('Sprint name')
			.addText(text => {
				text.setPlaceholder('Sprint 1').setValue(this.name);
				text.inputEl.addClass('pf-input-full');
				text.onChange(val => { this.name = val; });
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(body)
			.setName('Start date')
			.addText(text => {
				text.inputEl.type = 'date';
				text.inputEl.value = this.startDate;
				this.startInputEl = text.inputEl;
				const onStartChange = () => {
					const val = text.inputEl.value;
					if (!val) return;
					this.startDate = val;
					// Recalculate end date from cycle
					const project = this.plugin.store.getProject(this.projectId);
					if (project && this.endInputEl) {
						const [y, mo, d] = val.split('-').map(Number);
						const start = new Date(y, mo - 1, d);
						start.setDate(start.getDate() + project.cycleDays);
						const newEnd = this.toDateString(start.getTime());
						this.endDate = newEnd;
						this.endInputEl.value = newEnd;
					}
				};
				text.inputEl.addEventListener('change', onStartChange);
			});

		new Setting(body)
			.setName('End date')
			.addText(text => {
				text.inputEl.type = 'date';
				text.inputEl.value = this.endDate;
				this.endInputEl = text.inputEl;
				const onEndChange = () => { if (text.inputEl.value) this.endDate = text.inputEl.value; };
				text.inputEl.addEventListener('change', onEndChange);
			});

		new Setting(body)
			.setName('Sprint goal')
			.addTextArea(area => {
				area.setPlaceholder('Optional goal for this sprint').setValue(this.goal);
				area.inputEl.addClass('pf-textarea');
				area.onChange(val => { this.goal = val; });
			});

		if (this.sprint) {
			new Setting(body)
				.setName('Status')
				.addDropdown(drop => {
					drop.addOption('planning', 'Planning');
					drop.addOption('active', 'Active');
					drop.addOption('completed', 'Completed');
					drop.setValue(this.status);
					drop.onChange(val => { this.status = val as SprintStatus; });
				});
		}

		contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});

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

		// Read directly from inputs as source of truth, fall back to stored values
		const startDateVal = this.startInputEl?.value || this.startDate;
		const endDateVal = this.endInputEl?.value || this.endDate;

		if (!startDateVal || !endDateVal) {
			new Notice('Start and end dates are required.');
			return;
		}

		const startTs = this.parseDateAsLocal(startDateVal);
		const endTs = this.parseDateAsLocal(endDateVal);

		if (isNaN(startTs) || isNaN(endTs)) {
			new Notice('Invalid date format.');
			return;
		}

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
				goal: this.goal.trim() || undefined,
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
				goal: this.goal.trim() || undefined,
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

	private parseDateAsLocal(dateStr: string): number {
		const [year, month, day] = dateStr.split('-').map(Number);
		return new Date(year, month - 1, day).getTime();
	}
}
