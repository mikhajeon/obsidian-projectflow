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
	private hiddenColumns: Set<string>;
	private boardColWidth: number;

	constructor(app: App, plugin: ProjectFlowPlugin, projectId: string, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.projectId = projectId;
		this.onSave = onSave;
		this.statuses = plugin.store.getProjectStatuses(projectId).map(s => ({ ...s }));
		this.hiddenColumns = new Set(plugin.store.getHiddenBoardColumns(projectId));
		this.boardColWidth = plugin.store.getBoardColWidth('board');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(580px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		// Header
		const header = contentEl.createDiv('pf-modal-header');
		header.createEl('span', { cls: 'pf-modal-label', text: 'Board settings' });
		const closeBtn = header.createEl('button', { cls: 'pf-modal-close', text: '\u00d7' });
		closeBtn.addEventListener('click', () => this.close());

		// Body (scrollable list)
		this.body = contentEl.createDiv('pf-modal-body');
		this.renderList();

		// ── Display options ───────────────────────────────────────────────────
		const options = contentEl.createDiv('pf-status-options');

		// Priority edges toggle
		const edgesRow = options.createDiv('pf-status-option-row');
		edgesRow.createEl('span', { cls: 'pf-status-option-label', text: 'Show priority colour edges on board cards' });
		const edgesToggle = edgesRow.createEl('input', { cls: 'pf-toggle' }) as HTMLInputElement;
		edgesToggle.type = 'checkbox';
		edgesToggle.checked = this.plugin.store.getProjectBoardPriorityEdges(this.projectId);
		let priorityEdges = edgesToggle.checked;
		edgesToggle.addEventListener('change', () => { priorityEdges = edgesToggle.checked; });

		// Column width slider
		const widthRow = options.createDiv('pf-status-option-row');
		const widthLabel = widthRow.createEl('span', { cls: 'pf-status-option-label', text: `Board column width: ${this.boardColWidth}px` });
		const widthSlider = widthRow.createEl('input', { cls: 'pf-col-width-slider pf-status-width-slider' }) as HTMLInputElement;
		widthSlider.type = 'range';
		widthSlider.min = '160';
		widthSlider.max = '420';
		widthSlider.step = '10';
		widthSlider.value = String(this.boardColWidth);
		widthSlider.addEventListener('input', () => {
			this.boardColWidth = parseInt(widthSlider.value);
			widthLabel.setText(`Board column width: ${this.boardColWidth}px`);
		});

		// Footer
		const footer = contentEl.createDiv('pf-modal-footer');
		const saveBtn = footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Save' });
		saveBtn.addEventListener('click', async () => {
			await this.plugin.store.setProjectStatuses(this.projectId, this.statuses);
			await this.plugin.store.updateProject(this.projectId, { boardPriorityEdges: priorityEdges });
			await this.plugin.store.setHiddenBoardColumns(this.projectId, [...this.hiddenColumns]);
			await this.plugin.store.setBoardColWidth('board', this.boardColWidth);
			await this.plugin.store.setBoardColWidth('parent', this.boardColWidth);
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
		const dropLine = list.createEl('div', { cls: 'pf-status-drop-line' });
		let dropTargetIndex = -1;

		for (let i = 0; i < this.statuses.length; i++) {
			this.renderRow(list, dropLine, i, () => dropTargetIndex, (v) => { dropTargetIndex = v; });
		}

		list.addEventListener('dragover', (e) => {
			e.preventDefault();
			const row = (e.target as HTMLElement).closest<HTMLElement>('.pf-status-row');
			if (!row) { dropLine.classList.remove('pf-status-drop-line-visible'); return; }

			const idx = parseInt(row.dataset.rowIndex ?? '-1');
			if (idx < 0 || idx === this.dragIndex) {
				dropLine.classList.remove('pf-status-drop-line-visible');
				return;
			}

			const rect = row.getBoundingClientRect();
			const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;
			dropTargetIndex = insertBefore ? idx : idx + 1;

			// Suppress no-op: dropping in same position
			if (dropTargetIndex === this.dragIndex || dropTargetIndex === this.dragIndex + 1) {
				dropLine.classList.remove('pf-status-drop-line-visible');
				return;
			}

			dropLine.style.top = (insertBefore ? row.offsetTop : row.offsetTop + row.offsetHeight) + 'px';
			dropLine.classList.add('pf-status-drop-line-visible');
		});

		list.addEventListener('dragleave', (e) => {
			if (!list.contains(e.relatedTarget as Node)) {
				dropLine.classList.remove('pf-status-drop-line-visible');
				dropTargetIndex = -1;
			}
		});

		list.addEventListener('drop', (e) => {
			e.preventDefault();
			dropLine.classList.remove('pf-status-drop-line-visible');
			if (this.dragIndex < 0 || dropTargetIndex < 0) return;

			const insertAt = dropTargetIndex > this.dragIndex ? dropTargetIndex - 1 : dropTargetIndex;
			const [moved] = this.statuses.splice(this.dragIndex, 1);
			this.statuses.splice(insertAt, 0, moved);
			this.dragIndex = -1;
			dropTargetIndex = -1;
			this.renderList();
		});

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

	private renderRow(
		list: HTMLElement,
		_dropLine: HTMLElement,
		index: number,
		_getTarget: () => number,
		_setTarget: (v: number) => void,
	): void {
		const status = this.statuses[index];
		const row = list.createDiv('pf-status-row');
		row.draggable = true;
		row.dataset.rowIndex = String(index);

		// Drag handle
		row.createSpan({ cls: 'pf-status-drag-handle', text: '\u2807' });

		// Visibility toggle
		const isHidden = this.hiddenColumns.has(status.id);
		const eyeBtn = row.createEl('button', {
			cls: `pf-status-eye-btn${isHidden ? ' pf-status-eye-hidden' : ''}`,
			text: isHidden ? '○' : '●',
		});
		eyeBtn.setAttribute('aria-label', isHidden ? 'Column hidden — click to show' : 'Column visible — click to hide');
		eyeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.hiddenColumns.has(status.id)) {
				this.hiddenColumns.delete(status.id);
				eyeBtn.setText('●');
				eyeBtn.removeClass('pf-status-eye-hidden');
				eyeBtn.setAttribute('aria-label', 'Column visible — click to hide');
			} else {
				this.hiddenColumns.add(status.id);
				eyeBtn.setText('○');
				eyeBtn.addClass('pf-status-eye-hidden');
				eyeBtn.setAttribute('aria-label', 'Column hidden — click to show');
			}
		});

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

		// Drag events — dragover/drop are handled at the list level
		row.addEventListener('dragstart', (e) => {
			this.dragIndex = index;
			row.addClass('pf-status-row-dragging');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		row.addEventListener('dragend', () => {
			row.removeClass('pf-status-row-dragging');
		});
	}
}
