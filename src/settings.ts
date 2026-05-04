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

		// ── Support bar ───────────────────────────────────────────────────────
		const supportBar = containerEl.createDiv('pf-support-bar');

		const sponsorBtn = supportBar.createEl('button', { cls: 'pf-support-btn pf-support-btn--sponsor' });
		setIcon(sponsorBtn.createSpan({ cls: 'pf-support-btn-icon' }), 'heart');
		sponsorBtn.createSpan({ text: 'Sponsor' });
		sponsorBtn.addEventListener('click', () => window.open('https://github.com/sponsors/mikhajeon', '_blank'));

		const kofiBtn = supportBar.createEl('button', { cls: 'pf-support-btn pf-support-btn--kofi' });
		setIcon(kofiBtn.createSpan({ cls: 'pf-support-btn-icon' }), 'coffee');
		kofiBtn.createSpan({ text: 'Buy me a coffee' });
		kofiBtn.addEventListener('click', () => window.open('https://ko-fi.com/mikhajeon', '_blank'));

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

	}

}
