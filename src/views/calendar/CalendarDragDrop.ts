import type { CalendarView } from './CalendarView';
import type { Ticket } from '../../types';
import { generateTicketNote } from '../../ticketNote';
import { HOUR_HEIGHT, hasTime, dateOnlyMs } from './CalendarUtils';

export class CalendarDragDrop {
	constructor(private view: CalendarView) {}

	// ── Day drop zone ──────────────────────────────────────────────────────────

	setupDayDropZone(cell: HTMLElement, day: Date, isTimeGrid = false, isAllDayRow = false): void {
		cell.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (!this.view.draggedTicketId) return;
			cell.addClass('pf-cal-drop-target');
			// Show ghost block preview in time-grid columns
			if (isTimeGrid) {
				const PX_PER_MIN = HOUR_HEIGHT / 60;
				const rect = cell.getBoundingClientRect();
				const yInCol = e.clientY - rect.top;
				const rawMinutes = yInCol / PX_PER_MIN;
				// snappedMinutes = the FINISH time (dueDate) that will be set on drop
				const snappedMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.round(rawMinutes / 15) * 15));
				const durationPx = Math.max(15 * PX_PER_MIN, this.view.draggedTicketDuration * PX_PER_MIN);
				// Ghost top = finish position minus duration = start position (matching render)
				const finishY = snappedMinutes * PX_PER_MIN;
				const ghostTop = Math.max(0, finishY - durationPx);
				// Start time label shown to user (not finish time)
				const startMinutes = Math.round(ghostTop / PX_PER_MIN / 15) * 15;
				const hh = String(Math.floor(startMinutes / 60)).padStart(2, '0');
				const mm = String(startMinutes % 60).padStart(2, '0');
				let ghost = cell.querySelector('.pf-cal-drag-ghost') as HTMLElement | null;
				if (!ghost) {
					ghost = document.createElement('div');
					ghost.className = 'pf-cal-drag-ghost';
					const draggedTicket = this.view.plugin.store.getTicket(this.view.draggedTicketId);
					if (draggedTicket) {
						const proj = this.view.plugin.store.getProject(draggedTicket.projectId);
						const key = proj ? `${proj.tag}-${draggedTicket.ticketNumber}` : '';
						ghost.classList.add(`pf-priority-edge-${draggedTicket.priority}`);
						const timeEl = document.createElement('div');
						timeEl.className = 'pf-cal-ghost-time';
						timeEl.textContent = `${hh}:${mm}`;
						const keyEl = document.createElement('div');
						keyEl.className = 'pf-cal-ghost-key';
						keyEl.textContent = key;
						const titleEl = document.createElement('div');
						titleEl.className = 'pf-cal-ghost-title';
						titleEl.textContent = draggedTicket.title;
						ghost.appendChild(timeEl);
						ghost.appendChild(keyEl);
						ghost.appendChild(titleEl);
					}
					cell.appendChild(ghost);
				} else {
					// Update start time label
					const timeEl = ghost.querySelector('.pf-cal-ghost-time') as HTMLElement | null;
					if (timeEl) timeEl.textContent = `${hh}:${mm}`;
				}
				ghost.style.top    = `${ghostTop}px`;
				ghost.style.height = `${durationPx}px`;
				// Auto-scroll near edges
				const scrollBody = cell.closest('.pf-cal-timebody') as HTMLElement | null;
				if (scrollBody) this.startAutoScroll(scrollBody, e.clientY);
			}
		});
		cell.addEventListener('dragleave', (e) => {
			if (!cell.contains(e.relatedTarget as Node)) {
				cell.removeClass('pf-cal-drop-target');
				cell.querySelector('.pf-cal-drag-ghost')?.remove();
				this.stopAutoScroll();
			}
		});
		cell.addEventListener('drop', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			cell.removeClass('pf-cal-drop-target');
			cell.querySelector('.pf-cal-drag-ghost')?.remove();
			this.stopAutoScroll();
			if (!this.view.draggedTicketId) return;
			const ticketId = this.view.draggedTicketId;
			this.view.draggedTicketId = null;
			const existing = this.view.plugin.store.getTicket(ticketId);
			let newDueDate: number;
			if (isTimeGrid) {
				// Calculate time from drop Y position, snapped to 15-min grid
				const PX_PER_MIN = HOUR_HEIGHT / 60;
				const rect = cell.getBoundingClientRect();
				const yInCol = e.clientY - rect.top;
				const rawMinutes = yInCol / PX_PER_MIN;
				const snappedMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.round(rawMinutes / 15) * 15));
				const hours = Math.floor(snappedMinutes / 60);
				const mins = snappedMinutes % 60;
				newDueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, mins).getTime();
			} else if (isAllDayRow) {
				// All-day row drop: strip time, use midnight of the column's day
				newDueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
			} else if (existing?.dueDate !== undefined && hasTime(existing.dueDate)) {
				// Month cell drop: keep existing time, just move the date
				const old = new Date(existing.dueDate);
				newDueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes()).getTime();
			} else {
				newDueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
			}
			// Also shift startDate if it exists (preserve duration); set it if missing
			const updates: { dueDate?: number; startDate?: number } = { dueDate: newDueDate };
			if (isAllDayRow) {
				// All-day row: startDate = same midnight (just a date, no time)
				updates.startDate = newDueDate;
			} else if (existing?.startDate !== undefined) {
				const dayDiff = newDueDate - (existing.dueDate ?? newDueDate);
				updates.startDate = existing.startDate + dayDiff;
			} else if (isTimeGrid) {
				// All-day ticket dropped into time grid: give it a 30-minute window
				updates.startDate = newDueDate - 30 * 60 * 1000;
			} else {
				updates.startDate = newDueDate;
			}
			await this.view.plugin.store.updateTicket(ticketId, updates);
			generateTicketNote(this.view.plugin, ticketId).catch(() => { /* silent */ });
			// Preserve scroll position across render
			const scrollEl = this.view.contentEl.querySelector('.pf-cal-timebody') as HTMLElement | null;
			if (scrollEl) this.view._savedScrollTop = scrollEl.scrollTop;
			this.stopAutoScroll();
			this.view.render();
			this.view.plugin.refreshAllViews();
		});
	}

	// ── Auto-scroll ────────────────────────────────────────────────────────────

	startAutoScroll(scrollBody: HTMLElement, clientY: number): void {
		const rect = scrollBody.getBoundingClientRect();
		const EDGE_ZONE = 60;
		const SCROLL_SPEED = 8;
		let direction = 0;
		if (clientY < rect.top + EDGE_ZONE) direction = -1;
		else if (clientY > rect.bottom - EDGE_ZONE) direction = 1;
		else { this.stopAutoScroll(); return; }
		if (this.view._autoScrollInterval !== null) return;
		this.view._autoScrollInterval = window.setInterval(() => {
			scrollBody.scrollTop += direction * SCROLL_SPEED;
		}, 16);
	}

	stopAutoScroll(): void {
		if (this.view._autoScrollInterval !== null) {
			clearInterval(this.view._autoScrollInterval);
			this.view._autoScrollInterval = null;
		}
	}

	// ── Block resize ───────────────────────────────────────────────────────────

	setupBlockResize(
		block: HTMLElement,
		handle: HTMLElement,
		edge: 'top' | 'bottom',
		ticket: Ticket,
		day: Date,
		_col: HTMLElement,
	): void {
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();

			const PX_PER_MIN = HOUR_HEIGHT / 60;
			const FULL_DAY_PX = 24 * 60 * PX_PER_MIN;
			const MIN_HEIGHT_PX = 15 * PX_PER_MIN; // 15-minute minimum

			const startY = e.clientY;
			const originalTop    = parseFloat(block.style.top)    || 0;
			const originalHeight = parseFloat(block.style.height) || MIN_HEIGHT_PX;

			block.addClass('pf-resizing');

			// Tooltip showing snapped time
			const tooltip = document.createElement('div');
			tooltip.className = 'pf-cal-resize-tooltip';
			block.appendChild(tooltip);

			const snapMinutes = (px: number) =>
				Math.max(0, Math.min(24 * 60, Math.round((px / PX_PER_MIN) / 15) * 15));

			const formatMins = (totalMins: number) => {
				const h = String(Math.floor(totalMins / 60)).padStart(2, '0');
				const m = String(totalMins % 60).padStart(2, '0');
				return `${h}:${m}`;
			};

			const scrollBody = _col.closest('.pf-cal-timebody') as HTMLElement | null;

			const onMouseMove = (ev: MouseEvent) => {
				if (scrollBody) this.startAutoScroll(scrollBody, ev.clientY);
				const deltaY = ev.clientY - startY;
				if (edge === 'top') {
					const rawTop = originalTop + deltaY;
					const snappedTopMins = snapMinutes(rawTop);
					const newTopPx = snappedTopMins * PX_PER_MIN;
					const newHeight = originalHeight - (newTopPx - originalTop);
					if (newHeight < MIN_HEIGHT_PX || newTopPx < 0) return;
					block.style.top    = `${newTopPx}px`;
					block.style.height = `${newHeight}px`;
					tooltip.textContent = formatMins(snappedTopMins);
					tooltip.style.top = '2px';
				} else {
					const rawBot = originalTop + originalHeight + deltaY;
					const snappedBotMins = snapMinutes(rawBot);
					const newHeight = snappedBotMins * PX_PER_MIN - originalTop;
					if (newHeight < MIN_HEIGHT_PX || originalTop + newHeight > FULL_DAY_PX) return;
					block.style.height = `${newHeight}px`;
					tooltip.textContent = formatMins(snappedBotMins);
					tooltip.style.bottom = '2px';
					tooltip.style.top = 'auto';
				}
			};

			const onMouseUp = async () => {
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
				block.removeClass('pf-resizing');
				tooltip.remove();

				// Derive final times from rendered position
				const finalTopPx    = parseFloat(block.style.top)    || 0;
				const finalHeight   = parseFloat(block.style.height) || MIN_HEIGHT_PX;
				const startMins = snapMinutes(finalTopPx);
				const endMins   = snapMinutes(finalTopPx + finalHeight);

				const newStartDate = new Date(
					day.getFullYear(), day.getMonth(), day.getDate(),
					Math.floor(startMins / 60), startMins % 60,
				).getTime();
				const newDueDate = new Date(
					day.getFullYear(), day.getMonth(), day.getDate(),
					Math.floor(endMins / 60), endMins % 60,
				).getTime();

				await this.view.plugin.store.updateTicket(ticket.id, {
					startDate: newStartDate,
					dueDate:   newDueDate,
				});
				generateTicketNote(this.view.plugin, ticket.id).catch(() => {});
				// Preserve scroll + drag guard
				const scrollEl2 = this.view.contentEl.querySelector('.pf-cal-timebody') as HTMLElement | null;
				if (scrollEl2) this.view._savedScrollTop = scrollEl2.scrollTop;
				this.view.dragJustEnded = true;
				window.setTimeout(() => { this.view.dragJustEnded = false; }, 300);
				this.stopAutoScroll();
				this.view.render();
				this.view.plugin.refreshAllViews();
			};

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}

	// ── Multi-day bar edge resize (month view) ──────────────────────────────────

	setupBarResize(
		bar: HTMLElement,
		handle: HTMLElement,
		edge: 'left' | 'right',
		ticket: Ticket,
		weekStartMs: number,
		weekEndMs: number,
		cellsRow: HTMLElement,
	): void {
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();

			bar.addClass('pf-bar-resizing');

			const tooltip = bar.createEl('div', { cls: 'pf-cal-bar-resize-tooltip' });

			const rowRect = cellsRow.getBoundingClientRect();
			const colWidth = rowRect.width / 7;

			// Column indices at mousedown
			const origStartCol = Math.round((Math.max(dateOnlyMs(new Date(ticket.startDate!)), weekStartMs) - weekStartMs) / 86400000);
			const origEndCol   = Math.round((Math.min(dateOnlyMs(new Date(ticket.dueDate!)),   weekEndMs)   - weekStartMs) / 86400000);

			let curStartCol = origStartCol;
			let curEndCol   = origEndCol;

			const colToMs  = (col: number) => weekStartMs + col * 86400000;
			const fmtDate  = (ms: number) => new Date(ms).toLocaleDateString('default', { month: 'short', day: 'numeric' });

			const onMouseMove = (ev: MouseEvent) => {
				const relX = ev.clientX - rowRect.left;
				const col  = Math.max(0, Math.min(6, Math.floor(relX / colWidth)));
				if (edge === 'left') {
					if (col >= curEndCol) return;
					curStartCol = col;
					bar.style.left  = `calc(${(curStartCol / 7 * 100).toFixed(4)}% + 1px)`;
					bar.style.width = `calc(${((curEndCol - curStartCol + 1) / 7 * 100).toFixed(4)}% - 4px)`;
					tooltip.textContent = fmtDate(colToMs(curStartCol));
				} else {
					if (col <= curStartCol) return;
					curEndCol = col;
					bar.style.width = `calc(${((curEndCol - curStartCol + 1) / 7 * 100).toFixed(4)}% - 4px)`;
					tooltip.textContent = fmtDate(colToMs(curEndCol));
				}
			};

			const onMouseUp = async () => {
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
				bar.removeClass('pf-bar-resizing');
				tooltip.remove();
				this.view.dragJustEnded = true;
				window.setTimeout(() => { this.view.dragJustEnded = false; }, 300);

				let newStartDate = ticket.startDate!;
				let newDueDate   = ticket.dueDate!;
				if (edge === 'left'  && dateOnlyMs(new Date(ticket.startDate!)) >= weekStartMs) {
					newStartDate = colToMs(curStartCol);
				}
				if (edge === 'right' && dateOnlyMs(new Date(ticket.dueDate!)) <= weekEndMs) {
					newDueDate = colToMs(curEndCol);
				}
				if (newStartDate >= newDueDate) return;

				await this.view.plugin.store.updateTicket(ticket.id, { startDate: newStartDate, dueDate: newDueDate });
				generateTicketNote(this.view.plugin, ticket.id).catch(() => {});
				this.view.render();
				this.view.plugin.refreshAllViews();
			};

			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}
}
