import { App, Modal, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { BoardCardAppearance } from '../types';
import { ConfirmModal } from './ConfirmModal';
import {
	type StatusDefinition,
	DEFAULT_STATUSES,
	nextPaletteColor,
	slugify,
	injectStatusColors,
} from '../statusConfig';
import { StatusColorPicker } from '../views/StatusColorPicker';

const APPEARANCE_TOGGLES: { key: keyof BoardCardAppearance; label: string; desc: string }[] = [
	{ key: 'typeIcon',       label: 'Type icon',        desc: 'Icon indicating ticket type (task, bug, story…)' },
	{ key: 'priorityEdge',   label: 'Priority edge',    desc: 'Colored left border based on priority' },
	{ key: 'priorityBadge',  label: 'Priority badge',   desc: 'Priority text label' },
	{ key: 'description',    label: 'Description',      desc: 'Description text on cards' },
	{ key: 'recurrenceIcon', label: 'Recurrence icon',  desc: '↻ symbol on recurring tickets' },
	{ key: 'points',         label: 'Points',           desc: 'Story points badge' },
	{ key: 'checklist',      label: 'Checklist',        desc: 'Checklist progress (N/M items)' },
	{ key: 'subtaskCount',   label: 'Subtask count',    desc: '⧉ N/M subtasks on board cards' },
	{ key: 'parentLabel',    label: 'Parent label',     desc: 'Parent ticket title on subtask cards' },
];

type TabId = 'appearance' | 'columns';

export class BoardSettingsModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private onUpdate: () => void;
	private projectId: string;
	static lastTab: TabId = 'appearance';
	private activeTab: TabId;

	// Columns tab state
	private statuses: StatusDefinition[] = [];
	private hiddenColumns: Set<string> = new Set();
	private boardColWidth = 240;
	private dragIndex = -1;
	private statusListContainer: HTMLElement | null = null;
	private deletedStatuses: Array<{ id: string; targetId: string }> = [];

	constructor(app: App, plugin: ProjectFlowPlugin, projectId: string, onUpdate: () => void) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate;
		this.projectId = projectId;
		this.activeTab = BoardSettingsModal.lastTab;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal', 'pf-cal-settings-modal');
		this.modalEl.style.width = 'min(580px, 92vw)';

		// Load columns state fresh on open
		this.statuses = this.plugin.store.getProjectStatuses(this.projectId).map(s => ({ ...s }));
		this.hiddenColumns = new Set(this.plugin.store.getHiddenBoardColumns(this.projectId));
		this.boardColWidth = this.plugin.store.getBoardColWidth('board');
		this.deletedStatuses = [];

		const TABS: { id: TabId; label: string; icon: string }[] = [
			{ id: 'appearance', label: 'Card appearance', icon: 'layout-grid' },
			{ id: 'columns',    label: 'Columns',         icon: 'columns-3' },
		];

		const tabBar = contentEl.createEl('div', { cls: 'pf-cal-settings-tabs' });
		const contentArea = contentEl.createEl('div', { cls: 'pf-cal-settings-content' });

		const showTab = (id: TabId) => {
			this.activeTab = id;
			BoardSettingsModal.lastTab = id;
			tabBar.querySelectorAll('.pf-cal-settings-tab').forEach(el => el.removeClass('active'));
			tabBar.querySelector(`[data-tab="${id}"]`)?.addClass('active');
			contentArea.empty();
			if (id === 'appearance') this.renderAppearanceTab(contentArea);
			else this.renderColumnsTab(contentArea);
		};

		for (const tab of TABS) {
			const btn = tabBar.createEl('button', {
				cls: 'pf-cal-settings-tab' + (tab.id === this.activeTab ? ' active' : ''),
				attr: { 'data-tab': tab.id },
			});
			const iconEl = btn.createEl('span', { cls: 'pf-cal-settings-tab-icon' });
			setIcon(iconEl, tab.icon);
			btn.createEl('span', { text: tab.label });
			btn.addEventListener('click', () => showTab(tab.id));
		}

		if (this.activeTab === 'appearance') this.renderAppearanceTab(contentArea);
		else this.renderColumnsTab(contentArea);
	}

	private renderAppearanceTab(container: HTMLElement): void {
		const section = container.createEl('div', { cls: 'pf-cal-settings-section' });
		section.createEl('p', { cls: 'pf-cal-settings-section-desc', text: 'Show or hide elements on board ticket cards.' });

		for (const { key, label, desc } of APPEARANCE_TOGGLES) {
			const appearance = this.plugin.store.getBoardCardAppearance();
			const row = section.createEl('div', { cls: 'pf-cal-settings-toggle-row' });
			const left = row.createEl('div', { cls: 'pf-cal-settings-toggle-left' });
			left.createEl('span', { cls: 'pf-cal-settings-toggle-label', text: label });
			left.createEl('span', { cls: 'pf-cal-settings-toggle-desc', text: desc });

			const toggle = row.createEl('div', { cls: 'pf-cal-settings-toggle' + (appearance[key] ? ' active' : '') });
			toggle.addEventListener('click', () => {
				const current = this.plugin.store.getBoardCardAppearance();
				const updated: BoardCardAppearance = { ...current, [key]: !current[key] };
				toggle.toggleClass('active', updated[key]);
				this.plugin.store.setBoardCardAppearance(updated).catch(() => {});
				this.onUpdate();
			});
		}
	}

	private renderColumnsTab(container: HTMLElement): void {
		const listWrap = container.createEl('div', { cls: 'pf-modal-body' });
		this.statusListContainer = listWrap;
		this.renderStatusList(listWrap);

		const options = container.createDiv('pf-status-options');

		const edgesRow = options.createDiv('pf-status-option-row');
		edgesRow.createEl('span', { cls: 'pf-status-option-label', text: 'Show priority colour edges on board cards' });
		const edgesToggle = edgesRow.createEl('input', { cls: 'pf-toggle' }) as HTMLInputElement;
		edgesToggle.type = 'checkbox';
		edgesToggle.checked = this.plugin.store.getProjectBoardPriorityEdges(this.projectId);
		let priorityEdges = edgesToggle.checked;
		edgesToggle.addEventListener('change', () => { priorityEdges = edgesToggle.checked; });

		const widthRow = options.createDiv('pf-status-option-row');
		const widthLabel = widthRow.createEl('span', { cls: 'pf-status-option-label', text: `Board column width: ${this.boardColWidth}px` });
		const widthSlider = widthRow.createEl('input', { cls: 'pf-col-width-slider pf-status-width-slider' }) as HTMLInputElement;
		widthSlider.type = 'range';
		widthSlider.min = '160'; widthSlider.max = '420'; widthSlider.step = '10';
		widthSlider.value = String(this.boardColWidth);
		widthSlider.addEventListener('input', () => {
			this.boardColWidth = parseInt(widthSlider.value);
			widthLabel.setText(`Board column width: ${this.boardColWidth}px`);
		});

		const footer = container.createDiv('pf-modal-footer');
		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Save' })
			.addEventListener('click', async () => {
				await this.plugin.store.setProjectStatuses(this.projectId, this.statuses);
				for (const { id, targetId } of this.deletedStatuses) {
					await this.plugin.store.migrateTicketStatus(this.projectId, id, targetId);
				}
				await this.plugin.store.updateProject(this.projectId, { boardPriorityEdges: priorityEdges });
				await this.plugin.store.setHiddenBoardColumns(this.projectId, [...this.hiddenColumns]);
				await this.plugin.store.setBoardColWidth('board', this.boardColWidth);
				await this.plugin.store.setBoardColWidth('parent', this.boardColWidth);
				injectStatusColors(this.statuses);
				this.onUpdate();
				this.close();
			});
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
	}

	private renderStatusList(container: HTMLElement): void {
		container.empty();

		const list = container.createDiv('pf-status-list');
		const dropLine = list.createEl('div', { cls: 'pf-status-drop-line' });
		let dropTargetIndex = -1;

		for (let i = 0; i < this.statuses.length; i++) {
			this.renderStatusRow(list, i);
		}

		list.addEventListener('dragover', (e) => {
			e.preventDefault();
			const row = (e.target as HTMLElement).closest<HTMLElement>('.pf-status-row');
			if (!row) { dropLine.classList.remove('pf-status-drop-line-visible'); return; }
			const idx = parseInt(row.dataset.rowIndex ?? '-1');
			if (idx < 0 || idx === this.dragIndex) { dropLine.classList.remove('pf-status-drop-line-visible'); return; }
			const rect = row.getBoundingClientRect();
			const insertBefore = (e.clientY - rect.top) / rect.height < 0.5;
			dropTargetIndex = insertBefore ? idx : idx + 1;
			if (dropTargetIndex === this.dragIndex || dropTargetIndex === this.dragIndex + 1) {
				dropLine.classList.remove('pf-status-drop-line-visible'); return;
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
			this.renderStatusList(container);
		});

		const addBtn = container.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add status' });
		addBtn.style.marginTop = '8px';
		addBtn.addEventListener('click', () => {
			const color = nextPaletteColor(this.statuses.map(s => s.color));
			this.statuses.push({ id: slugify(`custom-${Date.now()}`), label: 'New Status', color, isDefault: false, universalId: 'todo' });
			this.renderStatusList(container);
		});
	}

	private renderStatusRow(list: HTMLElement, index: number): void {
		const status = this.statuses[index];
		const row = list.createDiv('pf-status-row');
		row.draggable = true;
		row.dataset.rowIndex = String(index);

		row.createSpan({ cls: 'pf-status-drag-handle', text: '\u2807' });

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

		const labelInput = row.createEl('input', { cls: 'pf-status-label-input' }) as HTMLInputElement;
		labelInput.type = 'text';
		labelInput.value = status.label;
		labelInput.addEventListener('change', () => {
			const v = labelInput.value.trim();
			if (!v) { labelInput.value = status.label; return; }
			status.label = v;
		});

		if (!status.isDefault) {
			const mapSel = row.createEl('select', { cls: 'pf-status-map-sel' }) as HTMLSelectElement;
			mapSel.setAttribute('aria-label', 'Maps to universal status');
			for (const def of DEFAULT_STATUSES) {
				const opt = mapSel.createEl('option', { text: def.label, value: def.id });
				if (def.id === status.universalId) opt.selected = true;
			}
			mapSel.addEventListener('change', () => { status.universalId = mapSel.value; });

			const delBtn = row.createEl('button', { cls: 'pf-status-delete-btn' });
			delBtn.setAttribute('aria-label', 'Delete status');
			delBtn.setText('\u00d7');
			delBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const targetLabel = this.statuses.find(s => s.id === status.universalId)?.label
					?? DEFAULT_STATUSES.find(d => d.id === status.universalId)?.label
					?? status.universalId;
				const msg = `Delete status "${status.label}"? All tickets will be moved to "${targetLabel}".`;
				new ConfirmModal(this.app, msg, () => {
					this.deletedStatuses.push({ id: status.id, targetId: status.universalId });
					this.statuses.splice(index, 1);
					if (this.statusListContainer) this.renderStatusList(this.statusListContainer);
				}).open();
			});
		} else {
			row.createSpan({ cls: 'pf-status-default-badge', text: 'default' });
		}

		row.addEventListener('dragstart', (e) => {
			this.dragIndex = index;
			row.addClass('pf-status-row-dragging');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		row.addEventListener('dragend', () => {
			row.removeClass('pf-status-row-dragging');
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
