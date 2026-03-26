import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;
	private confirmLabel: string;

	constructor(app: App, message: string, onConfirm: () => void, confirmLabel = 'Delete') {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.confirmLabel = confirmLabel;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		contentEl.createEl('p', { text: this.message });

		contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); this.close(); this.onConfirm(); }
		});

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'pf-btn pf-btn-danger', text: this.confirmLabel })
			.addEventListener('click', () => {
				this.close();
				this.onConfirm();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
