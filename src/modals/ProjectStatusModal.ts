import { App, Modal } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import { ConfirmModal } from './ConfirmModal';
import {
	type StatusDefinition,
	DEFAULT_STATUSES,
	nextPaletteColor,
	slugify,
	injectStatusColors,
} from '../statusConfig';
import { StatusColorPicker } from '../views/StatusColorPicker';

export class ProjectStatusModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private projectId: string;
	private statuses: StatusDefinition[];
	private onSave: () => void;
	private body!: HTMLElement;
	private dragIndex = -1;

	constructor(app: App, plugin: ProjectFlowPlugin, projectId: string, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.projectId = projectId;
		this.onSave = onSave;
		this.statuses = plugin.store.getProjectStatuses(projectId).map(s => ({ ...s }));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(560px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		// Header
		const header = contentEl.createDiv('pf-modal-header');
		header.createEl('span', { cls: 'pf-modal-label', text: 'Manage statuses' });
		const closeBtn = header.createEl('button', { cls: 'pf-modal-close', text: '\u00d7' });
		closeBtn.addEventListener('click', () => this.close());

		// Body (scrollable list)
		this.body = contentEl.createDiv('pf-modal-body');
		this.renderList();

		// Footer
		const footer = contentEl.createDiv('pf-modal-footer');
		const saveBtn = footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Save' });
		saveBtn.addEventListener('click', async () => {
			await this.plugin.store.setProjectStatuses(this.projectId, this.statuses);
			injectStatusColors(this.statuses);
			this.onSave();
			this.close();
		});
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderList(): void {
		this.body.empty();

		const list = this.body.createDiv('pf-status-list');
		for (let i = 0; i < this.statuses.length; i++) {
			this.renderRow(list, i);
		}

		const addBtn = this.body.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add status' });
		addBtn.style.marginTop = '8px';
		addBtn.addEventListener('click', () => {
			const color = nextPaletteColor(this.statuses.map(s => s.color));
			this.statuses.push({
				id: slugify(`custom-${Date.now()}`),
				label: 'New Status',
				color,
				isDefault: false,
				universalId: 'todo',
			});
			this.renderList();
		});
	}

	private renderRow(list: HTMLElement, index: number): void {
		const status = this.statuses[index];
		const row = list.createDiv('pf-status-row');
		row.draggable = true;

		// Drag handle
		row.createSpan({ cls: 'pf-status-drag-handle', text: '\u2807' });

		// Color swatch
		const swatchBtn = row.createEl('button', { cls: 'pf-status-swatch-btn' });
		swatchBtn.style.background = status.color;
		swatchBtn.setAttribute('aria-label', 'Change color');
		swatchBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new StatusColorPicker(swatchBtn, status.color, (hex) => {
				status.color = hex;
				swatchBtn.style.background = hex;
			}).open();
		});

		// Label input
		const labelInput = row.createEl('input', { cls: 'pf-status-label-input' }) as HTMLInputElement;
		labelInput.type = 'text';
		labelInput.value = status.label;
		labelInput.addEventListener('change', () => {
			const v = labelInput.value.trim();
			if (!v) { labelInput.value = status.label; return; }
			status.label = v;
		});

		// Universal mapping dropdown (custom statuses only)
		if (!status.isDefault) {
			const mapSel = row.createEl('select', { cls: 'pf-status-map-sel' }) as HTMLSelectElement;
			mapSel.setAttribute('aria-label', 'Maps to universal status');
			for (const def of DEFAULT_STATUSES) {
				const opt = mapSel.createEl('option', { text: def.label, value: def.id });
				if (def.id === status.universalId) opt.selected = true;
			}
			mapSel.addEventListener('change', () => { status.universalId = mapSel.value; });

			// Inline delete button
			const delBtn = row.createEl('button', { cls: 'pf-status-delete-btn' });
			delBtn.setAttribute('aria-label', 'Delete status');
			delBtn.setText('\u00d7');
			delBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.app, `Delete status "${status.label}"? Tickets using it will keep their current value.`, () => {
					this.statuses.splice(index, 1);
					this.renderList();
				}).open();
			});
		} else {
			row.createSpan({ cls: 'pf-status-default-badge', text: 'default' });
		}

		// Drag events
		row.addEventListener('dragstart', (e) => {
			this.dragIndex = index;
			row.addClass('pf-status-row-dragging');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		row.addEventListener('dragend', () => {
			row.removeClass('pf-status-row-dragging');
			list.querySelectorAll('.pf-status-row-over').forEach(el => el.removeClass('pf-status-row-over'));
		});
		row.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			list.querySelectorAll('.pf-status-row-over').forEach(el => el.removeClass('pf-status-row-over'));
			if (this.dragIndex !== index) row.addClass('pf-status-row-over');
		});
		row.addEventListener('dragleave', () => {
			row.removeClass('pf-status-row-over');
		});
		row.addEventListener('drop', (e) => {
			e.preventDefault();
			if (this.dragIndex < 0 || this.dragIndex === index) return;
			const [moved] = this.statuses.splice(this.dragIndex, 1);
			this.statuses.splice(index, 0, moved);
			this.dragIndex = -1;
			this.renderList();
		});
	}
}
