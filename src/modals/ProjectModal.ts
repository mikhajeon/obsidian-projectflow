import { App, Modal, Setting, Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Project } from '../types';

export class ProjectModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private project: Project | null;
	private onSave: () => void;

	private name = '';
	private description = '';
	private cycleDays = 14;

	constructor(app: App, plugin: ProjectFlowPlugin, project: Project | null, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.project = project;
		this.onSave = onSave;

		if (project) {
			this.name = project.name;
			this.description = project.description;
			this.cycleDays = project.cycleDays;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');

		contentEl.createEl('h2', { text: this.project ? 'Edit project' : 'New project' });

		new Setting(contentEl)
			.setName('Project name')
			.addText(text => {
				text.setPlaceholder('My project').setValue(this.name);
				text.inputEl.addClass('pf-input-full');
				text.onChange(val => { this.name = val; });
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.setName('Description')
			.setDesc('Optional short description of this project.')
			.addTextArea(area => {
				area.setPlaceholder('What are you building?').setValue(this.description);
				area.inputEl.addClass('pf-textarea');
				area.onChange(val => { this.description = val; });
			});

		new Setting(contentEl)
			.setName('Sprint cycle length (days)')
			.setDesc('Number of days per sprint. New sprints will auto-calculate the end date.')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.max = '90';
				text.inputEl.value = String(this.cycleDays);
				text.inputEl.addClass('pf-input-short');
				text.inputEl.addEventListener('change', () => {
					const val = parseInt(text.inputEl.value, 10);
					if (!isNaN(val) && val > 0) this.cycleDays = val;
				});
			});

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });

		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());

		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: this.project ? 'Save' : 'Create' })
			.addEventListener('click', () => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (!this.name.trim()) {
			new Notice('Project name is required.');
			return;
		}

		if (this.project) {
			await this.plugin.store.updateProject(this.project.id, {
				name: this.name.trim(),
				description: this.description.trim(),
				cycleDays: this.cycleDays,
			});
			new Notice(`Project "${this.name.trim()}" updated.`);
		} else {
			await this.plugin.store.createProject({
				name: this.name.trim(),
				description: this.description.trim(),
				cycleDays: this.cycleDays,
			});
			new Notice(`Project "${this.name.trim()}" created.`);
		}

		this.close();
		this.onSave();
	}
}
