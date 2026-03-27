import { App, Modal, Setting, Notice, TFile } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '../types';
import { generateTicketNote, deleteTicketNote, ticketFilePath } from '../ticketNote';
import { ConfirmModal } from './ConfirmModal';

interface NewTicketContext {
	projectId: string;
	sprintId: string | null;
	status?: TicketStatus;
	parentId?: string;
	defaultType?: TicketType;
	showOnBoard?: boolean;
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
		} else {
			if (context.status) this.status = context.status;
			if (context.defaultType) this.type = context.defaultType;
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
					await this.plugin.store.deleteTicket(ticketId);
					this.close();
					this.onSave();
					new Notice('Ticket deleted.');
					deleteTicketNote(this.plugin, ticketId).catch(() => { /* silent */ });
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
		descLabelRow.createEl('span', { cls: 'pf-desc-label', text: 'Description' });

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

		const descTextarea = descBlock.createEl('textarea', { cls: 'pf-textarea', placeholder: 'Optional description' });
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
		new Setting(infoPane)
			.setName('Work type')
			.addDropdown(drop => {
				for (const [val, label] of allowedTypes) drop.addOption(val, label);
				drop.setValue(this.type);
				drop.onChange(val => { this.type = val as TicketType; });
			});

		new Setting(infoPane)
			.setName('Priority')
			.addDropdown(drop => {
				drop.addOption('low', 'Low');
				drop.addOption('medium', 'Medium');
				drop.addOption('high', 'High');
				drop.addOption('critical', 'Critical');
				drop.setValue(this.priority);
				drop.onChange(val => { this.priority = val as TicketPriority; });
			});

		new Setting(infoPane)
			.setName('Status')
			.addDropdown(drop => {
				const projId = isEditContext(this.context) ? this.context.ticket.projectId : (this.context as { projectId: string }).projectId;
				const projStatuses = this.plugin.store.getProjectStatuses(projId);
				for (const st of projStatuses) {
					drop.addOption(st.id, st.label);
				}
				drop.setValue(this.status);
				drop.onChange(val => { this.status = val; });
			});

		new Setting(infoPane)
			.setName('Story points')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.step = '1';
				text.inputEl.addClass('pf-input-points');
				if (this.points !== undefined) text.inputEl.value = String(this.points);
				text.inputEl.addEventListener('input', () => {
					const raw = text.inputEl.value.trim();
					this.points = raw === '' ? undefined : Math.max(0, Math.round(Number(raw)));
				});
			});

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
						await this.plugin.store.deleteTicket(ticketId);
						this.close();
						this.onSave();
						new Notice('Ticket deleted.');
						deleteTicketNote(this.plugin, ticketId).catch(() => { /* silent */ });
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
			});

			this.close();
			this.onSave();
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
			});

			this.close();
			this.onSave();
			new Notice('Ticket created.');
			generateTicketNote(this.plugin, ticket.id).catch(() => { /* silent */ });
		}
		} catch (err) {
			this.submitting = false;
			throw err;
		}
	}
}
