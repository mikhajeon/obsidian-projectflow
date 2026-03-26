import { App, Modal, Setting, Notice, TFolder, normalizePath } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Project } from '../types';
import { safeFileName, generateTicketNote } from '../ticketNote';
import { defaultTagFromName } from '../store';

export class ProjectModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private project: Project | null;
	private onSave: () => void;

	private name = '';
	private description = '';
	private cycleDays = 14;
	private tag = '';
	private tagManuallyEdited = false;
	private useSprints = true;
	private autoCreateSprint = false;
	private autoSpillover = false;
	private autoArchiveDone = false;

	constructor(app: App, plugin: ProjectFlowPlugin, project: Project | null, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.project = project;
		this.onSave = onSave;

		if (project) {
			this.name = project.name;
			this.description = project.description;
			this.cycleDays = project.cycleDays;
			this.tag = project.tag;
			this.tagManuallyEdited = true; // editing: treat as manual so it doesn't overwrite
			this.useSprints = project.useSprints !== false;
			this.autoCreateSprint = project.autoCreateSprint === true;
			this.autoSpillover = project.autoSpillover === true;
			this.autoArchiveDone = project.autoArchiveDone === true;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(520px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		// Header
		const header = contentEl.createDiv('pf-modal-header');
		header.createEl('span', { cls: 'pf-modal-label', text: this.project ? 'Edit project' : 'New project' });
		const closeBtn = header.createEl('button', { cls: 'pf-modal-close', text: '\u00d7' });
		closeBtn.addEventListener('click', () => this.close());

		// Scrollable body
		const body = contentEl.createDiv('pf-modal-body');

		let tagComponent: { inputEl: HTMLInputElement } | null = null;

		new Setting(body)
			.setName('Project name')
			.addText(text => {
				text.setPlaceholder('My project').setValue(this.name);
				text.inputEl.addClass('pf-input-full');
				text.onChange(val => {
					this.name = val;
					if (!this.tagManuallyEdited && tagComponent) {
						const auto = defaultTagFromName(val);
						this.tag = auto;
						tagComponent.inputEl.value = auto;
					}
				});
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(body)
			.setName('Project tag')
			.setDesc('Short prefix for ticket filenames (e.g. DBA). Auto-generated from name initials.')
			.addText(text => {
				tagComponent = text;
				text.setPlaceholder('DBA').setValue(this.tag);
				text.inputEl.addClass('pf-input-short');
				text.inputEl.maxLength = 8;
				text.onChange(val => {
					this.tag = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
					text.inputEl.value = this.tag;
					this.tagManuallyEdited = true;
				});
			});

		new Setting(body)
			.setName('Description')
			.setDesc('Optional short description of this project.')
			.addTextArea(area => {
				area.setPlaceholder('What are you building?').setValue(this.description);
				area.inputEl.addClass('pf-textarea');
				area.onChange(val => { this.description = val; });
			});

		// ── Sprint settings ───────────────────────────────────────────────────
		new Setting(body).setName('Sprint settings').setHeading();

		new Setting(body)
			.setName('Use sprints')
			.setDesc('Enable sprint-based workflow. Disable for a simple Kanban board.')
			.addToggle(toggle => {
				toggle.setValue(this.useSprints);
				toggle.onChange(val => { this.useSprints = val; });
			});

		new Setting(body)
			.setName('Sprint cycle length (days)')
			.setDesc('Number of days per sprint. New sprints auto-calculate end date from this.')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.max = '90';
				text.inputEl.value = String(this.cycleDays);
				text.inputEl.addClass('pf-input-short');
				text.inputEl.addEventListener('input', () => {
					const val = parseInt(text.inputEl.value, 10);
					if (!isNaN(val) && val > 0) this.cycleDays = val;
				});
			});

		new Setting(body)
			.setName('Auto-create next sprint')
			.setDesc('Automatically create the next sprint when the current one is completed.')
			.addToggle(toggle => {
				toggle.setValue(this.autoCreateSprint);
				toggle.onChange(val => { this.autoCreateSprint = val; });
			});

		new Setting(body)
			.setName('Auto spill over')
			.setDesc('Move incomplete tickets to the next sprint by default when completing a sprint.')
			.addToggle(toggle => {
				toggle.setValue(this.autoSpillover);
				toggle.onChange(val => { this.autoSpillover = val; });
			});

		new Setting(body)
			.setName('Auto-archive done tickets on sprint complete')
			.setDesc('Automatically archive tickets with "done" status when a sprint is completed.')
			.addToggle(toggle => {
				toggle.setValue(this.autoArchiveDone);
				toggle.onChange(val => { this.autoArchiveDone = val; });
			});

		contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});

		// Footer
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

		const finalTag = this.tag.trim() || defaultTagFromName(this.name);

		// Check tag uniqueness across other projects
		const others = this.plugin.store.getProjects().filter(p => p.id !== this.project?.id);
		if (others.some(p => p.tag === finalTag)) {
			new Notice(`Tag "${finalTag}" is already used by another project. Choose a different tag.`);
			return;
		}

		if (this.project) {
			const newName = this.name.trim();
			const oldName = this.project.name;
			const nameChanged = oldName !== newName;

			if (nameChanged) {
				const base = this.plugin.store.getBaseFolder();
				const oldFolder = normalizePath(`${base}/${safeFileName(oldName)}`);
				const newFolder = normalizePath(`${base}/${safeFileName(newName)}`);
				const folder = this.plugin.app.vault.getAbstractFileByPath(oldFolder);
				if (folder instanceof TFolder) {
					await this.plugin.app.vault.rename(folder, newFolder);
				}
			}

			const wasUsingSprints = this.project.useSprints !== false;
			const switchingToNoSprint = wasUsingSprints && !this.useSprints;

			await this.plugin.store.updateProject(this.project.id, {
				name: newName,
				description: this.description.trim(),
				cycleDays: this.cycleDays,
				tag: finalTag,
				useSprints: this.useSprints,
				autoCreateSprint: this.autoCreateSprint,
				autoSpillover: this.autoSpillover,
				autoArchiveDone: this.autoArchiveDone,
			});

			if (switchingToNoSprint) {
				await this.plugin.store.migrateTicketsToNoSprint(this.project.id);
				// Only regenerate notes for tickets that were migrated (now showOnBoard)
				const boardTickets = this.plugin.store.getTickets({ projectId: this.project.id })
					.filter(t => t.showOnBoard === true);
				for (const ticket of boardTickets) {
					generateTicketNote(this.plugin, ticket.id).catch(() => { /* silent */ });
				}
			}

			new Notice(`Project "${newName}" updated.`);
		} else {
			await this.plugin.store.createProject({
				name: this.name.trim(),
				description: this.description.trim(),
				cycleDays: this.cycleDays,
				tag: finalTag,
				useSprints: this.useSprints,
				autoCreateSprint: this.autoCreateSprint,
				autoSpillover: this.autoSpillover,
				autoArchiveDone: this.autoArchiveDone,
			});
			new Notice(`Project "${this.name.trim()}" created.`);
		}

		this.close();
		this.onSave();
	}
}
