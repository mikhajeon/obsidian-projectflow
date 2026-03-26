import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket, TicketStatus } from '../types';
import { PRIORITY_ORDER } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { SprintModal } from '../modals/SprintModal';
import { ProjectModal } from '../modals/ProjectModal';
import { ProjectStatusModal } from '../modals/ProjectStatusModal';
import { RetroModal } from '../modals/RetroModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ticketFilePath } from '../ticketNote';
import { BoardPanelView } from './BoardPanelView';
import { SubtasksPanelView } from './SubtasksPanelView';
import { BoardSubtasksPanelView } from './BoardSubtasksPanelView';
import { BacklogPanelView } from './BacklogPanelView';
import { ListPanelView } from './ListPanelView';
import { ArchivePanelView } from './ArchivePanelView';

export const BOARD_VIEW = 'projectflow-board';

const TYPE_FILTER_OPTIONS_BOARD: [string, string][] = [
	['all', 'All types'], ['task', 'Task'], ['bug', 'Bug'],
	['story', 'Story'], ['epic', 'Epic'], ['subtask', 'Subtask'],
];

const TYPE_FILTER_OPTIONS_BACKLOG: [string, string][] = [
	['all', 'All types'], ['task', 'Task'], ['bug', 'Bug'], ['story', 'Story'],
];

type ViewMode = 'board' | 'backlog' | 'list' | 'parent' | 'archive';

interface DropTarget {
	parentId: string | null;
	beforeId: string | null;
	depth: number;
}

export class BoardView extends ItemView {
	plugin: ProjectFlowPlugin;

	// Drag state (accessed by panel classes)
	draggedTicketId: string | null = null;
	draggedTicketType: string | null = null;
	draggedEpicId: string | null = null;
	dropTarget: DropTarget | null = null;
	epicDropBeforeId: string | null | undefined = undefined;

	// Filter state
	filterType = 'all';
	filterPriority = 'all';
	filterStatus = 'all';
	filterHasSubtasks = false;

	// Sort state (persisted per view)
	sortOrder = 'manual';

	// Board grouping state (persisted)
	boardGrouping = 'default';

	// Column width (persisted per view, shared with panel delegates)
	boardColWidth = 240;

	// UI state
	private viewMode: ViewMode = 'board';
	collapsedSections: Set<string> = new Set();
	selectedIds: Set<string> = new Set();
	lastSelectedId: string | null = null;
	private tabOrder: string[] = ['board', 'parent', 'backlog', 'list', 'archive'];

	// Panel delegates
	private boardPanel: BoardPanelView;
	private subtasksPanel: SubtasksPanelView;
	private boardSubtasksPanel: BoardSubtasksPanelView;
	private backlogPanel: BacklogPanelView;
	private listPanel: ListPanelView;
	private archivePanel: ArchivePanelView;

	// Shared icon map (accessed by panel classes)
	readonly TYPE_ICONS: Record<string, string> = {
		epic:    '◈',
		task:    '⛋',
		bug:     '𓆣',
		story:   '⚑',
		subtask: '⧉',
	};

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.boardPanel = new BoardPanelView(this);
		this.subtasksPanel = new SubtasksPanelView(this);
		this.boardSubtasksPanel = new BoardSubtasksPanelView(this);
		this.backlogPanel = new BacklogPanelView(this);
		this.listPanel = new ListPanelView(this);
		this.archivePanel = new ArchivePanelView(this);
	}

	getViewType(): string { return BOARD_VIEW; }
	getDisplayText(): string { return 'Project Flow'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		this.tabOrder = this.plugin.store.getTabOrder();
		this.viewMode = (this.tabOrder[0] as ViewMode) ?? 'board';
		this.render();
	}

	async onClose(): Promise<void> {}

	refresh(): void {
		this.render();
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('pf-view');

		const store = this.plugin.store;
		this.sortOrder = store.getSortOrder(this.viewMode);
		this.boardGrouping = store.getBoardGrouping();
		this.boardColWidth = store.getBoardColWidth(this.viewMode);
		const savedFilter = store.getFilterState(this.viewMode);
		this.filterType = savedFilter.type;
		this.filterPriority = savedFilter.priority;
		this.filterStatus = savedFilter.status;
		this.filterHasSubtasks = savedFilter.hasSubtasks ?? false;
		const projectId = store.getActiveProjectId();

		if (!projectId) {
			this.renderEmpty(container, 'No project selected.', 'Create a project to get started.', () =>
				new ProjectModal(this.app, this.plugin, null, () => this.render()).open()
			);
			return;
		}

		const useSprints = store.getProjectUseSprints(projectId);
		const activeSprint = store.getActiveSprint(projectId);
		const sprints = store.getSprints(projectId);
		const planningSprint = sprints
			.filter(s => s.status === 'planning')
			.sort((a, b) => b.startDate - a.startDate)[0];
		const currentSprint = useSprints ? (activeSprint ?? planningSprint ?? null) : null;

		// ── Row 1: project switcher + action buttons ──────────────────────────
		const header = container.createEl('div', { cls: 'pf-board-header' });
		const titleRow = header.createEl('div', { cls: 'pf-header-row' });

		const projects = store.getProjects();
		const projectArea = titleRow.createEl('div', { cls: 'pf-project-area' });
		const projectSel = projectArea.createEl('select', { cls: 'pf-select pf-project-switcher' }) as HTMLSelectElement;
		for (const p of projects) {
			const opt = projectSel.createEl('option', { text: p.name, value: p.id });
			if (p.id === projectId) opt.selected = true;
		}
		projectSel.addEventListener('change', async () => {
			await store.setActiveProject(projectSel.value);
			this.plugin.refreshAllViews();
		});
		const editProjectBtn = projectArea.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm', text: '✎' });
		editProjectBtn.setAttribute('aria-label', 'Edit project');
		editProjectBtn.addEventListener('click', () => {
			const current = store.getProject(store.getActiveProjectId() ?? '');
			if (current) new ProjectModal(this.app, this.plugin, current, () => this.plugin.refreshAllViews()).open();
		});
		const statusGearBtn = projectArea.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm', text: '⚙' });
		statusGearBtn.setAttribute('aria-label', 'Manage statuses');
		statusGearBtn.addEventListener('click', () => {
			const pid = store.getActiveProjectId();
			if (pid) new ProjectStatusModal(this.app, this.plugin, pid, () => { this.plugin.refreshAllViews(); }).open();
		});
		projectArea.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Project' })
			.addEventListener('click', () =>
				new ProjectModal(this.app, this.plugin, null, () => this.plugin.refreshAllViews()).open()
			);

		const actions = titleRow.createEl('div', { cls: 'pf-header-actions' });

		if (this.viewMode === 'board') {
			if (!useSprints) {
				// No-sprint mode: show + Ticket only
				actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
					.addEventListener('click', () =>
						new TicketModal(this.app, this.plugin, { projectId, sprintId: null, showOnBoard: true }, () => this.render()).open()
					);
			} else if (!currentSprint) {
				actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ New sprint' })
					.addEventListener('click', () =>
						new SprintModal(this.app, this.plugin, projectId, null, () => this.render()).open()
					);
			} else {
				actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
					.addEventListener('click', () =>
						new TicketModal(this.app, this.plugin, { projectId, sprintId: currentSprint.id }, () => this.render()).open()
					);

				const optBtn = actions.createEl('button', { cls: 'pf-btn pf-btn-icon', text: '⋯' });
				optBtn.addEventListener('click', (e) => {
					const menu = new Menu();
					if (currentSprint.status === 'planning') {
						menu.addItem(item =>
							item.setTitle('Start sprint').setIcon('play').onClick(async () => {
								await store.updateSprint(currentSprint.id, { status: 'active' });
								this.render(); this.plugin.refreshAllViews();
							})
						);
					}
					if (currentSprint.status === 'active') {
						menu.addItem(item =>
							item.setTitle('Complete sprint').setIcon('check').onClick(() => {
								new RetroModal(this.app, this.plugin, currentSprint.id, () => {
									this.render(); this.plugin.refreshAllViews();
								}).open();
							})
						);
						menu.addItem(item =>
							item.setTitle('Cancel sprint').setIcon('x').onClick(async () => {
								await store.updateSprint(currentSprint.id, { status: 'planning' });
								this.render(); this.plugin.refreshAllViews();
							})
						);
					}
					menu.addSeparator();
					menu.addItem(item =>
						item.setTitle('Edit sprint').setIcon('pencil').onClick(() =>
							new SprintModal(this.app, this.plugin, projectId, currentSprint, () => this.render()).open()
						)
					);
					menu.addItem(item =>
						item.setTitle('Delete sprint').setIcon('trash').onClick(() => {
							new ConfirmModal(
								this.app,
								`Delete sprint "${currentSprint.name}"? All tickets in this sprint will be moved to the backlog.`,
								async () => {
									await store.deleteSprint(currentSprint.id);
									this.render();
									this.plugin.refreshAllViews();
								}
							).open();
						})
					);
					menu.showAtMouseEvent(e);
				});
			}
		} else if (this.viewMode === 'parent') {
			if (!useSprints) {
				// No-sprint mode: hide subtasks tab handled below; still show + Ticket
				actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
					.addEventListener('click', () =>
						new TicketModal(this.app, this.plugin, { projectId, sprintId: null, showOnBoard: true }, () => this.render()).open()
					);
			} else if (currentSprint) {
				actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
					.addEventListener('click', () =>
						new TicketModal(this.app, this.plugin, { projectId, sprintId: currentSprint.id }, () => this.render()).open()
					);
			}
		} else if (this.viewMode === 'backlog') {
			actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
				.addEventListener('click', () =>
					new TicketModal(this.app, this.plugin, { projectId, sprintId: null }, () => this.render()).open()
				);
		} else if (this.viewMode === 'list') {
			actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
				.addEventListener('click', () =>
					new TicketModal(this.app, this.plugin, { projectId, sprintId: null, defaultType: 'task' }, () => this.render()).open()
				);
		}
		// archive tab: no action button

		// ── Row 2: view mode tabs (draggable to reorder) ──────────────────────
		const tabs = header.createEl('div', { cls: 'pf-view-tabs' });
		const tabLabelMap: Record<string, string> = { board: 'Board', parent: 'Subtasks', backlog: 'Backlog', list: 'List', archive: 'Archive' };
		let tabDragSrcIdx: number | null = null;
		const renderTabs = () => {
			tabs.empty();
			this.tabOrder.forEach((mode, idx) => {
				const tab = tabs.createEl('button', {
					cls: `pf-tab${this.viewMode === mode ? ' pf-tab-active' : ''}`,
					text: tabLabelMap[mode] ?? mode,
				});
				tab.draggable = true;
				tab.addEventListener('click', () => { this.viewMode = mode as ViewMode; this.render(); });
				tab.addEventListener('dragstart', (e) => {
					tabDragSrcIdx = idx;
					tab.classList.add('pf-tab-dragging');
					if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', mode); }
				});
				tab.addEventListener('dragend', () => {
					tab.classList.remove('pf-tab-dragging');
					tabs.querySelectorAll('.pf-tab-drop-before, .pf-tab-drop-after').forEach(el => {
						el.classList.remove('pf-tab-drop-before', 'pf-tab-drop-after');
					});
				});
				tab.addEventListener('dragover', (e) => {
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
					tabs.querySelectorAll('.pf-tab-drop-before, .pf-tab-drop-after').forEach(el => {
						el.classList.remove('pf-tab-drop-before', 'pf-tab-drop-after');
					});
					if (tabDragSrcIdx !== null && tabDragSrcIdx !== idx) {
						tab.classList.add(tabDragSrcIdx < idx ? 'pf-tab-drop-after' : 'pf-tab-drop-before');
					}
				});
				tab.addEventListener('dragleave', () => {
					tab.classList.remove('pf-tab-drop-before', 'pf-tab-drop-after');
				});
				tab.addEventListener('drop', async (e) => {
					e.preventDefault();
					tab.classList.remove('pf-tab-drop-before', 'pf-tab-drop-after');
					if (tabDragSrcIdx === null || tabDragSrcIdx === idx) return;
					const newOrder = [...this.tabOrder];
					const [moved] = newOrder.splice(tabDragSrcIdx, 1);
					newOrder.splice(idx, 0, moved);
					this.tabOrder = newOrder;
					tabDragSrcIdx = null;
					await this.plugin.store.setTabOrder(newOrder);
					renderTabs();
				});
			});
		};
		renderTabs();

		// ── Row 3: sprint info banner ─────────────────────────────────────────
		if (useSprints && (this.viewMode === 'board' || this.viewMode === 'parent') && currentSprint) {
			const isPlanning = currentSprint.status === 'planning';

			if (isPlanning) {
				const banner = header.createEl('div', { cls: 'pf-planning-banner' });
				banner.createEl('span', { cls: 'pf-planning-label', text: 'Sprint is in planning. Start it to begin tracking progress.' });
				banner.createEl('button', { cls: 'pf-btn pf-btn-primary pf-btn-sm', text: 'Start sprint' })
					.addEventListener('click', async () => {
						await store.updateSprint(currentSprint.id, { status: 'active' });
						this.render();
						this.plugin.refreshAllViews();
					});
			} else {
				const progress = store.getSprintProgress(currentSprint.id);
				const progressRow = header.createEl('div', { cls: 'pf-progress-row' });
				progressRow.createEl('span', { cls: 'pf-progress-label', text: `${progress.done} / ${progress.total} done · ${progress.percent}%` });
				const bar = progressRow.createEl('progress', { cls: 'pf-sprint-progress' }) as HTMLProgressElement;
				bar.value = progress.percent;
				bar.max = 100;
				const endDate = new Date(currentSprint.endDate).toLocaleDateString();
				progressRow.createEl('span', { cls: 'pf-sprint-date', text: `Ends ${endDate}` });
			}

			if (currentSprint.goal) {
				header.createEl('p', { cls: 'pf-sprint-goal', text: `Goal: ${currentSprint.goal}` });
			}
		}

		// ── Filter + Sort row (hidden on archive tab) ────────────────────────
		if (this.viewMode !== 'archive') {
		{
			const hasActiveFilters = this.filterType !== 'all' || this.filterPriority !== 'all' || this.filterStatus !== 'all' || this.filterHasSubtasks;
			const filterRow = header.createEl('div', { cls: 'pf-filter-row' });
			const filterBtn = filterRow.createEl('button', {
				cls: `pf-btn pf-btn-sm pf-filter-btn${hasActiveFilters ? ' pf-filter-btn-active' : ''}`,
				text: 'Filters',
			});
			if (hasActiveFilters) {
				filterBtn.createEl('span', { cls: 'pf-filter-dot' });
			}

			filterBtn.addEventListener('click', (e) => {
				e.stopPropagation();

				// Close any existing open dropdown
				const existing = document.querySelector('.pf-filter-dropdown');
				if (existing) { existing.remove(); return; }

				const dropdown = document.body.createEl('div', { cls: 'pf-filter-dropdown' });
				const rect = filterBtn.getBoundingClientRect();
				dropdown.style.top = `${rect.bottom + 4}px`;
				dropdown.style.left = `${rect.left}px`;

				const persist = async () => {
					await store.setFilterState(this.viewMode, {
						type: this.filterType,
						priority: this.filterPriority,
						status: this.filterStatus,
						hasSubtasks: this.filterHasSubtasks,
					});
				};

				const typeLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Type' });
				const typeSel = typeLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
				const typeOpts = this.viewMode === 'backlog' ? TYPE_FILTER_OPTIONS_BACKLOG : TYPE_FILTER_OPTIONS_BOARD;
				for (const opt of typeOpts) {
					const o = typeSel.createEl('option', { text: opt[1], value: opt[0] });
					if (opt[0] === this.filterType) o.selected = true;
				}
				typeSel.addEventListener('change', async () => { this.filterType = typeSel.value; await persist(); dropdown.remove(); this.render(); });

				const priLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Priority' });
				const priSel = priLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
				for (const opt of [['all', 'All priorities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) {
					const o = priSel.createEl('option', { text: opt[1], value: opt[0] });
					if (opt[0] === this.filterPriority) o.selected = true;
				}
				priSel.addEventListener('change', async () => { this.filterPriority = priSel.value; await persist(); dropdown.remove(); this.render(); });

				const statusLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Status' });
				const statusSel = statusLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
				{ const o = statusSel.createEl('option', { text: 'All statuses', value: 'all' }); if (this.filterStatus === 'all') o.selected = true; }
				const activeStatuses = store.getProjectStatuses(projectId ?? '');
				for (const st of activeStatuses) {
					const o = statusSel.createEl('option', { text: st.label, value: st.id });
					if (st.id === this.filterStatus) o.selected = true;
				}
				statusSel.addEventListener('change', async () => { this.filterStatus = statusSel.value; await persist(); dropdown.remove(); this.render(); });

				if (this.viewMode === 'parent') {
					const subtaskLabel = dropdown.createEl('label', { cls: 'pf-filter-label pf-filter-label-check' });
					const subtaskCb = subtaskLabel.createEl('input') as HTMLInputElement;
					subtaskCb.type = 'checkbox';
					subtaskCb.checked = this.filterHasSubtasks;
					subtaskLabel.createSpan({ text: 'Has subtasks only' });
					subtaskCb.addEventListener('change', async () => {
						this.filterHasSubtasks = subtaskCb.checked;
						await persist();
						dropdown.remove();
						this.render();
					});
				}

				const hasAny = this.filterType !== 'all' || this.filterPriority !== 'all' || this.filterStatus !== 'all'
					|| (this.viewMode === 'parent' && this.filterHasSubtasks);
				if (hasAny) {
					const clearBtn = dropdown.createEl('button', { cls: 'pf-btn pf-btn-sm pf-filter-clear', text: 'Clear filters' });
					clearBtn.addEventListener('click', async () => {
						this.filterType = 'all'; this.filterPriority = 'all'; this.filterStatus = 'all'; this.filterHasSubtasks = false;
						await persist();
						dropdown.remove();
						this.render();
					});
				}

				const onOutsideClick = (ev: MouseEvent) => {
					if (!dropdown.contains(ev.target as Node) && ev.target !== filterBtn) {
						dropdown.remove();
						document.removeEventListener('click', onOutsideClick, true);
					}
				};
				document.addEventListener('click', onOutsideClick, true);
			});

			// Sort dropdown button
			const hasActiveSort = this.sortOrder !== 'manual';
			const sortBtn = filterRow.createEl('button', {
				cls: `pf-btn pf-btn-sm pf-filter-btn${hasActiveSort ? ' pf-filter-btn-active' : ''}`,
				text: 'Sort',
			});
			if (hasActiveSort) {
				sortBtn.createEl('span', { cls: 'pf-filter-dot' });
			}

			const SORT_OPTIONS: [string, string][] = [
				['manual', 'Manual order'],
				['priority', 'Priority'],
				['title', 'Title (A–Z)'],
				['points', 'Points'],
				['created', 'Created'],
				['updated', 'Updated'],
				['completed', 'Completed'],
			];

			sortBtn.addEventListener('click', (e) => {
				e.stopPropagation();

				const existing = document.querySelector('.pf-sort-dropdown');
				if (existing) { existing.remove(); return; }

				const dropdown = document.body.createEl('div', { cls: 'pf-sort-dropdown' });
				const rect = sortBtn.getBoundingClientRect();
				dropdown.style.top = `${rect.bottom + 4}px`;
				dropdown.style.left = `${rect.left}px`;

				for (const [value, label] of SORT_OPTIONS) {
					const item = dropdown.createEl('button', {
						cls: `pf-sort-option${this.sortOrder === value ? ' pf-sort-option-active' : ''}`,
						text: label,
					});
					item.addEventListener('click', async () => {
						this.sortOrder = value;
						await this.plugin.store.setSortOrder(this.viewMode, value);
						dropdown.remove();
						this.render();
					});
				}

				const onOutsideClick = (ev: MouseEvent) => {
					if (!dropdown.contains(ev.target as Node) && ev.target !== sortBtn) {
						dropdown.remove();
						document.removeEventListener('click', onOutsideClick, true);
					}
				};
				document.addEventListener('click', onOutsideClick, true);
			});

		// Column width button (board + parent views only)
		if (this.viewMode === 'board' || this.viewMode === 'parent') {
			const colBtn = filterRow.createEl('button', {
				cls: 'pf-btn pf-btn-sm pf-filter-btn',
				text: 'Columns',
			});

			colBtn.addEventListener('click', (e) => {
				e.stopPropagation();

				const existing = document.querySelector('.pf-col-width-dropdown');
				if (existing) { existing.remove(); return; }

				const dropdown = document.body.createEl('div', { cls: 'pf-col-width-dropdown' });
				const rect = colBtn.getBoundingClientRect();
				dropdown.style.top = `${rect.bottom + 4}px`;
				dropdown.style.left = `${rect.left}px`;

				const countEl = dropdown.createEl('span', { cls: 'pf-col-width-label', text: `Column width: ${this.boardColWidth}px` });
				const slider = dropdown.createEl('input', { cls: 'pf-col-width-slider' }) as HTMLInputElement;
				slider.type = 'range';
				slider.min = '160';
				slider.max = '420';
				slider.step = '10';
				slider.value = String(this.boardColWidth);

				slider.addEventListener('input', () => {
					countEl.setText(`Column width: ${slider.value}px`);
				});

				slider.addEventListener('change', async () => {
					const w = parseInt(slider.value);
					this.boardColWidth = w;
					await store.setBoardColWidth(this.viewMode, w);
					dropdown.remove();
					this.render();
				});

				const onOutside = (ev: MouseEvent) => {
					if (!dropdown.contains(ev.target as Node) && ev.target !== colBtn) {
						dropdown.remove();
						document.removeEventListener('click', onOutside, true);
					}
				};
				setTimeout(() => document.addEventListener('click', onOutside, true), 0);
			});
		}

		}
		} // end if (this.viewMode !== 'archive')

		// ── Render active tab content ─────────────────────────────────────────
		switch (this.viewMode) {
			case 'board':
				if (!useSprints) {
					// No-sprint mode: show all project tickets
					this.boardPanel.render(container, store, projectId, null, false);
				} else if (currentSprint) {
					this.boardPanel.render(container, store, projectId, currentSprint, true);
				} else {
					this.renderEmpty(container, 'No sprints yet.', 'Create a sprint to use the board view.', () =>
						new SprintModal(this.app, this.plugin, projectId, null, () => this.render()).open()
					);
				}
				break;
			case 'parent':
				if (!useSprints) {
					// Subtasks tab is hidden in no-sprint mode; if somehow reached, show board
					this.subtasksPanel.render(container, store, projectId, null, false);
				} else if (currentSprint) {
					this.subtasksPanel.render(container, store, projectId, currentSprint, true);
				} else {
					this.renderEmpty(container, 'No sprints yet.', 'Create a sprint to use this view.', () =>
						new SprintModal(this.app, this.plugin, projectId, null, () => this.render()).open()
					);
				}
				break;
			case 'backlog':
				this.backlogPanel.render(container, store, projectId, useSprints);
				break;
			case 'list':
				this.listPanel.render(container, store, projectId);
				break;
			case 'archive':
				this.archivePanel.render(container, store, projectId);
				break;
		}
	}

	// ── Table header helper (used by panel classes) ───────────────────────────

	renderTableHeader(
		container: HTMLElement,
		cols: { key: string; label: string; cssVar: string }[],
		onResize?: (key: string, width: number) => void,
	): void {
		const header = container.createEl('div', { cls: 'pf-tbl-header' });

		header.createEl('div', { cls: 'pf-tbl-th' });
		header.createEl('div', { cls: 'pf-tbl-th' });

		for (const col of cols) {
			const cell = header.createEl('div', { cls: 'pf-tbl-th' });
			cell.createEl('span', { cls: 'pf-tbl-th-label', text: col.label });

			const handle = cell.createEl('div', { cls: 'pf-tbl-resize-handle' });
			handle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				const startX = e.clientX;
				const startWidth = parseInt(
					getComputedStyle(container).getPropertyValue(col.cssVar).trim() || '120', 10
				);
				const onMove = (me: MouseEvent) => {
					const newW = Math.max(60, startWidth + (me.clientX - startX));
					container.style.setProperty(col.cssVar, `${newW}px`);
				};
				const onUp = () => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					if (onResize) {
						const finalW = parseInt(
							getComputedStyle(container).getPropertyValue(col.cssVar).trim() || '120', 10
						);
						onResize(col.key, finalW);
					}
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			});
		}
	}

	// ── Row checkbox helper (used by panel classes) ───────────────────────────

	addRowCheckbox(
		row: HTMLElement,
		ticketId: string,
		_unused: HTMLElement,
		orderedIds: string[],
	): void {
		const cell = row.createEl('div', { cls: 'pf-row-checkbox-cell' });
		const cb = cell.createEl('input', { cls: 'pf-row-checkbox' }) as HTMLInputElement;
		cb.type = 'checkbox';
		cb.checked = this.selectedIds.has(ticketId);

		if (this.selectedIds.has(ticketId)) row.addClass('pf-row-selected');

		cb.addEventListener('click', (e) => {
			e.stopPropagation();
			const shiftHeld = (e as MouseEvent).shiftKey;

			if (shiftHeld && this.lastSelectedId && orderedIds.includes(ticketId) && orderedIds.includes(this.lastSelectedId)) {
				const a = orderedIds.indexOf(this.lastSelectedId);
				const b = orderedIds.indexOf(ticketId);
				const [lo, hi] = a < b ? [a, b] : [b, a];
				for (let i = lo; i <= hi; i++) {
					this.selectedIds.add(orderedIds[i]);
				}
			} else if (this.selectedIds.has(ticketId)) {
				this.selectedIds.delete(ticketId);
			} else {
				this.selectedIds.add(ticketId);
			}

			this.lastSelectedId = ticketId;
			const epicsList = row.closest<HTMLElement>('.pf-epics-list');
			if (epicsList) epicsList.classList.toggle('pf-has-selection', this.selectedIds.size > 0);
			const scrollEl = this.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			const scrollTop = scrollEl?.scrollTop ?? 0;
			this.render();
			const newScrollEl = this.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			if (newScrollEl) newScrollEl.scrollTop = scrollTop;
		});
	}

	// ── Ticket level helper (used by panel classes) ───────────────────────────

	getTicketLevel(ticketId: string): 'epic' | 'child' | 'subtask' | null {
		const ticket = this.plugin.store.getTicket(ticketId);
		if (!ticket) return null;
		if (ticket.type === 'epic') return 'epic';
		if (ticket.type === 'subtask') return 'subtask';
		return 'child';
	}

	// ── File path helper (used by panel classes) ──────────────────────────────

	getTicketFilePath(ticketId: string): string | null {
		const ticket = this.plugin.store.getTicket(ticketId);
		if (!ticket) return null;
		const project = this.plugin.store.getProject(ticket.projectId);
		if (!project) return null;
		return ticketFilePath(this.plugin, project.name, ticket);
	}

	// ── Open note helper (used by panel classes) ──────────────────────────────

	async openTicketNote(ticket: Ticket): Promise<void> {
		const project = this.plugin.store.getProject(ticket.projectId);
		if (!project) return;
		const filePath = ticketFilePath(this.plugin, project.name, ticket);
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const leaf = this.plugin.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} else {
			new Notice('Note not found. Save the ticket to generate it.');
		}
	}

	// ── Sort helper (used by panel classes) ───────────────────────────────────

	applySort<T extends { priority: string; title: string; points?: number; createdAt: number; updatedAt: number; completedAt?: number; order: number }>(
		tickets: T[],
		sortOrder: string,
	): T[] {
		if (sortOrder === 'manual') return tickets;
		const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
		return tickets.slice().sort((a, b) => {
			switch (sortOrder) {
				case 'priority': return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
				case 'title':    return a.title.localeCompare(b.title);
				case 'points':   return (b.points ?? 0) - (a.points ?? 0);
				case 'created':  return b.createdAt - a.createdAt;
				case 'updated':  return b.updatedAt - a.updatedAt;
				case 'completed': return (b.completedAt ?? 0) - (a.completedAt ?? 0);
				default:         return a.order - b.order;
			}
		});
	}

	// ── Empty state helper ────────────────────────────────────────────────────

	renderEmpty(container: HTMLElement, title: string, desc: string, action: () => void): void {
		const el = container.createEl('div', { cls: 'pf-empty-state' });
		el.createEl('p', { cls: 'pf-empty-title', text: title });
		el.createEl('p', { cls: 'pf-empty-desc', text: desc });
		el.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Get started' })
			.addEventListener('click', action);
	}
}
