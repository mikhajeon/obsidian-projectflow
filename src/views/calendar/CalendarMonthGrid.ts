import type { CalendarView } from './CalendarView';
import type { Ticket, Sprint } from '../../types';
import { TicketModal } from '../../modals/TicketModal';
import {
	WEEKDAY_LABELS,
	dateOnlyMs,
	isSameDay,
	getMonthWeeks,
} from './CalendarUtils';

export class CalendarMonthGrid {
	constructor(private view: CalendarView) {}

	// ── Month grid ─────────────────────────────────────────────────────────────
	//
	// Multi-day tickets (startDate on a different calendar day than dueDate)
	// render as horizontal bars spanning the columns they occupy within each
	// week row. Single-day tickets render as chips inside the day cell.
	// Week rows are separate divs so bars can span via percentage widths.

	render(container: HTMLElement, tickets: Ticket[], sprints: Sprint[]): void {
		const year  = this.view.currentDate.getFullYear();
		const month = this.view.currentDate.getMonth();
		const weeks = getMonthWeeks(year, month);
		const today = new Date();

		// Split into multi-day vs single-day tickets
		const multiDay = tickets.filter(t =>
			t.dueDate !== undefined &&
			t.startDate !== undefined &&
			dateOnlyMs(new Date(t.startDate)) < dateOnlyMs(new Date(t.dueDate!))
		);
		const singleDay = tickets.filter(t => !multiDay.includes(t));

		// Weekday header (sticky)
		const headerRow = container.createEl('div', { cls: 'pf-cal-weekday-row' });
		for (const label of WEEKDAY_LABELS) {
			headerRow.createEl('div', { cls: 'pf-cal-weekday-cell', text: label });
		}

		// One week-row per week
		for (const week of weeks) {
			const weekRow = container.createEl('div', { cls: 'pf-cal-week-row' });

			const weekStartMs = dateOnlyMs(week[0]);
			const weekEndMs   = dateOnlyMs(week[6]);

			// Gather overlapping multi-day tickets and assign vertical lanes
			// so overlapping bars don't stack on top of each other.
			const overlapping = multiDay.filter(t => {
				const s = dateOnlyMs(new Date(t.startDate!));
				const e = dateOnlyMs(new Date(t.dueDate!));
				return s <= weekEndMs && e >= weekStartMs;
			});

			// Simple lane assignment: greedy, first fit
			const lanes: number[] = overlapping.map(() => -1);
			const laneEnds: number[] = [];
			for (let i = 0; i < overlapping.length; i++) {
				const s = Math.max(dateOnlyMs(new Date(overlapping[i].startDate!)), weekStartMs);
				let lane = laneEnds.findIndex(endMs => endMs < s);
				if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
				laneEnds[lane] = Math.min(dateOnlyMs(new Date(overlapping[i].dueDate!)), weekEndMs);
				lanes[i] = lane;
			}

			// ── Day cells row ─────────────────────────────────────────────
			const cellsRow = weekRow.createEl('div', { cls: 'pf-cal-week-cells' });
			// Each bar lane is 20px (18px bar + 2px gap). Reserve space below day-num.
			const BAR_TOP = 22; // px from top of cellsRow (clears sprint bar + day number)
			const BAR_H   = 20; // px per lane

			// Compute the highest lane index that crosses each column (0–6).
			// Columns with no bar crossing get -1 → no margin needed.
			const maxLanePerCol = new Array(7).fill(-1);
			for (let i = 0; i < overlapping.length; i++) {
				const cs = Math.max(dateOnlyMs(new Date(overlapping[i].startDate!)), weekStartMs);
				const ce = Math.min(dateOnlyMs(new Date(overlapping[i].dueDate!)),   weekEndMs);
				const c0 = Math.round((cs - weekStartMs) / 86400000);
				const c1 = Math.round((ce - weekStartMs) / 86400000);
				for (let col = c0; col <= c1; col++) {
					maxLanePerCol[col] = Math.max(maxLanePerCol[col], lanes[i]);
				}
			}

			const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			let colIndex = 0;
			for (const day of week) {
				const isCurrentMonth = day.getMonth() === month;
				const isToday = isSameDay(day, today);
				const isPast = !isToday && day < startOfToday;
				const cls = ['pf-cal-day',
					isCurrentMonth ? '' : 'pf-cal-outside',
					isToday ? 'pf-cal-today' : '',
					isPast ? 'pf-cal-past' : '',
				].filter(Boolean).join(' ');
				const cell = cellsRow.createEl('div', { cls });

				if (this.view.showSprints) this.renderSprintBars(cell, day, sprints);
				cell.createEl('span', { cls: 'pf-cal-day-num', text: String(day.getDate()) });

				// ── Single-day chips ──────────────────────────────────────
				const dayTickets = singleDay
					.filter(t => t.dueDate !== undefined && isSameDay(new Date(t.dueDate!), day))
					.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));

				const chipContainer = cell.createEl('div', { cls: 'pf-cal-day-tickets' });
				// Only push chips down in columns where a bar actually crosses this day
				const lanesHere = maxLanePerCol[colIndex];
				if (lanesHere >= 0) chipContainer.style.marginTop = `${(lanesHere + 1) * BAR_H}px`;
				const MAX_VISIBLE = 3;
				for (const ticket of dayTickets.slice(0, MAX_VISIBLE)) {
					this.view.renderTicketChip(chipContainer, ticket);
				}
				if (dayTickets.length > MAX_VISIBLE) {
					const more = chipContainer.createEl('div', {
						cls: 'pf-cal-overflow',
						text: `+${dayTickets.length - MAX_VISIBLE} more`,
					});
					more.addEventListener('click', (e) => {
						e.stopPropagation();
						more.remove();
						for (const ticket of dayTickets.slice(MAX_VISIBLE)) this.view.renderTicketChip(chipContainer, ticket);
					});
				}

				cell.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('.pf-cal-chip,.pf-cal-multiday-bar')) return;
					const pid = this.view.plugin.store.getActiveProjectId();
					if (!pid) return;
					const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
					new TicketModal(this.view.app, this.view.plugin, { projectId: pid, ...this.view.ticketCreateCtx(pid), dueDate, startDate: dueDate }, () => this.view.render()).open();
				});

				this.view.dragDrop.setupDayDropZone(cell, day);
				colIndex++;
			}

			// ── Absolutely-positioned multi-day bars on cellsRow ──────────
			for (let i = 0; i < overlapping.length; i++) {
				const ticket = overlapping[i];
				const project = this.view.plugin.store.getProject(ticket.projectId);
				const key = project ? `${project.tag}-${ticket.ticketNumber}` : '';
				const lane = lanes[i];
				const clampedStart = Math.max(dateOnlyMs(new Date(ticket.startDate!)), weekStartMs);
				const clampedEnd   = Math.min(dateOnlyMs(new Date(ticket.dueDate!)),   weekEndMs);
				const colStart = Math.round((clampedStart - weekStartMs) / 86400000);
				const colEnd   = Math.round((clampedEnd   - weekStartMs) / 86400000);
				const spanCols = colEnd - colStart + 1;
				const isFirstSeg = dateOnlyMs(new Date(ticket.startDate!)) >= weekStartMs;
				const isLastSeg  = dateOnlyMs(new Date(ticket.dueDate!))   <= weekEndMs;

				const bar = cellsRow.createEl('div', {
					cls: [
						'pf-cal-multiday-bar',
						`pf-priority-edge-${ticket.priority}`,
						`pf-type-block-${ticket.type}`,
						isFirstSeg ? 'pf-multiday-first' : 'pf-multiday-cont',
						isLastSeg  ? 'pf-multiday-last'  : '',
					].filter(Boolean).join(' '),
				});
				// Position relative to cellsRow (position:relative, 7-column grid)
				bar.style.left  = `calc(${(colStart / 7 * 100).toFixed(4)}% + 1px)`;
				bar.style.width = `calc(${(spanCols / 7 * 100).toFixed(4)}% - 4px)`;
				bar.style.top   = `${BAR_TOP + lane * BAR_H}px`;

				bar.createEl('span', { cls: 'pf-multiday-bar-key',   text: key });
				bar.createEl('span', { cls: 'pf-multiday-bar-title', text: ticket.title });
				bar.setAttribute('title', ticket.title);

				bar.addEventListener('click', (e) => {
					e.stopPropagation();
					if (this.view.dragJustEnded) return;
					new TicketModal(this.view.app, this.view.plugin, { ticket, sprintId: ticket.sprintId }, () => this.view.render()).open();
				});
				bar.setAttribute('draggable', 'true');
				bar.addEventListener('dragstart', (e) => {
					this.view.draggedTicketId = ticket.id;
					bar.addClass('pf-dragging');
					if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(bar, 0, 0); }
				});
				bar.addEventListener('dragend', () => {
					bar.removeClass('pf-dragging');
					this.view.contentEl.querySelectorAll('.pf-cal-drop-target').forEach(el => el.removeClass('pf-cal-drop-target'));
					this.view.draggedTicketId = null;
					this.view.dragJustEnded = true;
					window.setTimeout(() => { this.view.dragJustEnded = false; }, 300);
				});

				// Edge resize handles — left only on first segment, right only on last
				if (isFirstSeg) {
					const leftHandle = bar.createEl('div', { cls: 'pf-bar-resize-left' });
					this.view.dragDrop.setupBarResize(bar, leftHandle, 'left', ticket, weekStartMs, weekEndMs, cellsRow);
				}
				if (isLastSeg) {
					const rightHandle = bar.createEl('div', { cls: 'pf-bar-resize-right' });
					this.view.dragDrop.setupBarResize(bar, rightHandle, 'right', ticket, weekStartMs, weekEndMs, cellsRow);
				}
			}
		}
	}

	// ── Sprint bars helper ─────────────────────────────────────────────────────

	private renderSprintBars(cell: HTMLElement, day: Date, sprints: Sprint[]): void {
		const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
		const dayEnd   = dayStart + 86400000 - 1;
		const overlapping = sprints.filter(s => s.startDate <= dayEnd && s.endDate >= dayStart);
		for (const sprint of overlapping) {
			const bar = cell.createEl('div', { cls: `pf-cal-sprint-bar pf-cal-sprint-${sprint.status}` });
			bar.setAttribute('title', sprint.name);
		}
	}
}
