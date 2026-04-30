import { App, Modal, Setting, Notice, TFile } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket, TicketPriority, TicketStatus, TicketType, TicketReminder, SnoozeInterval } from '../types';
import { generateTicketNote, deleteTicketNote, ticketFilePath } from '../ticketNote';
import { ConfirmModal } from './ConfirmModal';

interface NewTicketContext {
	projectId: string;
	sprintId: string | null;
	status?: TicketStatus;
	parentId?: string;
	defaultType?: TicketType;
	showOnBoard?: boolean;
	dueDate?: number;
	startDate?: number;
}

interface EditTicketContext {
	ticket: Ticket;
	sprintId: string | null;
}

type TicketModalContext = NewTicketContext | EditTicketContext;

function isEditContext(ctx: TicketModalContext): ctx is EditTicketContext {
	return 'ticket' in ctx;
}

export class TicketModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private context: TicketModalContext;
	private onSave: () => void;

	private title = '';
	private description = '';
	private type: TicketType = 'task';
	private priority: TicketPriority = 'medium';
	private status: TicketStatus = 'todo';
	private points: number | undefined = undefined;
	private startDate: number | undefined = undefined;
	private dueDate: number | undefined = undefined;
	private recurrence: Ticket['recurrence'] = undefined;
	private reminders: TicketReminder[] = [];
	private snoozeIntervals: SnoozeInterval[] = [];

	private submitting = false;

	constructor(app: App, plugin: ProjectFlowPlugin, context: TicketModalContext, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.context = context;
		this.onSave = onSave;

		if (isEditContext(context)) {
			this.title = context.ticket.title;
			this.description = context.ticket.description;
			this.type = context.ticket.type;
			this.priority = context.ticket.priority;
			this.status = context.ticket.status;
			this.points = context.ticket.points;
			this.startDate = context.ticket.startDate;
			this.dueDate = context.ticket.dueDate;
			this.recurrence = context.ticket.recurrence;
			this.reminders = structuredClone(context.ticket.reminders ?? []);
			this.snoozeIntervals = structuredClone(context.ticket.snoozeIntervals ?? []);
		} else {
			if (context.status) this.status = context.status;
			if (context.defaultType) this.type = context.defaultType;
			if (context.dueDate) this.dueDate = context.dueDate;
			if (context.startDate) this.startDate = context.startDate;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		const isEdit = isEditContext(this.context);
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(900px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		// Sticky header: label + ticket key + title input + close button
		const header = contentEl.createEl('div', { cls: 'pf-modal-header' });
		header.createEl('span', { cls: 'pf-modal-label', text: isEdit ? 'Edit ticket' : 'New ticket' });
		if (isEdit) {
			const ticket = (this.context as EditTicketContext).ticket;
			const project = this.plugin.store.getProject(ticket.projectId);
			const key = project ? `${project.tag}-${ticket.ticketNumber}` : '';
			if (key) header.createEl('span', { cls: 'pf-modal-ticket-key', text: key });
		}
		const titleInput = header.createEl('input', {
			cls: 'pf-modal-title-input',
			attr: { type: 'text', placeholder: 'Ticket title' },
		});
		titleInput.value = this.title;
		titleInput.addEventListener('input', () => { this.title = titleInput.value; });
		setTimeout(() => titleInput.focus(), 50);
		const closeBtn = header.createEl('button', { cls: 'pf-modal-close', text: '\u00d7' });
		closeBtn.addEventListener('click', () => this.close());

		contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && e.ctrlKey) {
				e.preventDefault();
				this.submit();
			}
			if (e.key === 'Delete' && (e.ctrlKey || e.metaKey) && isEdit) {
				e.preventDefault();
				const ticketId = (this.context as EditTicketContext).ticket.id;
				const title = (this.context as EditTicketContext).ticket.title;
				new ConfirmModal(this.app, `Delete ticket "${title}"? This cannot be undone.`, async () => {
					await deleteTicketNote(this.plugin, ticketId).catch(() => { /* silent */ });
					await this.plugin.store.deleteTicket(ticketId);
					this.close();
					this.onSave();
					new Notice('Ticket deleted.');
				}).open();
			}
		});

		// Scrollable body between header and footer
		const body = contentEl.createEl('div', { cls: 'pf-modal-body' });

		// Always two-pane layout
		const panes = body.createEl('div', { cls: 'pf-ticket-panes' });
		const formPane = panes.createEl('div', { cls: 'pf-ticket-form-pane' });
		const infoPane = panes.createEl('div', { cls: 'pf-ticket-info-pane' });

		const descBlock = formPane.createEl('div', { cls: 'pf-desc-block' });
		const descLabelRow = descBlock.createEl('div', { cls: 'pf-desc-label-row' });
		descLabelRow.createEl('span', { cls: 'pf-desc-label', text: 'Notes' });

		if (isEdit) {
			const ticket = (this.context as EditTicketContext).ticket;
			const openBtn = descLabelRow.createEl('button', { cls: 'pf-btn-open-note', text: '↗ Open note' });
			openBtn.addEventListener('click', async () => {
				const project = this.plugin.store.getProject(ticket.projectId);
				if (!project) return;
				const filePath = ticketFilePath(this.plugin, project.name, ticket);
				const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					this.close();
					const leaf = this.plugin.app.workspace.getLeaf(false);
					await leaf.openFile(file);
				} else {
					new Notice('Note not found. Save the ticket first.');
				}
			});
		}

		const descTextarea = descBlock.createEl('textarea', { cls: 'pf-ticket-notes', placeholder: 'Add notes...' });
		descTextarea.value = this.description;
		descTextarea.addEventListener('input', () => { this.description = descTextarea.value; });

		// Compute which types are selectable.
		// Hierarchy: epic → story/task/bug → subtask
		// On edit: type is locked (epic stays epic, subtask stays subtask, story/task/bug are interchangeable).
		// On new: allowed types depend on parent's type.
		let allowedTypes: [TicketType, string][];
		if (isEditContext(this.context)) {
			const current = this.context.ticket.type;
			if (current === 'epic')    allowedTypes = [['epic',    'Epic']];
			else if (current === 'subtask') allowedTypes = [['subtask', 'Subtask']];
			else allowedTypes = [['story', 'Story'], ['task', 'Task'], ['bug', 'Bug']];
		} else {
			const ctx = this.context as NewTicketContext;
			const parentType = ctx.parentId
				? this.plugin.store.getTicket(ctx.parentId)?.type ?? null
				: null;
			if (parentType === 'epic')
				allowedTypes = [['story', 'Story'], ['task', 'Task'], ['bug', 'Bug']];
			else if (parentType === 'story' || parentType === 'task' || parentType === 'bug')
				allowedTypes = [['subtask', 'Subtask']];
			else allowedTypes = [['epic', 'Epic'], ['story', 'Story'], ['task', 'Task'], ['bug', 'Bug']];
		}

		// Default type to first allowed option if current default isn't in the list
		if (!allowedTypes.some(([t]) => t === this.type)) {
			this.type = allowedTypes[0][0];
		}

		// Type always goes on the right info pane
		const typeField = infoPane.createDiv('pf-field-stacked');
		typeField.createEl('label', { cls: 'pf-field-label', text: 'Work type' });
		const typeSel = typeField.createEl('select', { cls: 'pf-select' }) as HTMLSelectElement;
		for (const [val, label] of allowedTypes) {
			const opt = typeSel.createEl('option', { text: label, value: val });
			if (val === this.type) opt.selected = true;
		}
		typeSel.addEventListener('change', () => { this.type = typeSel.value as TicketType; });

		const priorityField = infoPane.createDiv('pf-field-stacked');
		priorityField.createEl('label', { cls: 'pf-field-label', text: 'Priority' });
		const prioritySel = priorityField.createEl('select', { cls: 'pf-select' }) as HTMLSelectElement;
		for (const [val, lbl] of [['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']] as [string,string][]) {
			const opt = prioritySel.createEl('option', { text: lbl, value: val });
			if (val === this.priority) opt.selected = true;
		}
		prioritySel.addEventListener('change', () => { this.priority = prioritySel.value as TicketPriority; });

		const statusField = infoPane.createDiv('pf-field-stacked');
		statusField.createEl('label', { cls: 'pf-field-label', text: 'Status' });
		const statusSel = statusField.createEl('select', { cls: 'pf-select' }) as HTMLSelectElement;
		const projId = isEditContext(this.context) ? this.context.ticket.projectId : (this.context as { projectId: string }).projectId;
		for (const st of this.plugin.store.getProjectStatuses(projId)) {
			const opt = statusSel.createEl('option', { text: st.label, value: st.id });
			if (st.id === this.status) opt.selected = true;
		}
		statusSel.addEventListener('change', () => { this.status = statusSel.value; });

		const pointsField = infoPane.createDiv('pf-field-stacked');
		pointsField.createEl('label', { cls: 'pf-field-label', text: 'Story points' });
		const pointsInput = pointsField.createEl('input', { cls: 'pf-input pf-input-points', attr: { type: 'number', min: '0', step: '1' } }) as HTMLInputElement;
		if (this.points !== undefined) pointsInput.value = String(this.points);
		pointsInput.addEventListener('input', () => {
			const raw = pointsInput.value.trim();
			this.points = raw === '' ? undefined : Math.max(0, Math.round(Number(raw)));
		});

		// ── Start date / time ───────────────────────────────────────────────────
		const startSection = infoPane.createEl('div', { cls: 'pf-date-section' });
		startSection.createEl('div', { cls: 'pf-field-label', text: 'Start date' });
		const startRow = startSection.createEl('div', { cls: 'pf-date-row' });
		const startDateInput = startRow.createEl('input', { cls: 'pf-input pf-input-date', attr: { type: 'date' } }) as HTMLInputElement;
		const startTimeInput = startRow.createEl('input', { cls: 'pf-input pf-input-time', attr: { type: 'time' } }) as HTMLInputElement;
		const clearStartBtn = startRow.createEl('button', { cls: 'pf-date-clear-btn', text: '× Clear' });

		if (this.startDate !== undefined) {
			const sd = new Date(this.startDate);
			startDateInput.value = sd.toISOString().split('T')[0];
			const sh = sd.getHours(), sm = sd.getMinutes();
			if (sh !== 0 || sm !== 0) startTimeInput.value = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
		}

		const syncStartDate = () => {
			if (!startDateInput.value) { this.startDate = undefined; return; }
			const [y, mo, d] = startDateInput.value.split('-').map(Number);
			const [h, mi] = startTimeInput.value ? startTimeInput.value.split(':').map(Number) : [0, 0];
			this.startDate = new Date(y, mo - 1, d, h, mi).getTime();
		};
		startDateInput.addEventListener('input', syncStartDate);
		startTimeInput.addEventListener('input', syncStartDate);
		clearStartBtn.addEventListener('click', () => {
			this.startDate = undefined;
			startDateInput.value = '';
			startTimeInput.value = '';
		});

		// ── End date / time ──────────────────────────────────────────────────
		const dueSection = infoPane.createEl('div', { cls: 'pf-date-section' });
		dueSection.createEl('div', { cls: 'pf-field-label', text: 'End date' });
		const dueRow = dueSection.createEl('div', { cls: 'pf-date-row' });
		const dueDateInput = dueRow.createEl('input', { cls: 'pf-input pf-input-date', attr: { type: 'date' } }) as HTMLInputElement;
		const dueTimeInput = dueRow.createEl('input', { cls: 'pf-input pf-input-time', attr: { type: 'time' } }) as HTMLInputElement;
		const clearDueBtn = dueRow.createEl('button', { cls: 'pf-date-clear-btn', text: '× Clear' });

		if (this.dueDate !== undefined) {
			const dd = new Date(this.dueDate);
			dueDateInput.value = dd.toISOString().split('T')[0];
			const dh = dd.getHours(), dm = dd.getMinutes();
			if (dh !== 0 || dm !== 0) dueTimeInput.value = `${String(dh).padStart(2,'0')}:${String(dm).padStart(2,'0')}`;
		}

		const syncDueDate = () => {
			if (!dueDateInput.value) { this.dueDate = undefined; return; }
			const [y, mo, d] = dueDateInput.value.split('-').map(Number);
			const [h, mi] = dueTimeInput.value ? dueTimeInput.value.split(':').map(Number) : [0, 0];
			this.dueDate = new Date(y, mo - 1, d, h, mi).getTime();
		};
		dueDateInput.addEventListener('input', syncDueDate);
		dueTimeInput.addEventListener('input', syncDueDate);
		clearDueBtn.addEventListener('click', () => {
			this.dueDate = undefined;
			dueDateInput.value = '';
			dueTimeInput.value = '';
		});

		// ── Recurrence ──────────────────────────────────────────────────────────
		const recurSection = infoPane.createEl('div', { cls: 'pf-date-section pf-recur-section' });
		recurSection.createEl('div', { cls: 'pf-field-label', text: 'Recurrence' });
		const recurRow = recurSection.createEl('div', { cls: 'pf-date-row' });
		const recurSel = recurRow.createEl('select', { cls: 'pf-select pf-select-sm' }) as HTMLSelectElement;
		for (const [val, lbl] of [['none','None'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['custom','Custom']] as [string,string][]) {
			const opt = recurSel.createEl('option', { text: lbl, value: val });
			if ((this.recurrence?.rule ?? 'none') === val) opt.selected = true;
		}
		const recurIntervalWrap = recurRow.createEl('div', { cls: 'pf-recur-interval-wrap' });
		const recurIntervalInput = recurIntervalWrap.createEl('input', { cls: 'pf-input pf-input-time', attr: { type: 'number', min: '1', placeholder: 'N', title: 'Repeat interval' } }) as HTMLInputElement;
		if (this.recurrence?.interval) recurIntervalInput.value = String(this.recurrence.interval);
		recurIntervalWrap.createEl('span', { cls: 'pf-recur-unit', text: 'interval' });
		recurIntervalWrap.style.display = this.recurrence ? '' : 'none';

		const recurEndWrap = recurSection.createEl('div', { cls: 'pf-recur-end-wrap' });
		recurEndWrap.createEl('span', { cls: 'pf-field-label', text: 'End date (optional)' });
		const recurEndInput = recurEndWrap.createEl('input', { cls: 'pf-input pf-input-date', attr: { type: 'date' } }) as HTMLInputElement;
		if (this.recurrence?.endDate) recurEndInput.value = new Date(this.recurrence.endDate).toISOString().split('T')[0];
		recurEndWrap.style.display = this.recurrence ? '' : 'none';

		const syncRecur = () => {
			const rule = recurSel.value;
			if (rule === 'none') {
				this.recurrence = undefined;
				recurIntervalWrap.style.display = 'none';
				recurEndWrap.style.display = 'none';
				return;
			}
			recurIntervalWrap.style.display = '';
			recurEndWrap.style.display = '';
			const interval = Math.max(1, parseInt(recurIntervalInput.value) || 1);
			let endDate: number | undefined;
			if (recurEndInput.value) endDate = new Date(recurEndInput.value).getTime();
			this.recurrence = { rule: rule as 'daily' | 'weekly' | 'monthly' | 'custom', interval, endDate };
		};
		recurSel.addEventListener('change', syncRecur);
		recurIntervalInput.addEventListener('input', syncRecur);
		recurEndInput.addEventListener('input', syncRecur);

		// ── Reminders ─────────────────────────────────────────────────────────
		infoPane.createEl('hr', { cls: 'pf-section-divider' });
		new Setting(infoPane).setName('Reminders').setHeading().settingEl.addClass('pf-reminders-heading');

		// Ticket-level snooze intervals
		const snoozeSection = infoPane.createDiv('pf-field-stacked');
		snoozeSection.createEl('label', { cls: 'pf-field-label', text: 'Snooze intervals for this ticket' });
		const snoozeRowsEl = snoozeSection.createDiv();

		const renderSnoozeRows = () => {
			snoozeRowsEl.empty();
			this.snoozeIntervals.forEach((interval, i) => {
				const row = snoozeRowsEl.createDiv('pf-notif-snooze-row');
				const labelIn = row.createEl('input', { type: 'text', cls: 'pf-input pf-notif-snooze-label' });
				labelIn.value = interval.label;
				labelIn.placeholder = 'Label';
				labelIn.addEventListener('input', () => { this.snoozeIntervals[i].label = labelIn.value; });
				const minIn = row.createEl('input', { type: 'number', cls: 'pf-input pf-input-short' });
				minIn.value = String(interval.minutes);
				minIn.min = '0';
				minIn.title = '0 = tomorrow (next midnight)';
				minIn.addEventListener('input', () => {
					const v = parseInt(minIn.value, 10);
					if (!isNaN(v) && v >= 0) this.snoozeIntervals[i].minutes = v;
				});
				row.createEl('span', { cls: 'pf-notif-snooze-unit', text: 'min' });
				const rmBtn = row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' });
				rmBtn.addEventListener('click', () => { this.snoozeIntervals.splice(i, 1); renderSnoozeRows(); });
			});
			snoozeRowsEl.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add snooze interval' })
				.addEventListener('click', () => { this.snoozeIntervals.push({ label: 'Custom', minutes: 60 }); renderSnoozeRows(); });
		};
		renderSnoozeRows();

		// Per-ticket reminders
		const remindersSection = infoPane.createDiv('pf-field-stacked');
		remindersSection.createEl('label', { cls: 'pf-field-label', text: 'Reminders' });
		const reminderRowsEl = remindersSection.createDiv();

		const renderReminderRows = () => {
			reminderRowsEl.empty();
			this.reminders.forEach((reminder, i) => {
				const row = reminderRowsEl.createDiv('pf-notif-reminder-row');

				const offsetVal = row.createEl('input', { type: 'number', cls: 'pf-input pf-input-short' });
				const isHours = reminder.offsetMinutes % 60 === 0 && reminder.offsetMinutes >= 60;
				offsetVal.value = String(isHours ? reminder.offsetMinutes / 60 : reminder.offsetMinutes);
				offsetVal.min = '1';

				const unitSel = row.createEl('select', { cls: 'pf-select' });
				[['minutes', 'min'], ['hours', 'hr']].forEach(([val, label]) => {
					const opt = unitSel.createEl('option', { value: val, text: label });
					if ((val === 'hours') === isHours) opt.selected = true;
				});

				const updateOffset = () => {
					const v = parseInt(offsetVal.value, 10);
					if (!isNaN(v) && v > 0) {
						this.reminders[i].offsetMinutes = unitSel.value === 'hours' ? v * 60 : v;
					}
				};
				offsetVal.addEventListener('input', updateOffset);
				unitSel.addEventListener('change', updateOffset);

				row.createEl('span', { cls: 'pf-notif-reminder-sep', text: 'before' });

				const anchorSel = row.createEl('select', { cls: 'pf-select' });
				[['start', 'start time'], ['due', 'due time']].forEach(([val, label]) => {
					const opt = anchorSel.createEl('option', { value: val, text: label });
					if (val === reminder.anchor) opt.selected = true;
				});
				anchorSel.addEventListener('change', () => {
					this.reminders[i].anchor = anchorSel.value as 'start' | 'due';
				});

				const rmBtn = row.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '✕' });
				rmBtn.addEventListener('click', () => { this.reminders.splice(i, 1); renderReminderRows(); });
			});

			reminderRowsEl.createEl('button', { cls: 'pf-btn pf-btn-sm', text: '+ Add reminder' })
				.addEventListener('click', () => {
					this.reminders.push({ id: Math.random().toString(36).slice(2), anchor: 'due', offsetMinutes: 15 });
					renderReminderRows();
				});
		};
		renderReminderRows();

		// Read-only details in info pane
		infoPane.createEl('div', { cls: 'pf-info-pane-heading', text: 'Details' });

		if (isEdit) {
			const ticket = (this.context as EditTicketContext).ticket;

			const rows: [string, string][] = [
				['ID', ticket.id],
				['Created', new Date(ticket.createdAt).toLocaleString()],
				['Updated', new Date(ticket.updatedAt).toLocaleString()],
			];

			if (ticket.parentId) {
				const parent = this.plugin.store.getTicket(ticket.parentId);
				rows.push(['Parent', parent ? parent.title : ticket.parentId]);
			}

			if (ticket.projectId) {
				const project = this.plugin.store.getProject(ticket.projectId);
				rows.push(['Project', project ? project.name : ticket.projectId]);
			}

			if (ticket.sprintId) {
				const sprint = this.plugin.store.getSprint(ticket.sprintId);
				rows.push(['Sprint', sprint ? sprint.name : ticket.sprintId]);
			}

			for (const [label, value] of rows) {
				const row = infoPane.createEl('div', { cls: 'pf-info-row' });
				row.createEl('span', { cls: 'pf-info-label', text: label });
				row.createEl('span', { cls: 'pf-info-value', text: value });
			}

			// Tags
			const projectName = this.plugin.store.getProject(ticket.projectId)?.name ?? '';
			const projectSlug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			const tags = [projectSlug, ticket.type, ticket.priority, ticket.status];
			const tagsRow = infoPane.createEl('div', { cls: 'pf-info-row pf-info-row-tags' });
			tagsRow.createEl('span', { cls: 'pf-info-label', text: 'Tags' });
			const tagsWrap = tagsRow.createEl('div', { cls: 'pf-info-tags' });
			for (const tag of tags) {
				tagsWrap.createEl('span', { cls: 'pf-info-tag', text: tag });
			}
		} else {
			// New ticket: show empty locked placeholder rows
			infoPane.addClass('pf-info-pane-empty');
			for (const label of ['ID', 'Created', 'Updated', 'Project', 'Tags']) {
				const row = infoPane.createEl('div', { cls: 'pf-info-row' });
				row.createEl('span', { cls: 'pf-info-label', text: label });
				row.createEl('span', { cls: 'pf-info-value pf-info-value-empty', text: '—' });
			}
		}

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });

		if (isEdit) {
			const ticket = (this.context as EditTicketContext).ticket;
			const isArchived = ticket.archived === true;

			if (isArchived) {
				footer.createEl('button', { cls: 'pf-btn', text: 'Restore from archive' })
					.addEventListener('click', async () => {
						await this.plugin.store.unarchiveTicket(ticket.id);
						this.close();
						this.onSave();
						new Notice('Ticket restored.');
						generateTicketNote(this.plugin, ticket.id).catch(() => { /* silent */ });
					});
			} else {
				footer.createEl('button', { cls: 'pf-btn', text: 'Archive' })
					.addEventListener('click', () => {
						new ConfirmModal(this.app, `Archive "${ticket.title}"? It will be hidden from active views and can be restored later.`, async () => {
							await this.plugin.store.archiveTicket(ticket.id);
							this.close();
							this.onSave();
							new Notice('Ticket archived.');
						}, 'Archive').open();
					});
			}

			footer.createEl('button', { cls: 'pf-btn pf-btn-danger', text: 'Delete' })
				.addEventListener('click', () => {
					const ticketId = (this.context as EditTicketContext).ticket.id;
					const title = (this.context as EditTicketContext).ticket.title;
					new ConfirmModal(this.app, `Delete ticket "${title}"? This cannot be undone.`, async () => {
						await deleteTicketNote(this.plugin, ticketId).catch(() => { /* silent */ });
						await this.plugin.store.deleteTicket(ticketId);
						this.close();
						this.onSave();
						new Notice('Ticket deleted.');
					}).open();
				});
		}

		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());

		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: isEdit ? 'Save' : 'Create' })
			.addEventListener('click', () => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (this.submitting) return;
		if (!this.title.trim()) {
			new Notice('Ticket title is required.');
			return;
		}
		const parentId = isEditContext(this.context)
			? this.context.ticket.parentId
			: (this.context as NewTicketContext).parentId;
		if (this.type === 'subtask' && !parentId) {
			new Notice('Subtasks must be placed under a story, task, or bug.');
			return;
		}
		this.submitting = true;

		try {
		if (isEditContext(this.context)) {
			const oldTitle = this.context.ticket.title;
			const newTitle = this.title.trim();
			const titleChanged = oldTitle !== newTitle;

			let oldFilePath: string | null = null;
			if (titleChanged) {
				const project = this.plugin.store.getProject(this.context.ticket.projectId);
				if (project) {
					oldFilePath = ticketFilePath(this.plugin, project.name, this.context.ticket);
				}
			}

			await this.plugin.store.updateTicket(this.context.ticket.id, {
				title: newTitle,
				description: this.description.trim(),
				type: this.type,
				priority: this.priority,
				status: this.status,
				sprintId: this.context.sprintId,
				points: this.points,
				startDate: this.startDate,
				dueDate: this.dueDate,
				recurrence: this.recurrence,
				reminders: this.reminders.length > 0 ? this.reminders : undefined,
				snoozeIntervals: this.snoozeIntervals.length > 0 ? this.snoozeIntervals : undefined,
			});

			this.close();
			this.onSave();
			this.plugin.refreshAllViews();
			new Notice('Ticket updated.');
			generateTicketNote(this.plugin, this.context.ticket.id, oldFilePath ?? undefined).catch(() => { /* silent */ });
		} else {
			const ctx = this.context as NewTicketContext;
			const ticket = await this.plugin.store.createTicket({
				projectId: ctx.projectId,
				sprintId: ctx.sprintId,
				title: this.title.trim(),
				description: this.description.trim(),
				type: this.type,
				priority: this.priority,
				status: this.status,
				points: this.points,
				parentId: ctx.parentId ?? null,
				showOnBoard: ctx.showOnBoard,
				startDate: this.startDate,
				dueDate: this.dueDate,
				recurrence: this.recurrence,
				reminders: this.reminders.length > 0 ? this.reminders : undefined,
				snoozeIntervals: this.snoozeIntervals.length > 0 ? this.snoozeIntervals : undefined,
			});

			this.close();
			this.onSave();
			this.plugin.refreshAllViews();
			new Notice('Ticket created.');
			generateTicketNote(this.plugin, ticket.id).catch(() => { /* silent */ });
		}
		} catch (err) {
			this.submitting = false;
			throw err;
		}
	}
}
