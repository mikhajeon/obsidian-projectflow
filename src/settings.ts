import { App, PluginSettingTab, Setting, Notice, setIcon, normalizePath } from 'obsidian';
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
		const kofiIconEl = kofiBtn.createSpan({ cls: 'pf-support-btn-icon' });
		const kofiSvg = kofiIconEl.createSvg('svg', { attr: { viewBox: '0 0 24 24', fill: 'currentColor', xmlns: 'http://www.w3.org/2000/svg' } });
		kofiSvg.createSvg('path', { attr: { d: 'M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z' } });
		kofiBtn.createSpan({ text: 'Buy me a coffee' });
		kofiBtn.addEventListener('click', () => window.open('https://ko-fi.com/mikhajeon', '_blank'));

		const createdBy = supportBar.createEl('a', { cls: 'pf-support-credit' });
		createdBy.setText('created by mikha');
		createdBy.href = 'https://github.com/mikhajeon';
		createdBy.target = '_blank';

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
					.setPlaceholder('.ProjectFlow')
					.setValue(this.plugin.store.getBaseFolder());
				text.inputEl.addClass('pf-input-full');
				text.inputEl.addEventListener('blur', async () => {
					const newFolder = text.getValue().trim();
					if (!newFolder) return;
					const oldFolder = this.plugin.store.getBaseFolder();
					if (newFolder === oldFolder) return;

					const oldPath = normalizePath(oldFolder);
					const newPath = normalizePath(newFolder);

					const folderExists = await this.app.vault.adapter.exists(oldPath);
					if (folderExists) {
						try {
							await this.app.vault.adapter.rename(oldPath, newPath);
							new Notice(`Base folder renamed to "${newFolder}".`);
						} catch (e) {
							new Notice(`Could not rename folder: ${(e as Error).message}`);
							text.setValue(oldFolder);
							return;
						}
					}

					await this.plugin.store.setBaseFolder(newFolder);
					this.plugin.refreshAllViews();
				});
			});

	}

}
