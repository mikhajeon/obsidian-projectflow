import { ItemView, WorkspaceLeaf, ViewStateResult, Notice, TFile, Setting, setIcon } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket, TicketPriority, TicketStatus, TicketType, TicketReminder, SnoozeInterval, Project } from '../types';
import { PRIORITY_ORDER } from '../types';
import { ticketFilePath, generateTicketNote, deleteTicketNote } from '../notes/ticketNote';
import { ConfirmModal } from '../modals/shared/ConfirmModal';

export const TICKET_NOTE_VIEW_TYPE = 'pf-ticket-note';

export class TicketNoteView extends ItemView {
	private plugin: ProjectFlowPlugin;
	private ticketId = '';

	constructor(leaf: WorkspaceLeaf, plugin: ProjectFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return TICKET_NOTE_VIEW_TYPE; }

	getDisplayText(): string {
		const ticket = this.plugin.store.getTicket(this.ticketId);
		if (ticket) return ticket.title;
		return 'Ticket';
	}

	getIcon() { return 'info'; }

	getState(): Record<string, unknown> {
		return { ticketId: this.ticketId };
	}

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		if (typeof state.ticketId === 'string') this.ticketId = state.ticketId;
		this.render();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		if (this.ticketId) this.render();
	}

	refresh(): void {
		this.render();
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-tnv-panel');

		const ticket = this.plugin.store.getTicket(this.ticketId);
		if (!ticket) {
			contentEl.createEl('p', { cls: 'pf-tnv-empty', text: 'No ticket selected.' });
			return;
		}
		const project = this.plugin.store.getProject(ticket.projectId);
		if (!project) return;

		// ── Header: key + editable title ──────────────────────────────────
		const header = contentEl.createDiv('pf-tnv-panel-header');
		header.createSpan({ cls: 'pf-tnv-key', text: `${project.tag}-${ticket.ticketNumber}` });

		const titleWrap = header.createDiv('pf-tnv-title-wrap');
		const titleEl = titleWrap.createEl('h2', { cls: 'pf-tnv-panel-title', text: ticket.title });
		const editIconEl = titleWrap.createSpan({ cls: 'pf-tnv-title-edit-icon' });
		setIcon(editIconEl, 'pencil');
		titleEl.contentEditable = 'true';
		titleEl.spellcheck = true;
		titleEl.title = 'Click to edit title';
		titleEl.addEventListener('focus', () => titleWrap.addClass('pf-tnv-title-editing'));
		titleEl.addEventListener('blur', async () => {
			titleWrap.removeClass('pf-tnv-title-editing');
			const newTitle = titleEl.textContent?.trim() || '';
			if (newTitle && newTitle !== ticket.title) {
				await this.plugin.store.updateTicket(ticket.id, { title: newTitle });
				await generateTicketNote(this.plugin, ticket.id);
				this.plugin.refreshAllViews();
			} else if (!newTitle) {
				titleEl.textContent = ticket.title; // revert if cleared
			}
		});
		titleEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
			if (e.key === 'Escape') { titleEl.textContent = ticket.title; titleEl.blur(); }
		});

		contentEl.createEl('hr', { cls: 'pf-tnv-divider' });

		this.renderProperties(contentEl, ticket, project);
	}

	// ── Properties ────────────────────────────────────────────────────────────

	private renderProperties(el: HTMLElement, ticket: Ticket, project: Project): void {
		const store    = this.plugin.store;
		const statuses = store.getProjectStatuses(project.id);
		const sprint   = ticket.sprintId ? store.getSprint(ticket.sprintId) : null;

		const save = async (fields: Partial<Ticket>) => {
			await store.updateTicket(ticket.id, fields);
			await generateTicketNote(this.plugin, ticket.id);
			this.plugin.refreshAllViews();
		};

		const propRow = (label: string) => {
			const row = el.createDiv('pf-tnv-prop');
			row.createDiv({ cls: 'pf-tnv-prop-key', text: label });
			return row.createDiv('pf-tnv-prop-val');
		};

		// ── Work type ─────────────────────────────────────────────
		// Rules: ticket with a parent must stay subtask; ticket with children can't become subtask
		const hasParent  = !!ticket.parentId;
		const hasChildren = store.getChildTickets(ticket.id).length > 0;
		const typeVal = propRow('Work type');
		if (hasParent) {
			// Subtask with a parent — locked
			typeVal.createSpan({ cls: 'pf-tnv-text', text: 'Subtask' });
			typeVal.createSpan({ cls: 'pf-tnv-muted', text: ' (remove parent to change)' });
		} else if (ticket.type === 'epic') {
			// Epics stay epics
			typeVal.createSpan({ cls: 'pf-tnv-text', text: 'Epic' });
		} else {
			// task / bug / story — switchable within the same level only
			const typeSel = typeVal.createEl('select', { cls: 'pf-tnv-select' });
			for (const [val, lbl] of [['task','Task'],['bug','Bug'],['story','Story']] as [string,string][]) {
				typeSel.createEl('option', { value: val, text: lbl }).selected = val === ticket.type;
			}
			typeSel.addEventListener('change', () => save({ type: typeSel.value as TicketType }));
		}

		// ── Priority ──────────────────────────────────────────────
		const prioritySel = propRow('Priority').createEl('select', { cls: 'pf-tnv-select' });
		for (const p of PRIORITY_ORDER) {
			prioritySel.createEl('option', { value: p, text: p[0].toUpperCase() + p.slice(1) })
				.selected = p === ticket.priority;
		}
		prioritySel.addEventListener('change', () => save({ priority: prioritySel.value as TicketPriority }));

		// ── Status ────────────────────────────────────────────────
		const statusSel = propRow('Status').createEl('select', { cls: 'pf-tnv-select' });
		for (const s of statuses) {
			statusSel.createEl('option', { value: s.id, text: s.label })
				.selected = s.id === ticket.status;
		}
		statusSel.addEventListener('change', () => save({ status: statusSel.value as TicketStatus }));

		// ── Points ────────────────────────────────────────────────
		const pointsInput = propRow('Story points').createEl('input', { cls: 'pf-tnv-input', type: 'number' });
		pointsInput.value = ticket.points !== undefined ? String(ticket.points) : '';
		pointsInput.min = '0';
		pointsInput.placeholder = '—';
		pointsInput.addEventListener('change', () => {
			const v = parseFloat(pointsInput.value);
			save({ points: isNaN(v) ? undefined : Math.max(0, v) });
		});

		// ── Sprint ────────────────────────────────────────────────
		propRow('Sprint').createSpan({ cls: 'pf-tnv-text', text: sprint?.name ?? 'Backlog' });

		// ── Date helpers ──────────────────────────────────────────
		const toDateStr = (ms?: number) => {
			if (!ms) return '';
			const d = new Date(ms);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		};
		const toTimeStr = (ms?: number) => {
			if (!ms) return '';
			const d = new Date(ms);
			const h = d.getHours(), m = d.getMinutes();
			return h === 0 && m === 0 ? '' : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		};
		const parseMs = (date: string, time: string): number | undefined => {
			if (!date) return undefined;
			const p = new Date(`${date}T${time || '00:00'}`).getTime();
			return isNaN(p) ? undefined : p;
		};

		// ── Start date ────────────────────────────────────────────
		const startVal = propRow('Start date');
		const startDate = startVal.createEl('input', { cls: 'pf-tnv-input', type: 'date' });
		const startTime = startVal.createEl('input', { cls: 'pf-tnv-input pf-tnv-time', type: 'time' });
		const clearStart = startVal.createEl('button', { cls: 'pf-tnv-clear-btn', text: '×' });
		startDate.value = toDateStr(ticket.startDate);
		startTime.value = toTimeStr(ticket.startDate);
		const onStartChange = () => save({ startDate: parseMs(startDate.value, startTime.value) });
		startDate.addEventListener('change', onStartChange);
		startTime.addEventListener('change', onStartChange);
		clearStart.addEventListener('click', () => {
			startDate.value = ''; startTime.value = '';
			save({ startDate: undefined });
		});

		// ── End date ──────────────────────────────────────────────
		const endVal = propRow('End date');
		const endDate = endVal.createEl('input', { cls: 'pf-tnv-input', type: 'date' });
		const endTime = endVal.createEl('input', { cls: 'pf-tnv-input pf-tnv-time', type: 'time' });
		const clearEnd = endVal.createEl('button', { cls: 'pf-tnv-clear-btn', text: '×' });
		endDate.value = toDateStr(ticket.endDate);
		endTime.value = toTimeStr(ticket.endDate);
		const onEndChange = () => save({ endDate: parseMs(endDate.value, endTime.value) });
		endDate.addEventListener('change', onEndChange);
		endTime.addEventListener('change', onEndChange);
		clearEnd.addEventListener('click', () => {
			endDate.value = ''; endTime.value = '';
			save({ endDate: undefined });
		});

		// ── Recurrence ────────────────────────────────────────────
		el.createDiv({ cls: 'pf-tnv-prop-key pf-tnv-section-head', text: 'Recurrence' });
		const recurWrap = el.createDiv('pf-tnv-recur-wrap');

		const recurSel = recurWrap.createEl('select', { cls: 'pf-tnv-select' });
		for (const [val, lbl] of [['none','None'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['custom','Custom']] as [string,string][]) {
			const opt = recurSel.createEl('option', { text: lbl, value: val });
			if ((ticket.recurrence?.rule ?? 'none') === val) opt.selected = true;
		}

		const recurIntervalWrap = recurWrap.createDiv('pf-tnv-recur-row');
		const recurIntervalInput = recurIntervalWrap.createEl('input', {
			cls: 'pf-tnv-input', type: 'number',
			attr: { min: '1', placeholder: 'N', title: 'Repeat every N' }
		});
		recurIntervalInput.style.width = '50px';
		if (ticket.recurrence?.interval) recurIntervalInput.value = String(ticket.recurrence.interval);
		recurIntervalWrap.createEl('span', { cls: 'pf-tnv-muted', text: 'interval' });

		const recurEndWrap = recurWrap.createDiv('pf-tnv-recur-row');
		recurEndWrap.createEl('span', { cls: 'pf-tnv-prop-key', text: 'Ends' });
		const recurEndInput = recurEndWrap.createEl('input', { cls: 'pf-tnv-input', type: 'date' });
		if (ticket.recurrence?.endDate) recurEndInput.value = new Date(ticket.recurrence.endDate).toISOString().split('T')[0];

		const toggleRecurInputs = (show: boolean) => {
			recurIntervalWrap.style.display = show ? '' : 'none';
			recurEndWrap.style.display = show ? '' : 'none';
		};
		toggleRecurInputs(!!ticket.recurrence);

		const saveRecur = () => {
			const rule = recurSel.value;
			if (rule === 'none') { save({ recurrence: undefined }); toggleRecurInputs(false); return; }
			toggleRecurInputs(true);
			const interval = Math.max(1, parseInt(recurIntervalInput.value) || 1);
			const endDate = recurEndInput.value ? new Date(recurEndInput.value).getTime() : undefined;
			save({ recurrence: { rule: rule as 'daily' | 'weekly' | 'monthly' | 'custom', interval, endDate } });
		};
		recurSel.addEventListener('change', saveRecur);
		recurIntervalInput.addEventListener('change', saveRecur);
		recurEndInput.addEventListener('change', saveRecur);

		// ── Reminders ─────────────────────────────────────────────
		el.createEl('hr', { cls: 'pf-tnv-divider' });
		new Setting(el).setName('Reminders').setHeading().settingEl.addClass('pf-tnv-setting-head');

		let reminders: TicketReminder[] = [...(ticket.reminders ?? [])];
		const saveReminders = () => save({ reminders: reminders.length > 0 ? reminders : undefined });
		const reminderRowsEl = el.createDiv('pf-tnv-reminder-rows');

		const renderReminderRows = () => {
			reminderRowsEl.empty();
			reminders.forEach((reminder, i) => {
				const row = reminderRowsEl.createDiv('pf-tnv-reminder-row');
				const isHours = reminder.offsetMinutes % 60 === 0 && reminder.offsetMinutes >= 60;
				const offsetInput = row.createEl('input', { cls: 'pf-tnv-input', type: 'number', attr: { min: '1' } });
				offsetInput.style.width = '48px';
				offsetInput.value = String(isHours ? reminder.offsetMinutes / 60 : reminder.offsetMinutes);
				const unitSel = row.createEl('select', { cls: 'pf-tnv-select pf-tnv-select-sm' });
				for (const [val, lbl] of [['minutes','min'],['hours','hr']] as [string,string][]) {
					const opt = unitSel.createEl('option', { value: val, text: lbl });
					if ((val === 'hours') === isHours) opt.selected = true;
				}
				const updateOffset = () => {
					const v = parseInt(offsetInput.value, 10);
					if (!isNaN(v) && v > 0) reminders[i].offsetMinutes = unitSel.value === 'hours' ? v * 60 : v;
					saveReminders();
				};
				offsetInput.addEventListener('change', updateOffset);
				unitSel.addEventListener('change', updateOffset);
				row.createEl('span', { cls: 'pf-tnv-muted', text: 'before' });
				const anchorSel = row.createEl('select', { cls: 'pf-tnv-select pf-tnv-select-sm' });
				for (const [val, lbl] of [['start','start'],['due','due']] as [string,string][]) {
					const opt = anchorSel.createEl('option', { value: val, text: lbl });
					if (val === reminder.anchor) opt.selected = true;
				}
				anchorSel.addEventListener('change', () => { reminders[i].anchor = anchorSel.value as 'start' | 'due'; saveReminders(); });
				const rmBtn = row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' });
				rmBtn.addEventListener('click', () => { reminders.splice(i, 1); renderReminderRows(); saveReminders(); });
			});
			el.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add reminder' })
				.addEventListener('click', () => {
					reminders.push({ id: Math.random().toString(36).slice(2), anchor: 'due', offsetMinutes: 15 });
					renderReminderRows();
					saveReminders();
				});
		};
		renderReminderRows();

		// ── Snooze intervals ──────────────────────────────────────
		el.createEl('hr', { cls: 'pf-tnv-divider' });
		new Setting(el).setName('Snooze intervals').setHeading().settingEl.addClass('pf-tnv-setting-head');

		let snoozeIntervals: SnoozeInterval[] = [...(ticket.snoozeIntervals ?? [])];
		const saveSnooze = () => save({ snoozeIntervals: snoozeIntervals.length > 0 ? snoozeIntervals : undefined });
		const snoozeRowsEl = el.createDiv('pf-tnv-snooze-rows');

		const renderSnoozeRows = () => {
			snoozeRowsEl.empty();
			snoozeIntervals.forEach((interval, i) => {
				const row = snoozeRowsEl.createDiv('pf-tnv-snooze-row');
				const labelIn = row.createEl('input', { cls: 'pf-tnv-input', type: 'text', attr: { placeholder: 'Label' } });
				labelIn.value = interval.label;
				labelIn.style.width = '80px';
				labelIn.addEventListener('change', () => { snoozeIntervals[i].label = labelIn.value; saveSnooze(); });
				const minIn = row.createEl('input', { cls: 'pf-tnv-input', type: 'number', attr: { min: '0', title: '0 = tomorrow' } });
				minIn.value = String(interval.minutes);
				minIn.style.width = '48px';
				minIn.addEventListener('change', () => {
					const v = parseInt(minIn.value, 10);
					if (!isNaN(v) && v >= 0) { snoozeIntervals[i].minutes = v; saveSnooze(); }
				});
				row.createEl('span', { cls: 'pf-tnv-muted', text: 'min' });
				const rmBtn = row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' });
				rmBtn.addEventListener('click', () => { snoozeIntervals.splice(i, 1); renderSnoozeRows(); saveSnooze(); });
			});
			snoozeRowsEl.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add snooze' })
				.addEventListener('click', () => { snoozeIntervals.push({ label: 'Custom', minutes: 60 }); renderSnoozeRows(); saveSnooze(); });
		};
		renderSnoozeRows();

		// ── Parent ────────────────────────────────────────────────
		if (ticket.parentId) {
			const parent = store.getTicket(ticket.parentId);
			if (parent) {
				el.createEl('hr', { cls: 'pf-tnv-divider' });
				const link = propRow('Parent').createEl('a', { cls: 'pf-tnv-link', text: parent.title });
				link.addEventListener('click', () => openTicketNoteView(this.plugin, parent.id));
			}
		}

		// ── Children ──────────────────────────────────────────────
		const children = store.getChildTickets(ticket.id);
		if (children.length > 0) {
			el.createEl('hr', { cls: 'pf-tnv-divider' });
			const childLabel = ticket.type === 'epic' ? 'Stories / Tasks' : 'Subtasks';
			propRow(childLabel);
			const childList = el.createDiv('pf-tnv-child-list');
			for (const child of children) {
				const row = childList.createDiv('pf-tnv-child-row');
				row.createSpan({ cls: 'pf-tnv-child-status', text: child.status });
				const link = row.createEl('a', { cls: 'pf-tnv-link', text: child.title });
				link.addEventListener('click', () => openTicketNoteView(this.plugin, child.id));
			}
		}

		// ── Timestamps ────────────────────────────────────────────
		el.createEl('hr', { cls: 'pf-tnv-divider' });
		const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit',
		});
		propRow('Created').createSpan({ cls: 'pf-tnv-text pf-tnv-muted', text: fmt(ticket.createdAt) });
		propRow('Updated').createSpan({ cls: 'pf-tnv-text pf-tnv-muted', text: fmt(ticket.updatedAt) });

		// ── Actions ───────────────────────────────────────────────
		el.createEl('hr', { cls: 'pf-tnv-divider' });
		const actionsEl = el.createDiv('pf-tnv-actions');

		const impacted = (id: string) =>
			store.getDescendantIds(id).map(d => store.getTicket(d)?.title ?? '').filter(Boolean);

		if (ticket.archived) {
			actionsEl.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Restore from archive' })
				.addEventListener('click', async () => {
					await store.unarchiveTicket(ticket.id);
					await generateTicketNote(this.plugin, ticket.id);
					this.plugin.refreshAllViews();
					this.render();
				});
		} else {
			actionsEl.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Archive' })
				.addEventListener('click', () => {
					new ConfirmModal(this.app, `Archive "${ticket.title}"? It will be hidden from active views and can be restored later.`, async () => {
						await store.archiveTicket(ticket.id);
						this.plugin.refreshAllViews();
						this.render();
					}, 'Archive', impacted(ticket.id)).open();
				});
		}

		actionsEl.createEl('button', { cls: 'pf-btn pf-btn-sm pf-btn-danger', text: 'Delete' })
			.addEventListener('click', () => {
				new ConfirmModal(this.app, `Delete "${ticket.title}"? This cannot be undone.`, async () => {
					await deleteTicketNote(this.plugin, ticket.id);
					await store.deleteTicket(ticket.id);
					this.plugin.refreshAllViews();
					this.render();
				}, 'Delete', impacted(ticket.id)).open();
			});
	}
}

// ── Open helper ───────────────────────────────────────────────────────────────

export function openTicketNoteView(plugin: ProjectFlowPlugin, ticketId: string): void {
	const ticket = plugin.store.getTicket(ticketId);
	if (!ticket) return;
	const project = plugin.store.getProject(ticket.projectId);
	if (!project) return;

	const filePath = ticketFilePath(plugin, project.name, ticket);
	const file = plugin.app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		new Notice('Note not found. Save the ticket to generate it.');
		return;
	}

	const workspace = plugin.app.workspace;

	// Open the ticket .md in Obsidian's native editor (full editor, all hotkeys)
	const mainLeaf = workspace.getLeaf(false);
	mainLeaf.openFile(file).then(() => {
		const noteContentEl = (mainLeaf.view as { contentEl?: HTMLElement }).contentEl;
		noteContentEl?.addClass('pf-ticket-note');
	}).catch(() => { /* silent */ });
	workspace.revealLeaf(mainLeaf);

	// Open/update the properties panel in the right sidebar
	const existing = workspace.getLeavesOfType(TICKET_NOTE_VIEW_TYPE)[0];
	if (existing) {
		existing.setViewState({ type: TICKET_NOTE_VIEW_TYPE, state: { ticketId }, active: false });
		workspace.revealLeaf(existing);
	} else {
		const rightLeaf = workspace.getRightLeaf(false);
		if (rightLeaf) {
			rightLeaf.setViewState({ type: TICKET_NOTE_VIEW_TYPE, state: { ticketId }, active: false });
			workspace.revealLeaf(rightLeaf);
		}
	}
}
