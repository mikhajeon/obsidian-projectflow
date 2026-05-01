import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { ProjectStore } from '../store';
import type { Sprint, Ticket, TicketStatus } from '../types';
import { PRIORITY_ORDER } from '../types';
import { TicketModal } from '../modals/TicketModal';
import { SprintModal } from '../modals/SprintModal';
import { ProjectModal } from '../modals/ProjectModal';
import { ProjectNotificationModal } from '../modals/ProjectNotificationModal';
import { ProjectStatusModal } from '../modals/ProjectStatusModal';
import { BoardSettingsModal } from '../modals/BoardSettingsModal';
import { RetroModal } from '../modals/RetroModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ticketFilePath } from '../ticketNote';
import { BoardPanelView } from './BoardPanelView';
import { SubtasksPanelView } from './SubtasksPanelView';
import { BoardSubtasksPanelView } from './BoardSubtasksPanelView';
import { BacklogPanelView } from './BacklogPanelView';
import { ListPanelView } from './ListPanelView';
import { ArchivePanelView } from './ArchivePanelView';
import { NOTIFICATION_VIEW_TYPE } from './NotificationPanelView';

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

	// Hidden board columns (persisted per project)
	hiddenBoardColumns: Set<string> = new Set();

	// Notification badge in header (re-registered on each render)
	private headerBadgeEl: HTMLElement | null = null;

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

	async onClose(): Promise<void> {
		if (this.headerBadgeEl) {
			this.plugin.notificationManager?.removeBadge(this.headerBadgeEl);
			this.headerBadgeEl = null;
		}
	}

	refresh(): void {
		this.render();
	}

	render(): void {
		if (this.headerBadgeEl) {
			this.plugin.notificationManager?.removeBadge(this.headerBadgeEl);
			this.headerBadgeEl = null;
		}
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
		if (projectId) {
			this.hiddenBoardColumns = new Set(store.getHiddenBoardColumns(projectId));
			// Restore persisted collapsed board columns into collapsedSections
			for (const id of store.getCollapsedBoardColumns(projectId)) {
				this.collapsedSections.add(`board-col-${id}`);
			}
		}

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
		const activeProject = store.getProject(projectId);
		if (activeProject?.color) {
			const c = activeProject.color;
			const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
			header.style.backgroundColor = `rgba(${r},${g},${b},0.18)`;
			header.style.borderBottom = `2px solid rgba(${r},${g},${b},0.5)`;
		}
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
		const editProjectBtn = projectArea.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm' });
		setIcon(editProjectBtn, 'pencil');
		editProjectBtn.setAttribute('aria-label', 'Edit project');
		editProjectBtn.addEventListener('click', () => {
			const current = store.getProject(store.getActiveProjectId() ?? '');
			if (current) new ProjectModal(this.app, this.plugin, current, () => this.plugin.refreshAllViews()).open();
		});
		const notifProjectBtn = projectArea.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm' });
		setIcon(notifProjectBtn, 'bell');
		notifProjectBtn.setAttribute('aria-label', 'Notification settings');
		notifProjectBtn.addEventListener('click', () => {
			const current = store.getProject(store.getActiveProjectId() ?? '');
			if (current) new ProjectNotificationModal(this.app, this.plugin, current.id, current.name).open();
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

		// ── Notification bell badge ────────────────────────────────────────────
		const bellWrap = actions.createEl('div', { cls: 'pf-header-bell-wrap' });
		const bellBtn = bellWrap.createEl('button', { cls: 'pf-btn pf-btn-icon pf-header-bell' });
		bellBtn.setAttribute('aria-label', 'Notifications');
		setIcon(bellBtn, 'bell');
		bellBtn.addEventListener('click', () => this.plugin.activateView(NOTIFICATION_VIEW_TYPE));
		const headerBadge = bellWrap.createEl('span', { cls: 'pf-ribbon-badge' });
		headerBadge.style.display = 'none';
		this.headerBadgeEl = headerBadge;
		this.plugin.notificationManager?.addBadge(headerBadge);
		this.plugin.notificationManager?.updateBadge();

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

				// Type filter: hide for subtask view (everything is a subtask)
				if (this.viewMode !== 'parent') {
					const typeLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Type' });
					const typeSel = typeLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
					const typeOpts = this.viewMode === 'backlog' ? TYPE_FILTER_OPTIONS_BACKLOG : TYPE_FILTER_OPTIONS_BOARD;
					for (const opt of typeOpts) {
						const o = typeSel.createEl('option', { text: opt[1], value: opt[0] });
						if (opt[0] === this.filterType) o.selected = true;
					}
					typeSel.addEventListener('change', async () => { this.filterType = typeSel.value; await persist(); dropdown.remove(); this.render(); });
				}

				const priLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Priority' });
				const priSel = priLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
				for (const opt of [['all', 'All priorities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['none', 'None']]) {
					const o = priSel.createEl('option', { text: opt[1], value: opt[0] });
					if (opt[0] === this.filterPriority) o.selected = true;
				}
				priSel.addEventListener('change', async () => { this.filterPriority = priSel.value; await persist(); dropdown.remove(); this.render(); });

				// Status filter: hide for subtask view (columns represent status)
				if (this.viewMode !== 'parent') {
					const statusLabel = dropdown.createEl('label', { cls: 'pf-filter-label', text: 'Status' });
					const statusSel = statusLabel.createEl('select', { cls: 'pf-filter-select' }) as HTMLSelectElement;
					{ const o = statusSel.createEl('option', { text: 'All statuses', value: 'all' }); if (this.filterStatus === 'all') o.selected = true; }
					const activeStatuses = store.getProjectStatuses(projectId ?? '');
					for (const st of activeStatuses) {
						const o = statusSel.createEl('option', { text: st.label, value: st.id });
						if (st.id === this.filterStatus) o.selected = true;
					}
					statusSel.addEventListener('change', async () => { this.filterStatus = statusSel.value; await persist(); dropdown.remove(); this.render(); });
				}

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
				['priority-asc', 'Priority (high → low)'],
				['priority-desc', 'Priority (low → high)'],
				['title-asc', 'Title (A → Z)'],
				['title-desc', 'Title (Z → A)'],
				['status-asc', 'Status (A → Z)'],
				['status-desc', 'Status (Z → A)'],
				['points-asc', 'Points (low → high)'],
				['points-desc', 'Points (high → low)'],
				['created-desc', 'Created (newest)'],
				['created-asc', 'Created (oldest)'],
				['updated-desc', 'Updated (newest)'],
				['updated-asc', 'Updated (oldest)'],
				['completed-desc', 'Completed (newest)'],
				['completed-asc', 'Completed (oldest)'],
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
					const isActive = this.sortOrder === value;
					const item = dropdown.createEl('button', {
						cls: `pf-sort-option${isActive ? ' pf-sort-option-active' : ''}`,
					});
					if (isActive) {
						item.createEl('span', { cls: 'pf-sort-dot' });
					}
					item.createEl('span', { text: label });
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

		// ── Board settings gear (right-aligned in filter row) ───────────────
		const statusGearBtn = filterRow.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm pf-filter-gear', text: '⚙' });
		statusGearBtn.setAttribute('aria-label', 'Board settings');
		statusGearBtn.addEventListener('click', () => {
			if (projectId) new BoardSettingsModal(this.app, this.plugin, projectId, () => { this.plugin.refreshAllViews(); }).open();
		});

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
		cols: { key: string; label: string; cssVar: string; sortField?: string }[],
		onResize?: (key: string, width: number) => void,
		sortOrder?: string,
		onSort?: (newSortOrder: string) => void,
	): void {
		const header = container.createEl('div', { cls: 'pf-tbl-header' });

		header.createEl('div', { cls: 'pf-tbl-th' });
		header.createEl('div', { cls: 'pf-tbl-th' });

		// Parse active sort field + direction from e.g. "priority-asc" or legacy "priority"
		const sortMatch = (sortOrder ?? '').match(/^(.+)-(asc|desc)$/);
		const activeSortField = sortMatch ? sortMatch[1] : null;
		const activeSortDir   = sortMatch ? (sortMatch[2] as 'asc' | 'desc') : null;

		for (const col of cols) {
			const isSortable = !!col.sortField && !!onSort;
			const isActive   = isSortable && activeSortField === col.sortField;
			const cell = header.createEl('div', { cls: `pf-tbl-th${isSortable ? ' pf-tbl-th-sortable' : ''}` });

			cell.createEl('span', { cls: 'pf-tbl-th-label', text: col.label });

			if (isSortable) {
				const arrow = cell.createEl('span', {
					cls: `pf-tbl-sort-arrow${isActive ? ' pf-tbl-sort-active' : ''}`,
					text: isActive ? (activeSortDir === 'asc' ? '↑' : '↓') : '↕',
				});
				arrow.setAttribute('aria-hidden', 'true');

				cell.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('.pf-tbl-resize-handle')) return;
					let next: string;
					if (!isActive)                  next = `${col.sortField}-asc`;
					else if (activeSortDir === 'asc') next = `${col.sortField}-desc`;
					else                              next = 'manual';
					onSort!(next);
				});
			}

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

	// ── Status badge helper (used by panel classes) ──────────────────────────

	makeStatusBadge(parent: HTMLElement, statusId: string, projectId: string): HTMLElement {
		const statuses = this.plugin.store.getProjectStatuses(projectId);
		const def = statuses.find(s => s.id === statusId);
		const label = def?.label ?? statusId;
		const color = def?.color ?? '#888888';
		const badge = parent.createEl('span', { cls: 'pf-badge pf-status-badge', text: label });
		badge.style.background = `${color}2e`;
		badge.style.color = color;
		return badge;
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

	applySort<T extends { priority: string; title: string; status: string; points?: number; createdAt: number; updatedAt: number; completedAt?: number; archivedAt?: number; order: number }>(
		tickets: T[],
		sortOrder: string,
	): T[] {
		if (sortOrder === 'manual') return tickets;
		const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

		// Support both "field-asc"/"field-desc" and legacy bare field names (treated as asc)
		const dirMatch = sortOrder.match(/^(.+)-(asc|desc)$/);
		const field = dirMatch ? dirMatch[1] : sortOrder;
		const flip  = dirMatch && dirMatch[2] === 'desc' ? -1 : 1;

		return tickets.slice().sort((a, b) => {
			let cmp = 0;
			switch (field) {
				case 'priority': cmp = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9); break;
				case 'title':    cmp = a.title.localeCompare(b.title); break;
				case 'status':   cmp = a.status.localeCompare(b.status); break;
				case 'points':   cmp = (a.points ?? 0) - (b.points ?? 0); break;
				case 'created':  cmp = a.createdAt - b.createdAt; break;
				case 'updated':  cmp = a.updatedAt - b.updatedAt; break;
				case 'completed': cmp = (a.completedAt ?? 0) - (b.completedAt ?? 0); break;
				case 'archived': cmp = (a.archivedAt ?? 0) - (b.archivedAt ?? 0); break;
				default:         cmp = a.order - b.order;
			}
			return cmp * flip;
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
