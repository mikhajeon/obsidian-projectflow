import type { CalendarView } from './CalendarView';
import type { Ticket, Sprint } from '../../types';
import { TicketModal } from '../../modals/TicketModal';
import {
	WEEKDAY_LABELS,
	HOUR_HEIGHT,
	HOURS,
	BlockLayout,
	dateOnlyMs,
	hasTime,
	isSameDay,
	getDayOfWeekIndex,
	getWeekDays,
	buildOverlapLayout,
	isHiddenChild,
} from './CalendarUtils';

export class CalendarWeekGrid {
	constructor(private view: CalendarView) {}

	// ── Week time-grid ─────────────────────────────────────────────────────────

	renderWeek(container: HTMLElement, tickets: Ticket[], sprints: Sprint[]): void {
		const days = getWeekDays(this.view.currentDate);
		const today = new Date();
		const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

		// Split tickets: all-day (no time or dueDate-only at midnight) vs timed
		const allDayTickets = tickets.filter(t => t.dueDate !== undefined && !hasTime(t.dueDate!));
		const timedTickets  = tickets.filter(t => t.dueDate !== undefined && hasTime(t.dueDate!));
		// Tickets with no dueDate go to sidebar, not here
		// (unscheduled tickets are rendered in the sidebar, not here)

		// ── Header row: time spacer + day labels ─────────────────────────────
		const headerRow = container.createEl('div', { cls: 'pf-cal-week-header-row' });
		headerRow.createEl('div', { cls: 'pf-cal-time-spacer' });
		for (const day of days) {
			const isToday = isSameDay(day, today);
			const isPast = !isToday && day < startOfToday;
			const label = `${WEEKDAY_LABELS[getDayOfWeekIndex(day)]} ${day.getDate()}`;
			headerRow.createEl('div', {
				cls: 'pf-cal-week-day-header'
					+ (isToday ? ' pf-cal-today-header' : '')
					+ (isPast  ? ' pf-cal-past-header'  : ''),
				text: label,
			});
		}

		// ── All-day row ───────────────────────────────────────────────────────
		const allDayRow = container.createEl('div', { cls: 'pf-cal-allday-row' });
		allDayRow.createEl('div', { cls: 'pf-cal-allday-label', text: 'All day' });
		for (const day of days) {
			const isToday = isSameDay(day, today);
			const isPast = !isToday && day < startOfToday;
			const col = allDayRow.createEl('div', {
				cls: 'pf-cal-allday-col' + (isPast ? ' pf-cal-past-allday' : ''),
			});
			const dayAllDay = allDayTickets
				.filter(t => isSameDay(new Date(t.dueDate!), day))
				.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
			for (const ticket of dayAllDay) this.view.renderTicketChip(col, ticket);
			col.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).closest('.pf-cal-chip')) return;
				const pid = this.view.plugin.store.getActiveProjectId();
				if (!pid) return;
				const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
				new TicketModal(this.view.app, this.view.plugin, { projectId: pid, ...this.view.ticketCreateCtx(pid), dueDate, startDate: dueDate }, () => this.view.render()).open();
			});
			// isAllDayRow=true: drops strip time and set startDate=dueDate=midnight
			this.view.dragDrop.setupDayDropZone(col, day, false, true);
		}

		// ── Scrollable time body ──────────────────────────────────────────────
		const scrollBody = container.createEl('div', { cls: 'pf-cal-timebody' });
		const timeGrid = scrollBody.createEl('div', { cls: 'pf-cal-timegrid' });

		// Time column (labels)
		const timeCol = timeGrid.createEl('div', { cls: 'pf-cal-time-col' });
		for (const hour of HOURS) {
			const label = hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`;
			timeCol.createEl('div', { cls: 'pf-cal-time-label', text: label });
		}

		// Day columns
		for (const day of days) {
			const isToday = isSameDay(day, today);
			const isPast = !isToday && day < startOfToday;
			const col = timeGrid.createEl('div', {
				cls: 'pf-cal-week-day-col'
					+ (isToday ? ' pf-cal-today-col' : '')
					+ (isPast  ? ' pf-cal-past-col'  : ''),
			});

			if (isToday) this.renderNowLine(col);

			// Sprint bars at top of col
			if (this.view.showSprints) {
				const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
				const dayEnd   = dayStart + 86400000 - 1;
				const overlapping = sprints.filter(s => s.startDate <= dayEnd && s.endDate >= dayStart);
				if (overlapping.length > 0) {
					const sprintStripe = col.createEl('div', { cls: 'pf-cal-week-sprint-stripe' });
					for (const sprint of overlapping) {
						const bar = sprintStripe.createEl('div', { cls: `pf-cal-sprint-bar pf-cal-sprint-${sprint.status}` });
						bar.setAttribute('title', sprint.name);
					}
				}
			}

			// Hour grid lines
			for (const hour of HOURS) {
				const line = col.createEl('div', { cls: 'pf-cal-hour-line' });
				line.style.top = `${hour * HOUR_HEIGHT}px`;
				// Click on hour slot to create ticket with that time
				const h = hour;
				line.addEventListener('click', () => {
					const pid = this.view.plugin.store.getActiveProjectId();
					if (!pid) return;
					const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0).getTime();
					new TicketModal(this.view.app, this.view.plugin, { projectId: pid, ...this.view.ticketCreateCtx(pid), dueDate, startDate: dueDate }, () => this.view.render()).open();
				});
			}

			// Timed ticket blocks — include any ticket whose span overlaps this day
			const dayMs = dateOnlyMs(day);
			const dayTimed = timedTickets.filter(t => {
				const dueMs  = dateOnlyMs(new Date(t.dueDate!));
				const startMs = t.startDate !== undefined
					? dateOnlyMs(new Date(t.startDate))
					: dueMs;
				return dayMs >= startMs && dayMs <= dueMs;
			});
			const layoutMap = buildOverlapLayout(dayTimed, day);
			for (const ticket of dayTimed) {
				const layout = layoutMap.get(ticket.id) ?? { colIndex: 0, colCount: 1, hiddenChildren: [], insetLevel: 0 };
				// Skip children that are hidden behind a parent badge
				if (isHiddenChild(ticket.id, layoutMap)) continue;
				this.renderTimedBlock(col, ticket, day, layout);
			}

			// Drop zone on the column background (isTimeGrid=true: drop Y sets time)
			this.view.dragDrop.setupDayDropZone(col, day, true);
		}

		// Restore saved scroll or default to 8am; align header/allday widths with scroll content
		requestAnimationFrame(() => {
			if (this.view._savedScrollTop !== null) {
				scrollBody.scrollTop = this.view._savedScrollTop;
				// Do not clear _savedScrollTop here — refreshAllViews may trigger another render
				// and we want to preserve position. It is cleared only on explicit navigation.
			} else {
				scrollBody.scrollTop = 8 * HOUR_HEIGHT - 20;
			}
			// Compensate for vertical scrollbar width so header/allday cols match time-grid cols
			const sbw = scrollBody.offsetWidth - scrollBody.clientWidth;
			if (sbw > 0) {
				headerRow.style.paddingRight = `${sbw}px`;
				allDayRow.style.paddingRight = `${sbw}px`;
			}
		});
	}

	// ── Day view ───────────────────────────────────────────────────────────────

	renderDay(container: HTMLElement, tickets: Ticket[], sprints: Sprint[]): void {
		const day = this.view.currentDate;
		const today = new Date();
		const isToday = isSameDay(day, today);

		const allDayTickets = tickets.filter(t => t.dueDate !== undefined && !hasTime(t.dueDate!) && isSameDay(new Date(t.dueDate!), day));
		const timedTickets  = tickets.filter(t => t.dueDate !== undefined && hasTime(t.dueDate!));

		// Header row
		const headerRow = container.createEl('div', { cls: 'pf-cal-week-header-row' });
		headerRow.createEl('div', { cls: 'pf-cal-time-spacer' });
		const dayLabel = day.toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' });
		headerRow.createEl('div', {
			cls: 'pf-cal-week-day-header pf-cal-day-view-header' + (isToday ? ' pf-cal-today-header' : ''),
			text: dayLabel,
		});

		// All-day row
		const allDayRow = container.createEl('div', { cls: 'pf-cal-allday-row' });
		allDayRow.createEl('div', { cls: 'pf-cal-allday-label', text: 'All day' });
		const allDayCol = allDayRow.createEl('div', { cls: 'pf-cal-allday-col pf-cal-day-view-col' });
		for (const ticket of allDayTickets) this.view.renderTicketChip(allDayCol, ticket);
		allDayCol.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('.pf-cal-chip')) return;
			const pid = this.view.plugin.store.getActiveProjectId();
			if (!pid) return;
			const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
			new TicketModal(this.view.app, this.view.plugin, { projectId: pid, ...this.view.ticketCreateCtx(pid), dueDate, startDate: dueDate }, () => this.view.render()).open();
		});

		// Scrollable time body
		const scrollBody = container.createEl('div', { cls: 'pf-cal-timebody' });
		const timeGrid = scrollBody.createEl('div', { cls: 'pf-cal-timegrid' });

		const timeCol = timeGrid.createEl('div', { cls: 'pf-cal-time-col' });
		for (const hour of HOURS) {
			const label = hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`;
			timeCol.createEl('div', { cls: 'pf-cal-time-label', text: label });
		}

		const col = timeGrid.createEl('div', {
			cls: 'pf-cal-week-day-col pf-cal-day-view-col' + (isToday ? ' pf-cal-today-col' : ''),
		});

		if (isToday) this.renderNowLine(col);

		// Sprint stripe
		if (this.view.showSprints) {
			const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
			const dayEnd   = dayStart + 86400000 - 1;
			const overlapping = sprints.filter(s => s.startDate <= dayEnd && s.endDate >= dayStart);
			if (overlapping.length > 0) {
				const sprintStripe = col.createEl('div', { cls: 'pf-cal-week-sprint-stripe' });
				for (const sprint of overlapping) {
					const bar = sprintStripe.createEl('div', { cls: `pf-cal-sprint-bar pf-cal-sprint-${sprint.status}` });
					bar.setAttribute('title', sprint.name);
				}
			}
		}

		for (const hour of HOURS) {
			const line = col.createEl('div', { cls: 'pf-cal-hour-line' });
			line.style.top = `${hour * HOUR_HEIGHT}px`;
			const h = hour;
			line.addEventListener('click', () => {
				const pid = this.view.plugin.store.getActiveProjectId();
				if (!pid) return;
				const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0).getTime();
				new TicketModal(this.view.app, this.view.plugin, { projectId: pid, ...this.view.ticketCreateCtx(pid), dueDate, startDate: dueDate }, () => this.view.render()).open();
			});
		}

		const dayMs = dateOnlyMs(day);
		const dayTimed = timedTickets.filter(t => {
			const dueMs   = dateOnlyMs(new Date(t.dueDate!));
			const startMs = t.startDate !== undefined ? dateOnlyMs(new Date(t.startDate)) : dueMs;
			return dayMs >= startMs && dayMs <= dueMs;
		});
		const layoutMap = buildOverlapLayout(dayTimed, day);
		for (const ticket of dayTimed) {
			if (isHiddenChild(ticket.id, layoutMap)) continue;
			const layout = layoutMap.get(ticket.id) ?? { colIndex: 0, colCount: 1, hiddenChildren: [], insetLevel: 0 };
			this.renderTimedBlock(col, ticket, day, layout);
		}

		this.view.dragDrop.setupDayDropZone(col, day, true);

		requestAnimationFrame(() => {
			if (this.view._savedScrollTop !== null) {
				scrollBody.scrollTop = this.view._savedScrollTop;
			} else {
				scrollBody.scrollTop = 8 * HOUR_HEIGHT - 20;
			}
		});
	}

	// ── Timed block (week view) ────────────────────────────────────────────────
	//
	// Segment types for multi-day blocks:
	//   'single' — startDate and dueDate on the same day (or no startDate)
	//   'start'  — this is the first day; block runs from startTime to bottom of column
	//   'middle' — intermediate day; block fills the entire column
	//   'end'    — this is the due day; block runs from top of column to dueTime

	private renderTimedBlock(col: HTMLElement, ticket: Ticket & { isGhost?: boolean; originalId?: string }, day: Date, layout: BlockLayout = { colIndex: 0, colCount: 1, hiddenChildren: [], insetLevel: 0 }): void {
		const store = this.view.plugin.store;
		const project = store.getProject(ticket.projectId);
		const key = project ? `${project.tag}-${ticket.ticketNumber}` : '';
		const ap = store.getCalendarCardAppearance()[this.view.viewMode];
		const isDoneTicket = store.getProjectStatuses(ticket.projectId).find(s => s.id === ticket.status)?.universalId === 'done';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const isGhost = (ticket as any).isGhost === true;

		const due = new Date(ticket.dueDate!);
		const dueMinutes = due.getHours() * 60 + due.getMinutes();
		const PX_PER_MIN = HOUR_HEIGHT / 60;
		const FULL_DAY_PX = 24 * 60 * PX_PER_MIN;

		// Determine segment type
		type Segment = 'single' | 'start' | 'middle' | 'end';
		let segment: Segment;
		let topPx: number;
		let heightPx: number;

		if (ticket.startDate === undefined) {
			// No start → 1-hour chip ending at due time
			segment = 'single';
			const startMinutes = Math.max(0, dueMinutes - 60);
			topPx    = startMinutes * PX_PER_MIN;
			heightPx = 60 * PX_PER_MIN;
		} else {
			const startDate = new Date(ticket.startDate);
			const startOnThisDay = isSameDay(startDate, day);
			const dueOnThisDay   = isSameDay(due, day);

			if (startOnThisDay && dueOnThisDay) {
				// Same-day duration block
				segment = 'single';
				const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
				topPx    = startMinutes * PX_PER_MIN;
				heightPx = Math.max(30 * PX_PER_MIN, (dueMinutes - startMinutes) * PX_PER_MIN);
			} else if (startOnThisDay) {
				// First day of a multi-day block
				segment = 'start';
				const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
				topPx    = startMinutes * PX_PER_MIN;
				heightPx = FULL_DAY_PX - topPx;
			} else if (dueOnThisDay) {
				// Last day of a multi-day block
				segment = 'end';
				topPx    = 0;
				heightPx = Math.max(30 * PX_PER_MIN, dueMinutes * PX_PER_MIN);
			} else {
				// Intermediate day — fill entire column
				segment = 'middle';
				topPx    = 0;
				heightPx = FULL_DAY_PX;
			}
		}

		const hasChildren = layout.hiddenChildren.length > 0;
		const isInset = (layout.insetLevel ?? 0) > 0;
		const cls = [
			'pf-cal-block',
			`pf-cal-block-${segment}`,
			ap.priorityEdge ? `pf-priority-edge-${ticket.priority}` : '',
			`pf-type-block-${ticket.type}`,
			hasChildren ? 'pf-cal-block-parent' : '',
			isGhost ? 'pf-cal-block-ghost' : '',
			isInset ? 'pf-cal-block-inset' : '',
		].filter(Boolean).join(' ');

		const block = col.createEl('div', {
			cls,
			attr: { 'data-id': ticket.id, draggable: 'true' },
		});
		block.style.top    = `${topPx}px`;
		block.style.height = `${heightPx}px`;
		// Priority left-border takes precedence — do not override with project color

		// Column-split positioning for unrelated overlaps; inset children offset inward
		if (isInset) {
			const INSET_PX = 12;
			if (layout.colCount > 1) {
				const pct = 100 / layout.colCount;
				block.style.left  = `calc(${layout.colIndex * pct}% + ${INSET_PX}px)`;
				block.style.right = 'auto';
				block.style.width = `calc(${pct}% - ${INSET_PX + 3}px)`;
			} else {
				block.style.left  = `${INSET_PX}px`;
				block.style.right = '3px';
				block.style.width = '';
			}
		} else if (layout.colCount > 1) {
			const pct = 100 / layout.colCount;
			block.style.left  = `calc(${layout.colIndex * pct}% + 3px)`;
			block.style.right = 'auto';
			block.style.width = `calc(${pct}% - 6px)`;
		}

		// Row 1: done tick (left) + type badge + time range (right)
		const row1 = block.createEl('div', { cls: 'pf-cal-block-row1' });
		if (isDoneTicket) row1.createEl('span', { cls: 'pf-cal-done-tick', text: '✓' });
		if (ap.typeBadge) row1.createEl('span', { cls: `pf-cal-chip-type pf-type-badge-${ticket.type}`, text: ticket.type.charAt(0).toUpperCase() });
		const fmtT = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
		let timeRangeLabel = '';
		if (segment === 'single') {
			const startMs = ticket.startDate !== undefined ? ticket.startDate : ticket.dueDate! - 60 * 60000;
			timeRangeLabel = `${fmtT(startMs)} – ${fmtT(ticket.dueDate!)}`;
		} else if (segment === 'start' && ticket.startDate !== undefined) {
			timeRangeLabel = `${fmtT(ticket.startDate)} →`;
		} else if (segment === 'end') {
			timeRangeLabel = `→ ${fmtT(ticket.dueDate!)}`;
		}
		if (ap.timeDisplay && timeRangeLabel) row1.createEl('span', { cls: 'pf-cal-block-timerange', text: timeRangeLabel });

		// Row 2: title
		block.createEl('div', { cls: 'pf-cal-block-title', text: ticket.title });

		// Child badge: shows +N and toggles expanded children
		if (hasChildren) {
			const badge = block.createEl('div', {
				cls: 'pf-cal-child-badge',
				text: `+${layout.hiddenChildren.length}`,
				attr: { title: `${layout.hiddenChildren.length} subtask(s) — click to expand` },
			});
			badge.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.view.expandedParentIds.has(ticket.id)) {
					this.view.expandedParentIds.delete(ticket.id);
				} else {
					this.view.expandedParentIds.add(ticket.id);
				}
				this.view.render();
			});
		}

		// Resize handles — only on single-day blocks, not ghost/multi-day
		if (segment === 'single' && !isGhost) {
			const topHandle = block.createEl('div', { cls: 'pf-cal-resize-top' });
			const botHandle = block.createEl('div', { cls: 'pf-cal-resize-bottom' });
			// Stop click from bubbling to block's click handler (click fires before document mouseup)
			topHandle.addEventListener('click', (e) => e.stopPropagation());
			botHandle.addEventListener('click', (e) => e.stopPropagation());
			this.view.dragDrop.setupBlockResize(block, topHandle, 'top', ticket as Ticket, day, col);
			this.view.dragDrop.setupBlockResize(block, botHandle, 'bottom', ticket as Ticket, day, col);
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const openTicketForBlock = isGhost
			? (store.getTicket((ticket as any).originalId) ?? ticket)
			: ticket;
		block.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.view.dragJustEnded) return; // drag guard — suppress accidental click after drag/resize
			new TicketModal(this.view.app, this.view.plugin, { ticket: openTicketForBlock as Ticket, sprintId: openTicketForBlock.sprintId }, () => this.view.render()).open();
		});
		block.addEventListener('dragstart', (e) => {
			if (isGhost) { e.preventDefault(); return; }
			this.view.draggedTicketId = ticket.id;
			// Store duration for ghost preview sizing
			this.view.draggedTicketDuration = ticket.startDate !== undefined
				? Math.max(30, Math.round((ticket.dueDate! - ticket.startDate) / 60000))
				: 60;
			block.addClass('pf-dragging');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		block.addEventListener('dragend', () => {
			block.removeClass('pf-dragging');
			this.view.contentEl.querySelectorAll('.pf-cal-drop-target').forEach(el => el.removeClass('pf-cal-drop-target'));
			this.view.contentEl.querySelectorAll('.pf-cal-drag-ghost').forEach(el => el.remove());
			this.view.draggedTicketId = null;
			// Drag guard: suppress click for 300ms
			this.view.dragJustEnded = true;
			window.setTimeout(() => { this.view.dragJustEnded = false; }, 300);
		});

	}

	// ── Now line ───────────────────────────────────────────────────────────────

	/**
	 * Appends a current-time indicator line to a today column and keeps it updated
	 * every minute until the view is closed (component unmounts on next render).
	 */
	private renderNowLine(col: HTMLElement): void {
		const line = col.createEl('div', { cls: 'pf-cal-now-line' });

		const position = () => {
			const now = new Date();
			const minutes = now.getHours() * 60 + now.getMinutes();
			line.style.top = `${minutes * (HOUR_HEIGHT / 60)}px`;
		};

		position();

		// Update every minute; stop if the element is removed from the DOM
		const interval = window.setInterval(() => {
			if (!col.isConnected) { clearInterval(interval); return; }
			position();
		}, 60_000);

	}
}
