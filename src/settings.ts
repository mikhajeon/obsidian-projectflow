import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ProjectFlowPlugin from './main';
import { ProjectModal } from './modals/ProjectModal';

export class ProjectFlowSettingTab extends PluginSettingTab {
	plugin: ProjectFlowPlugin;

	constructor(app: App, plugin: ProjectFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
					btn
						.setButtonText('Delete')
						.setWarning()
						.onClick(async () => {
							await this.plugin.store.deleteProject(project.id);
							new Notice(`Project "${project.name}" deleted.`);
							this.display();
							this.plugin.refreshAllViews();
						})
				);
		}
	}
}
