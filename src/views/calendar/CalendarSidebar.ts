import type { CalendarView } from './CalendarView';
import type { Ticket } from '../../types';
import { AutoScheduleModal, ScheduleSuggestion } from '../../modals/AutoScheduleModal';
import { dateOnlyMs, hasTime, isSameDay, getMonthWeeks } from './CalendarUtils';

export class CalendarSidebar {
	constructor(private view: CalendarView) {}

	// ── Unscheduled sidebar ────────────────────────────────────────────────────

	render(container: HTMLElement, tickets: Ticket[]): void {
		const sidebar = container.createEl('div', { cls: 'pf-cal-sidebar' });

		// Mini calendar at top of sidebar
		const store = this.view.plugin.store;
		const projectId = store.getActiveProjectId();
		const allScheduled = projectId
			? store.getTickets({ projectId }).filter(t => !t.archived && t.dueDate !== undefined)
			: [];
		this.renderMiniCalendar(sidebar, allScheduled);

		// Sidebar header with auto-schedule button
		const sidebarHeaderRow = sidebar.createEl('div', { cls: 'pf-cal-sidebar-header-row' });
		sidebarHeaderRow.createEl('div', { cls: 'pf-cal-sidebar-title', text: 'Unscheduled' });
		if (tickets.length > 0) {
			const schedBtn = sidebarHeaderRow.createEl('button', { cls: 'pf-btn pf-btn-sm pf-cal-autosched-btn', text: '⚡ Schedule', attr: { title: 'Auto-schedule into free time slots' } });
			schedBtn.addEventListener('click', () => this.openAutoSchedule(tickets));
		}

		// Determine which status IDs count as "done" for this project
		const pid = store.getActiveProjectId();
		const doneIds = new Set(
			(pid ? store.getProjectStatuses(pid) : [])
				.filter(s => s.universalId === 'done')
				.map(s => s.id)
		);

		// Split into parent/standalone tickets vs subtasks
		const parentTickets = tickets.filter(t => !t.parentId);
		const subtasks      = tickets.filter(t =>  t.parentId);

		const list = sidebar.createEl('div', { cls: 'pf-cal-sidebar-list' });
		if (tickets.length === 0) {
			list.createEl('div', { cls: 'pf-cal-sidebar-empty', text: 'All tickets have due dates.' });
			return;
		}

		// Helper: render an active/done split into a container
		const renderActiveAndDone = (container: HTMLElement, items: Ticket[]) => {
			const active = items.filter(t => !doneIds.has(t.status));
			const done   = items.filter(t =>  doneIds.has(t.status));

			for (const ticket of active) this.view.renderTicketChip(container, ticket);

			if (done.length > 0) {
				const doneSection = container.createEl('div', { cls: 'pf-cal-sidebar-done-section' });
				const doneHeader  = doneSection.createEl('div', { cls: 'pf-cal-sidebar-done-header' });
				doneHeader.createEl('span', { cls: 'pf-cal-sidebar-done-label', text: `Done (${done.length})` });
				const chevron = doneHeader.createEl('span', { cls: 'pf-cal-sidebar-done-chevron', text: '▸' });

				const doneList = doneSection.createEl('div', { cls: 'pf-cal-sidebar-done-list pf-cal-sidebar-done-collapsed' });
				for (const ticket of done) this.view.renderTicketChip(doneList, ticket);

				doneHeader.addEventListener('click', () => {
					const collapsed = doneList.hasClass('pf-cal-sidebar-done-collapsed');
					doneList.toggleClass('pf-cal-sidebar-done-collapsed', !collapsed);
					chevron.textContent = collapsed ? '▾' : '▸';
				});
			}
		};

		// Parent / standalone tickets
		renderActiveAndDone(list, parentTickets);

		// Subtasks section — only shown if there are unscheduled subtasks
		if (subtasks.length > 0) {
			const subtaskSection = list.createEl('div', { cls: 'pf-cal-sidebar-subtask-section' });
			subtaskSection.createEl('div', { cls: 'pf-cal-sidebar-subtask-header', text: `Subtasks (${subtasks.length})` });
			renderActiveAndDone(subtaskSection, subtasks);
		}
	}

	// ── Mini calendar ──────────────────────────────────────────────────────────

	renderMiniCalendar(container: HTMLElement, scheduledTickets: Ticket[]): void {
		const wrap = container.createEl('div', { cls: 'pf-mini-cal' });
		const today = new Date();
		const year  = this.view.miniCalMonth.getFullYear();
		const month = this.view.miniCalMonth.getMonth();

		// Header: prev arrow, "Apr 2026", next arrow
		const header = wrap.createEl('div', { cls: 'pf-mini-cal-header' });
		header.createEl('button', { cls: 'pf-mini-cal-nav', text: '‹' })
			.addEventListener('click', () => {
				this.view.miniCalMonth = new Date(year, month - 1, 1);
				this.view.render();
			});
		header.createEl('span', { cls: 'pf-mini-cal-title',
			text: this.view.miniCalMonth.toLocaleString('default', { month: 'short', year: 'numeric' }),
		});
		header.createEl('button', { cls: 'pf-mini-cal-nav', text: '›' })
			.addEventListener('click', () => {
				this.view.miniCalMonth = new Date(year, month + 1, 1);
				this.view.render();
			});

		// Day-of-week labels
		const grid = wrap.createEl('div', { cls: 'pf-mini-cal-grid' });
		for (const lbl of ['M','T','W','T','F','S','S']) {
			grid.createEl('div', { cls: 'pf-mini-cal-dow', text: lbl });
		}

		// Ticket day set for dot indicators
		const ticketDays = new Set(
			scheduledTickets
				.filter(t => t.dueDate !== undefined)
				.map(t => dateOnlyMs(new Date(t.dueDate!)))
		);

		const weeks = getMonthWeeks(year, month);
		for (const week of weeks) {
			for (const day of week) {
				const isCurrentMonth = day.getMonth() === month;
				const isToday = isSameDay(day, today);
				const isSelected = isSameDay(day, this.view.currentDate);
				const dayMs = dateOnlyMs(day);
				const hasTix = ticketDays.has(dayMs);

				const cell = grid.createEl('div', {
					cls: [
						'pf-mini-cal-day',
						isCurrentMonth ? '' : 'pf-mini-cal-outside',
						isToday ? 'pf-mini-cal-today' : '',
						isSelected ? 'pf-mini-cal-selected' : '',
					].filter(Boolean).join(' '),
				});
				cell.createEl('span', { text: String(day.getDate()) });
				if (hasTix) cell.createEl('div', { cls: 'pf-mini-cal-dot' });

				cell.addEventListener('click', () => {
					this.view.currentDate = new Date(day);
					if (this.view.viewMode === 'month') this.view.viewMode = 'day';
					this.view.render();
				});
			}
		}
	}

	// ── Auto-schedule ──────────────────────────────────────────────────────────

	openAutoSchedule(unscheduled: Ticket[]): void {
		const suggestions = this.suggestSchedule(unscheduled);
		new AutoScheduleModal(this.view.app, this.view.plugin, suggestions, () => {
			this.view.render();
			this.view.plugin.refreshAllViews();
		}).open();
	}

	/**
	 * Finds free time slots within working hours (09:00–17:00) for the next 7 days.
	 * Returns array of {start, end} ms timestamps for available gaps.
	 */
	private findFreeSlots(existingTimed: Ticket[]): { start: number; end: number }[] {
		const WORK_START = 9, WORK_END = 17;
		const slots: { start: number; end: number }[] = [];
		const today = new Date();

		for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
			const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset);
			const dayMs = day.getTime();
			const workStart = dayMs + WORK_START * 3600000;
			const workEnd   = dayMs + WORK_END   * 3600000;

			// Collect busy intervals for this day
			const busyMs = dateOnlyMs(day);
			const busy: { s: number; e: number }[] = [];
			for (const t of existingTimed) {
				if (t.dueDate === undefined) continue;
				const dueMs = dateOnlyMs(new Date(t.dueDate));
				if (dueMs !== busyMs) continue;
				const startMs = t.startDate !== undefined ? t.startDate : t.dueDate - 3600000;
				busy.push({ s: Math.max(startMs, workStart), e: Math.min(t.dueDate, workEnd) });
			}
			busy.sort((a, b) => a.s - b.s);

			// Find gaps
			let cursor = workStart;
			for (const b of busy) {
				if (b.s > cursor + 900000) { // at least 15 min gap
					slots.push({ start: cursor, end: b.s });
				}
				cursor = Math.max(cursor, b.e);
			}
			if (workEnd > cursor + 900000) slots.push({ start: cursor, end: workEnd });
		}
		return slots;
	}

	/** Assigns unscheduled tickets to free slots by priority. */
	private suggestSchedule(unscheduled: Ticket[]): ScheduleSuggestion[] {
		const store = this.view.plugin.store;
		const projectId = store.getActiveProjectId();
		if (!projectId) return [];

		const allTimed = store.getTickets({ projectId })
			.filter(t => !t.archived && t.dueDate !== undefined && hasTime(t.dueDate));
		const freeSlots = this.findFreeSlots(allTimed);

		// Sort by priority
		const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
		const sorted = [...unscheduled].sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));

		const suggestions: ScheduleSuggestion[] = [];
		const slotCursors = freeSlots.map(s => s.start);

		for (const ticket of sorted) {
			const durationMs = (ticket.points ?? 1) * 3600000; // 1 hr per point, min 1hr
			// Find first slot with enough space
			for (let i = 0; i < freeSlots.length; i++) {
				const slotEnd = freeSlots[i].end;
				const cursorStart = slotCursors[i];
				if (slotEnd - cursorStart >= durationMs) {
					const suggestedStart = cursorStart;
					const suggestedDue   = cursorStart + durationMs;
					suggestions.push({ ticket, suggestedStart, suggestedDue });
					slotCursors[i] = suggestedDue;
					break;
				}
			}
		}
		return suggestions;
	}
}
