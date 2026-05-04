import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type ProjectFlowPlugin from './main';

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
		new Setting(containerEl).setName('Notifications').setHeading();

		const notifSettings = structuredClone(this.plugin.store.getNotificationSettings());
		new Setting(containerEl)
			.setName('Enable notifications')
			.setDesc('Master toggle for all ProjectFlow notifications. Configure triggers and snooze intervals in the Notification Flow panel.')
			.addToggle(t => {
				t.setValue(notifSettings.enabled);
				t.onChange(async val => {
					notifSettings.enabled = val;
					await this.plugin.store.saveNotificationSettings(notifSettings);
					this.plugin.notificationManager?.updateBadge();
				});
			});

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

		// ── Support ───────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Support').setHeading();

		new Setting(containerEl)
			.setName('Support ProjectFlow')
			.setDesc('If this plugin saves you time, consider sponsoring its development.')
			.addButton(btn => {
				const iconEl = btn.buttonEl.createSpan({ cls: 'pf-btn-icon-leading' });
				setIcon(iconEl, 'heart');
				btn.buttonEl.prepend(iconEl);
				btn.setButtonText('Sponsor');
				btn.buttonEl.addClass('pf-btn-sponsor');
				btn.onClick(() => window.open('https://ko-fi.com/mikhajeon', '_blank'));
			})
			.addButton(btn => {
				btn.setButtonText('Buy me a coffee');
				btn.buttonEl.addClass('pf-btn-kofi');
				btn.onClick(() => window.open('https://ko-fi.com/mikhajeon', '_blank'));
			});
	}

}
