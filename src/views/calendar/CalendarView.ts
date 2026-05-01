import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../../main';
import type { Sprint, Ticket, TicketType } from '../../types';
import { TicketModal } from '../../modals/TicketModal';
import { ProjectModal } from '../../modals/ProjectModal';
import { CalendarSettingsModal } from '../../modals/CalendarSettingsModal';
import { generateTicketNote } from '../../ticketNote';
import { NOTIFICATION_VIEW_TYPE } from '../NotificationPanelView';
import {
	TYPE_FILTER_OPTIONS,
	PRIORITY_FILTER_OPTIONS,
	getWeekRangeLabel,
	getVisibleRange,
	expandRecurrences,
} from './CalendarUtils';
import { CalendarDragDrop } from './CalendarDragDrop';
import { CalendarMonthGrid } from './CalendarMonthGrid';
import { CalendarSidebar } from './CalendarSidebar';
import { CalendarWeekGrid } from './CalendarWeekGrid';

export const CALENDAR_VIEW = 'projectflow-calendar';

export class CalendarView extends ItemView {
	plugin: ProjectFlowPlugin;

	viewMode: 'month' | 'week' | 'day' | 'agenda' = 'month';
	currentDate: Date = new Date();
	miniCalMonth: Date = new Date(); // mini-calendar's displayed month
	draggedTicketId: string | null = null;
	draggedTicketDuration = 60; // minutes; used to size ghost preview
	dragJustEnded = false;      // suppresses click 300ms after drag/resize
	_savedScrollTop: number | null = null; // preserved across render() calls
	_autoScrollInterval: number | null = null;
	showSprints = true;
	projectUsesSprints = true; // synced from active project on each render
	expandedParentIds = new Set<string>(); // week-view parent blocks with children expanded

	filterType = 'all';
	filterPriority = 'all';
	filterStatus = 'all';

	selectedProjectIds: Set<string> = new Set();
	private _dropdownCleanup: (() => void) | null = null;
	private headerBadgeEl: HTMLElement | null = null;

	// Submodule instances
	dragDrop: CalendarDragDrop;
	private monthGrid: CalendarMonthGrid;
	private sidebar: CalendarSidebar;
	private weekGrid: CalendarWeekGrid;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.dragDrop = new CalendarDragDrop(this);
		this.monthGrid = new CalendarMonthGrid(this);
		this.sidebar = new CalendarSidebar(this);
		this.weekGrid = new CalendarWeekGrid(this);
	}

	getViewType(): string { return CALENDAR_VIEW; }
	getDisplayText(): string { return 'Calendar Flow'; }
	getIcon(): string { return 'calendar-days'; }

	async onOpen(): Promise<void> {
		this.currentDate = new Date();
		this.miniCalMonth = new Date();
		// Keyboard shortcuts — only fires when this view is active
		this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
			if (this.app.workspace.getActiveViewOfType(CalendarView) !== this) return;
			const target = e.target as HTMLElement;
			if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
			switch (e.key) {
				case 'ArrowLeft':  e.preventDefault(); this.navigatePrev(); break;
				case 'ArrowRight': e.preventDefault(); this.navigateNext(); break;
				case 't': this.navigateToday(); break;
				case 'm': this.viewMode = 'month'; this.render(); break;
				case 'w': this.viewMode = 'week'; this.render(); break;
				case 'd': this.viewMode = 'day'; this.render(); break;
				case 'a': this.viewMode = 'agenda'; this.render(); break;
				case 'n': {
					const pid = this.plugin.store.getActiveProjectId();
					if (pid) new TicketModal(this.app, this.plugin, { projectId: pid, ...this.ticketCreateCtx(pid) }, () => this.render()).open();
					break;
				}
				case 'Escape': this.contentEl.querySelectorAll('.pf-cal-jump-popover').forEach(el => el.remove()); break;
			}
		});
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

	// ── Main render ────────────────────────────────────────────────────────────

	render(): void {
		if (this.headerBadgeEl) {
			this.plugin.notificationManager?.removeBadge(this.headerBadgeEl);
			this.headerBadgeEl = null;
		}
		const container = this.contentEl;
		container.empty();
		container.addClass('pf-view');

		const store = this.plugin.store;
		const activeProjectId = store.getActiveProjectId();
		const allProjects = store.getProjects();

		if (allProjects.length === 0) {
			const empty = container.createEl('div', { cls: 'pf-empty-state' });
			empty.createEl('p', { text: 'No project selected.' });
			empty.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Create project' })
				.addEventListener('click', () =>
					new ProjectModal(this.app, this.plugin, null, () => this.render()).open()
				);
			return;
		}

		// Clean up stale dropdown listener from the previous render
		if (this._dropdownCleanup) { this._dropdownCleanup(); this._dropdownCleanup = null; }

		// Resolve selected project IDs — persisted selection, falling back to active project
		const allProjectIdSet = new Set(allProjects.map(p => p.id));
		const persisted = store.getCalendarProjectIds();
		if (persisted && persisted.length > 0) {
			this.selectedProjectIds = new Set(persisted.filter(id => allProjectIdSet.has(id)));
		}
		if (this.selectedProjectIds.size === 0) {
			const fallback = activeProjectId && allProjectIdSet.has(activeProjectId)
				? activeProjectId
				: allProjects[0].id;
			this.selectedProjectIds = new Set([fallback]);
		}

		// Collect tickets + sprints from all selected projects
		const allCalendarTickets: Ticket[] = [];
		const sprints: Sprint[] = [];
		let anyUseSprints = false;
		for (const pid of this.selectedProjectIds) {
			const proj = store.getProject(pid);
			const useSprints = proj?.useSprints !== false;
			if (useSprints) anyUseSprints = true;
			const allTickets = store.getTickets({ projectId: pid }).filter(t => !t.archived);
			const boardTickets = allTickets.filter(t =>
				useSprints ? t.sprintId !== null : t.showOnBoard === true
			);
			const boardTicketIds = new Set(boardTickets.map(t => t.id));
			const subtaskTickets = allTickets.filter(t =>
				t.parentId != null && boardTicketIds.has(t.parentId) && !boardTicketIds.has(t.id)
			);
			allCalendarTickets.push(...boardTickets, ...subtaskTickets);
			if (useSprints) sprints.push(...store.getSprints(pid));
		}
		this.projectUsesSprints = anyUseSprints;

		// Compute visible date range for recurrence expansion
		const { rangeStart, rangeEnd } = getVisibleRange(this.viewMode, this.currentDate);
		const expandedTickets = expandRecurrences(this.applyFilters(allCalendarTickets), rangeStart, rangeEnd);
		const filtered = expandedTickets;
		const scheduled = filtered.filter(t => t.dueDate !== undefined);
		const unscheduled = allCalendarTickets.filter(t => t.dueDate === undefined && this.applyFilters([t]).length > 0);

		// Union of statuses from all selected projects (deduplicated by id)
		const statusMap = new Map<string, string>();
		for (const pid of this.selectedProjectIds) {
			for (const s of store.getProjectStatuses(pid)) statusMap.set(s.id, s.label);
		}
		const unionStatuses: [string, string][] = [...statusMap.entries()];

		const headerProjectId = activeProjectId && allProjectIdSet.has(activeProjectId)
			? activeProjectId
			: allProjects[0].id;
		this.renderHeader(container, headerProjectId);
		this.renderToolbar(container, unionStatuses);

		const content = container.createEl('div', { cls: 'pf-cal-content' });
		const gridWrap = content.createEl('div', { cls: 'pf-cal-grid-wrap' });

		if (this.viewMode === 'month') {
			this.monthGrid.render(gridWrap, scheduled, sprints);
		} else if (this.viewMode === 'week') {
			this.weekGrid.renderWeek(gridWrap, filtered, sprints);
		} else if (this.viewMode === 'day') {
			this.weekGrid.renderDay(gridWrap, filtered, sprints);
		} else {
			this.renderAgendaView(gridWrap, filtered);
		}

		if (this.viewMode !== 'agenda') {
			this.sidebar.render(content, unscheduled);
		}

		// Sidebar as drop zone to clear dueDate
		const sidebarEl = content.querySelector('.pf-cal-sidebar') as HTMLElement | null;
		if (sidebarEl) {
			sidebarEl.addEventListener('dragover', (e) => { e.preventDefault(); sidebarEl.addClass('pf-cal-drop-target'); });
			sidebarEl.addEventListener('dragleave', () => { sidebarEl.removeClass('pf-cal-drop-target'); });
			sidebarEl.addEventListener('drop', async (e) => {
				e.preventDefault();
				sidebarEl.removeClass('pf-cal-drop-target');
				if (!this.draggedTicketId) return;
				const ticketId = this.draggedTicketId;
				this.draggedTicketId = null;
				await this.plugin.store.updateTicket(ticketId, { dueDate: undefined, startDate: undefined });
				generateTicketNote(this.plugin, ticketId).catch(() => { /* silent */ });
				this.render();
				this.plugin.refreshAllViews();
			});
		}
	}

	// ── Header ─────────────────────────────────────────────────────────────────

	private renderHeader(container: HTMLElement, projectId: string): void {
		const store = this.plugin.store;
		const header = container.createEl('div', { cls: 'pf-board-header' });

		// Header tint: only when exactly 1 project is selected
		if (this.selectedProjectIds.size === 1) {
			const singleId = [...this.selectedProjectIds][0];
			const singleProject = store.getProject(singleId);
			if (singleProject?.color) {
				const c = singleProject.color;
				const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
				header.style.backgroundColor = `rgba(${r},${g},${b},0.18)`;
				header.style.borderBottom = `2px solid rgba(${r},${g},${b},0.5)`;
			}
		}

		const titleRow = header.createEl('div', { cls: 'pf-header-row' });
		const projectArea = titleRow.createEl('div', { cls: 'pf-project-area' });

		// ── Multi-project picker ──────────────────────────────────────────────
		const allProjects = store.getProjects();
		const pickerWrap = projectArea.createEl('div', { cls: 'pf-cal-project-picker-wrap' });

		const getTriggerLabel = (): string => {
			if (this.selectedProjectIds.size === 0) return 'No projects';
			if (this.selectedProjectIds.size === 1) {
				const pid = [...this.selectedProjectIds][0];
				return store.getProject(pid)?.name ?? '1 project';
			}
			return `${this.selectedProjectIds.size} projects`;
		};

		const triggerBtn = pickerWrap.createEl('button', {
			cls: 'pf-btn pf-btn-sm pf-cal-project-trigger',
			text: getTriggerLabel(),
		});

		let dropdownEl: HTMLElement | null = null;
		let outsideHandler: ((e: MouseEvent) => void) | null = null;

		const closeDropdown = (rerender = true): void => {
			if (outsideHandler) {
				document.removeEventListener('click', outsideHandler);
				outsideHandler = null;
			}
			this._dropdownCleanup = null;
			if (rerender) {
				store.setCalendarProjectIds([...this.selectedProjectIds]).catch(() => { /* silent */ });
				this.render();
			}
		};
		// Register cleanup so render() can call it if re-triggered externally
		this._dropdownCleanup = () => closeDropdown(false);

		triggerBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (dropdownEl) {
				dropdownEl.remove();
				dropdownEl = null;
				closeDropdown();
				return;
			}

			// Build dropdown panel
			dropdownEl = pickerWrap.createEl('div', { cls: 'pf-cal-project-dropdown' });

			// "All projects" row
			const allRow = dropdownEl.createEl('label', { cls: 'pf-cal-project-row pf-cal-project-row-all' });
			const allChecked = this.selectedProjectIds.size === allProjects.length;
			const allCb = allRow.createEl('input') as HTMLInputElement;
			allCb.type = 'checkbox';
			allCb.checked = allChecked;
			allCb.indeterminate = !allChecked && this.selectedProjectIds.size > 0;
			allRow.createEl('span', { cls: 'pf-cal-project-name', text: 'All projects' });

			// Per-project rows
			const projectCbs: { id: string; cb: HTMLInputElement }[] = [];
			for (const p of allProjects) {
				const row = dropdownEl.createEl('label', { cls: 'pf-cal-project-row' });
				const cb = row.createEl('input') as HTMLInputElement;
				cb.type = 'checkbox';
				cb.checked = this.selectedProjectIds.has(p.id);
				if (p.color) {
					const dot = row.createEl('span', { cls: 'pf-cal-project-dot' });
					dot.style.background = p.color;
				}
				row.createEl('span', { cls: 'pf-cal-project-name', text: p.name });
				projectCbs.push({ id: p.id, cb });

				cb.addEventListener('change', () => {
					if (cb.checked) {
						this.selectedProjectIds.add(p.id);
					} else {
						this.selectedProjectIds.delete(p.id);
						// Always keep at least one selected
						if (this.selectedProjectIds.size === 0) {
							this.selectedProjectIds.add(p.id);
							cb.checked = true;
						}
					}
					const nowAll = this.selectedProjectIds.size === allProjects.length;
					allCb.checked = nowAll;
					allCb.indeterminate = !nowAll && this.selectedProjectIds.size > 0;
					triggerBtn.setText(getTriggerLabel());
				});
			}

			allCb.addEventListener('change', () => {
				if (allCb.checked) {
					for (const { id, cb } of projectCbs) {
						this.selectedProjectIds.add(id);
						cb.checked = true;
					}
				} else {
					// Keep only the first project selected
					this.selectedProjectIds.clear();
					if (allProjects[0]) this.selectedProjectIds.add(allProjects[0].id);
					for (const { id, cb } of projectCbs) cb.checked = this.selectedProjectIds.has(id);
				}
				allCb.indeterminate = false;
				triggerBtn.setText(getTriggerLabel());
			});

			// Close on outside click
			outsideHandler = (e: MouseEvent) => {
				if (!pickerWrap.contains(e.target as Node)) {
					dropdownEl?.remove();
					dropdownEl = null;
					closeDropdown();
				}
			};
			setTimeout(() => document.addEventListener('click', outsideHandler!), 0);
		});

		// Edit button — only when exactly 1 project selected
		if (this.selectedProjectIds.size === 1) {
			const singleId = [...this.selectedProjectIds][0];
			const editBtn = projectArea.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm' });
			setIcon(editBtn, 'pencil');
			editBtn.setAttribute('aria-label', 'Edit project');
			editBtn.addEventListener('click', () => {
				const current = store.getProject(singleId);
				if (current) new ProjectModal(this.app, this.plugin, current, () => this.plugin.refreshAllViews()).open();
			});
		}

		projectArea.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Project' })
			.addEventListener('click', () =>
				new ProjectModal(this.app, this.plugin, null, () => this.plugin.refreshAllViews()).open()
			);

		// Date title
		let title: string;
		if (this.viewMode === 'month' || this.viewMode === 'agenda') {
			title = this.currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
		} else if (this.viewMode === 'week') {
			title = getWeekRangeLabel(this.currentDate);
		} else {
			title = this.currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
		}
		const titleEl = titleRow.createEl('h2', { cls: 'pf-view-title pf-cal-jump-trigger', text: title });
		titleEl.setAttribute('title', 'Click to jump to date');
		titleEl.style.cursor = 'pointer';
		titleEl.addEventListener('click', () => this.openJumpToDate(titleEl));

		const actions = titleRow.createEl('div', { cls: 'pf-header-actions' });
		actions.createEl('button', { cls: 'pf-btn pf-btn-primary', text: '+ Ticket' })
			.addEventListener('click', () =>
				new TicketModal(this.app, this.plugin, { projectId, sprintId: null }, () => this.render()).open()
			);

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
	}

	// ── Toolbar ────────────────────────────────────────────────────────────────

	private renderToolbar(container: HTMLElement, projectStatuses: [string, string][]): void {
		const toolbar = container.createEl('div', { cls: 'pf-cal-toolbar' });

		const navGroup = toolbar.createEl('div', { cls: 'pf-cal-toolbar-group' });
		navGroup.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '‹' }).addEventListener('click', () => this.navigatePrev());
		navGroup.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Today' }).addEventListener('click', () => this.navigateToday());
		navGroup.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '›' }).addEventListener('click', () => this.navigateNext());

		const modeGroup = toolbar.createEl('div', { cls: 'pf-cal-toolbar-group' });
		for (const mode of ['month', 'week', 'day', 'agenda'] as const) {
			const label = mode.charAt(0).toUpperCase() + mode.slice(1);
			const btn = modeGroup.createEl('button', {
				cls: 'pf-cal-mode-btn' + (this.viewMode === mode ? ' active' : ''),
				text: label,
			});
			btn.addEventListener('click', () => { this.viewMode = mode; this.render(); });
		}

		// Sprint overlay toggle — only shown when project uses sprints
		if (this.projectUsesSprints) {
			const sprintToggleBtn = toolbar.createEl('button', {
				cls: 'pf-btn pf-btn-sm pf-cal-sprint-toggle' + (this.showSprints ? ' active' : ''),
				text: this.showSprints ? '◉ Sprints' : '○ Sprints',
			});
			sprintToggleBtn.setAttribute('title', 'Toggle sprint bands');
			sprintToggleBtn.addEventListener('click', () => {
				this.showSprints = !this.showSprints;
				this.render();
			});
		}

		const filterGroup = toolbar.createEl('div', { cls: 'pf-cal-toolbar-group' });

		const typeSel = filterGroup.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
		for (const [val, label] of TYPE_FILTER_OPTIONS) {
			const opt = typeSel.createEl('option', { text: label, value: val });
			if (val === this.filterType) opt.selected = true;
		}
		typeSel.addEventListener('change', () => { this.filterType = typeSel.value; this.render(); });

		const prioritySel = filterGroup.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
		for (const [val, label] of PRIORITY_FILTER_OPTIONS) {
			const opt = prioritySel.createEl('option', { text: label, value: val });
			if (val === this.filterPriority) opt.selected = true;
		}
		prioritySel.addEventListener('change', () => { this.filterPriority = prioritySel.value; this.render(); });

		const statusSel = filterGroup.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
		statusSel.createEl('option', { text: 'All statuses', value: 'all' }).selected = this.filterStatus === 'all';
		for (const [val, label] of projectStatuses) {
			const opt = statusSel.createEl('option', { text: label, value: val });
			if (val === this.filterStatus) opt.selected = true;
		}
		statusSel.addEventListener('change', () => { this.filterStatus = statusSel.value; this.render(); });

		const gearBtn = toolbar.createEl('button', { cls: 'pf-btn pf-btn-icon pf-btn-sm pf-filter-gear', text: '⚙' });
		gearBtn.setAttribute('aria-label', 'Calendar settings');
		gearBtn.addEventListener('click', () => {
			new CalendarSettingsModal(this.app, this.plugin, () => this.render(), this.viewMode).open();
		});
	}

	// ── Ticket chip (month view + sidebar) ────────────────────────────────────

	renderTicketChip(parent: HTMLElement, ticket: Ticket & { isGhost?: boolean; originalId?: string }): HTMLElement {
		const store = this.plugin.store;
		const project = store.getProject(ticket.projectId);
		const key = project ? `${project.tag}-${ticket.ticketNumber}` : '';

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const isGhost = (ticket as any).isGhost === true;
		const chip = parent.createEl('div', {
			cls: `pf-cal-chip pf-priority-edge-${ticket.priority}${isGhost ? ' pf-cal-chip-ghost' : ''}`,
			attr: { 'data-id': ticket.id, draggable: isGhost ? 'false' : 'true' },
		});

		// Show a colored project dot when multiple projects are visible
		if (this.selectedProjectIds.size > 1 && project?.color) {
			const dot = chip.createEl('span', { cls: 'pf-cal-project-dot pf-cal-chip-project-dot' });
			dot.style.background = project.color;
		}
		chip.createEl('span', { cls: `pf-cal-chip-type pf-type-badge-${ticket.type}`, text: ticket.type.charAt(0).toUpperCase() });
		chip.createEl('span', { cls: 'pf-cal-chip-title', text: ticket.title });
		if (ticket.recurrence) chip.createEl('span', { cls: 'pf-cal-repeat-icon', text: '↻', attr: { title: `Repeats ${ticket.recurrence.rule}` } });

		// Show time if set
		if (ticket.dueDate !== undefined) {
			const d = new Date(ticket.dueDate);
			if (d.getHours() !== 0 || d.getMinutes() !== 0) {
				const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
				chip.createEl('span', { cls: 'pf-cal-chip-time', text: timeStr });
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const openTicket = isGhost
			? (store.getTicket((ticket as any).originalId) ?? ticket)
			: ticket;

		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.dragJustEnded) return;
			new TicketModal(this.app, this.plugin, { ticket: openTicket as Ticket, sprintId: openTicket.sprintId }, () => this.render()).open();
		});
		chip.addEventListener('dragstart', (e) => {
			if (isGhost) { e.preventDefault(); return; }
			this.draggedTicketId = ticket.id;
			chip.addClass('pf-dragging');
			if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(chip, 0, 0); }
		});
		chip.addEventListener('dragend', () => {
			chip.removeClass('pf-dragging');
			this.contentEl.querySelectorAll('.pf-cal-drop-target').forEach(el => el.removeClass('pf-cal-drop-target'));
			this.draggedTicketId = null;
			this.dragJustEnded = true;
			window.setTimeout(() => { this.dragJustEnded = false; }, 300);
		});

		void key; // suppress unused warning — key is referenced in chip identification
		return chip;
	}

	// ── Filters ────────────────────────────────────────────────────────────────

	applyFilters(tickets: Ticket[]): Ticket[] {
		return tickets.filter(t => {
			if (this.filterType !== 'all' && t.type !== this.filterType) return false;
			if (this.filterPriority !== 'all' && t.priority !== this.filterPriority) return false;
			if (this.filterStatus !== 'all' && t.status !== this.filterStatus) return false;
			return true;
		});
	}

	// ── Ticket create context ──────────────────────────────────────────────────

	/** Returns the sprintId + showOnBoard context so calendar-created tickets pass the board filter. */
	ticketCreateCtx(projectId: string): { sprintId: string | null; showOnBoard?: boolean } {
		const proj = this.plugin.store.getProject(projectId);
		if (!proj || proj.useSprints === false) {
			return { sprintId: null, showOnBoard: true };
		}
		const sprint = this.plugin.store.getActiveSprint(projectId)
			?? this.plugin.store.getSprints(projectId).find(s => s.status === 'planning');
		return { sprintId: sprint?.id ?? null };
	}

	// ── Agenda view ────────────────────────────────────────────────────────────

	private renderAgendaView(container: HTMLElement, tickets: Ticket[]): void {
		const agenda = container.createEl('div', { cls: 'pf-agenda-view' });
		const today = new Date();
		const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

		const isDone = (t: Ticket): boolean => {
			const statuses = this.plugin.store.getProjectStatuses(t.projectId);
			const def = statuses.find(s => s.id === t.status);
			return def?.universalId === 'done';
		};

		// Gather tickets with due dates — overdue + next 60 days; exclude done tickets
		const rangeEnd = todayMs + 60 * 86400000;
		const scheduled = tickets.filter(t => t.dueDate !== undefined && !isDone(t));
		const overdue = scheduled.filter(t => new Date(t.dueDate!.valueOf()).setHours(0,0,0,0) < todayMs)
			.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
		const upcoming = scheduled.filter(t => {
			const d = new Date(t.dueDate!);
			const dMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			return dMs >= todayMs && dMs <= rangeEnd;
		}).sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));

		if (overdue.length === 0 && upcoming.length === 0) {
			agenda.createEl('div', { cls: 'pf-agenda-empty', text: 'No upcoming tickets with due dates.' });
			return;
		}

		const renderGroup = (dateLabel: string, items: Ticket[], isOverdue = false) => {
			if (items.length === 0) return;
			const section = agenda.createEl('div', { cls: 'pf-agenda-section' });
			const header = section.createEl('div', { cls: 'pf-agenda-date-header' + (isOverdue ? ' pf-agenda-overdue-header' : ''), text: dateLabel });
			if (isOverdue) header.setAttribute('title', 'Past due date');
			const list = section.createEl('div', { cls: 'pf-agenda-items' });
			for (const ticket of items) {
				const project = this.plugin.store.getProject(ticket.projectId);
				const key = project ? `${project.tag}-${ticket.ticketNumber}` : '';
				const item = list.createEl('div', { cls: `pf-agenda-item pf-priority-edge-${ticket.priority}` });
				if (ticket.dueDate !== undefined) {
					const d = new Date(ticket.dueDate);
					if (d.getHours() !== 0 || d.getMinutes() !== 0) {
						item.createEl('span', { cls: 'pf-agenda-time', text: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` });
					} else {
						item.createEl('span', { cls: 'pf-agenda-time pf-agenda-time-allday', text: 'All day' });
					}
				} else {
					item.createEl('span', { cls: 'pf-agenda-time pf-agenda-time-allday', text: 'All day' });
				}
				item.createEl('span', { cls: `pf-cal-chip-type pf-type-badge-${ticket.type}`, text: ticket.type.charAt(0).toUpperCase() });
				item.createEl('span', { cls: 'pf-agenda-key', text: key });
				item.createEl('span', { cls: 'pf-agenda-title', text: ticket.title });
				const statuses = this.plugin.store.getProjectStatuses(ticket.projectId);
				const statusDef = statuses.find(s => s.id === ticket.status);
				const statusLabel = statusDef?.label ?? ticket.status;
				const statusColor = statusDef?.color ?? '#888888';
				const statusBadge = item.createEl('span', { cls: 'pf-agenda-status pf-badge pf-status-badge', text: statusLabel });
				statusBadge.style.background = `${statusColor}2e`;
				statusBadge.style.color = statusColor;
				item.addEventListener('click', () => {
					new TicketModal(this.app, this.plugin, { ticket, sprintId: ticket.sprintId }, () => this.render()).open();
				});
			}
		};

		if (overdue.length > 0) renderGroup('Overdue', overdue, true);

		// Group upcoming by date
		const byDate = new Map<number, Ticket[]>();
		for (const t of upcoming) {
			const d = new Date(t.dueDate!);
			const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			const arr = byDate.get(key) ?? [];
			arr.push(t);
			byDate.set(key, arr);
		}
		for (const [ms, items] of byDate) {
			const d = new Date(ms);
			let label: string;
			if (ms === todayMs) label = 'Today';
			else if (ms === todayMs + 86400000) label = 'Tomorrow';
			else label = d.toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' });
			renderGroup(label, items);
		}
	}

	// ── Jump to date popover ───────────────────────────────────────────────────

	openJumpToDate(anchor: HTMLElement): void {
		// Remove any existing popover
		document.querySelectorAll('.pf-cal-jump-popover').forEach(el => el.remove());

		const popover = document.body.createEl('div', { cls: 'pf-cal-jump-popover' });

		// Position below anchor
		const rect = anchor.getBoundingClientRect();
		popover.style.top  = `${rect.bottom + 6}px`;
		popover.style.left = `${rect.left}px`;

		const monthInput = popover.createEl('input', { attr: { type: 'month' } }) as HTMLInputElement;
		monthInput.value = `${this.currentDate.getFullYear()}-${String(this.currentDate.getMonth() + 1).padStart(2, '0')}`;

		const goBtn = popover.createEl('button', { cls: 'pf-btn pf-btn-primary pf-btn-sm', text: 'Go' });
		goBtn.addEventListener('click', () => {
			const val = monthInput.value; // "YYYY-MM"
			if (!val) return;
			const [y, m] = val.split('-').map(Number);
			this.currentDate = new Date(y, m - 1, 1);
			if (this.viewMode !== 'month') this.viewMode = 'month';
			popover.remove();
			this.render();
		});

		// Close on outside click or Escape
		const closeHandler = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node) && e.target !== anchor) {
				popover.remove();
				document.removeEventListener('mousedown', closeHandler);
			}
		};
		setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
		monthInput.focus();
	}

	// ── Navigation ─────────────────────────────────────────────────────────────

	private navigatePrev(): void {
		this._savedScrollTop = null;
		if (this.viewMode === 'month' || this.viewMode === 'agenda') {
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
		} else if (this.viewMode === 'week') {
			const d = new Date(this.currentDate); d.setDate(d.getDate() - 7); this.currentDate = d;
		} else {
			const d = new Date(this.currentDate); d.setDate(d.getDate() - 1); this.currentDate = d;
		}
		this.render();
	}

	private navigateNext(): void {
		this._savedScrollTop = null;
		if (this.viewMode === 'month' || this.viewMode === 'agenda') {
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1);
		} else if (this.viewMode === 'week') {
			const d = new Date(this.currentDate); d.setDate(d.getDate() + 7); this.currentDate = d;
		} else {
			const d = new Date(this.currentDate); d.setDate(d.getDate() + 1); this.currentDate = d;
		}
		this.render();
	}

	private navigateToday(): void { this._savedScrollTop = null; this.currentDate = new Date(); this.render(); }
}
