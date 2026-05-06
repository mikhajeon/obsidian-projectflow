import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;
	private confirmLabel: string;
	private items: string[];

	constructor(app: App, message: string, onConfirm: () => void, confirmLabel = 'Delete', items: string[] = []) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
		this.confirmLabel = confirmLabel;
		this.items = items;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		contentEl.createEl('p', { text: this.message });

		if (this.items.length > 0) {
			const impact = contentEl.createDiv({ cls: 'pf-confirm-impact' });
			impact.createEl('p', { cls: 'pf-confirm-impact-label', text: `Also affects ${this.items.length} child ticket${this.items.length !== 1 ? 's' : ''}:` });
			const list = impact.createEl('ul', { cls: 'pf-confirm-impact-list' });
			for (const item of this.items) list.createEl('li', { text: item });
		}

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
