import { App, Modal } from 'obsidian';
import type { Project } from '../types';

export class ProjectPickerModal extends Modal {
	private projects: Project[];
	private onSelect: (projectId: string) => void;

	constructor(app: App, projects: Project[], onSelect: (projectId: string) => void) {
		super(app);
		this.projects = projects;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal', 'pf-project-picker-modal');

		contentEl.createEl('h3', { cls: 'pf-project-picker-title', text: 'Select project' });

		const list = contentEl.createEl('div', { cls: 'pf-project-picker-list' });
		for (const project of this.projects) {
			const row = list.createEl('button', { cls: 'pf-project-picker-row' });

			const dot = row.createEl('span', { cls: 'pf-project-picker-dot' });
			if (project.color) dot.style.backgroundColor = project.color;

			row.createEl('span', { cls: 'pf-project-picker-name', text: project.name });

			row.addEventListener('click', () => {
				this.close();
				this.onSelect(project.id);
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
