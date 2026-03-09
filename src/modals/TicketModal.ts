import { App, Modal, Setting, Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '../types';

interface NewTicketContext {
	projectId: string;
	sprintId: string | null;
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
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		const isEdit = isEditContext(this.context);
		contentEl.empty();
		contentEl.addClass('pf-modal');

		contentEl.createEl('h2', { text: isEdit ? 'Edit ticket' : 'New ticket' });

		new Setting(contentEl)
			.setName('Title')
			.addText(text => {
				text.setPlaceholder('Ticket title').setValue(this.title);
				text.inputEl.addClass('pf-input-full');
				text.onChange(val => { this.title = val; });
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.setName('Description')
			.addTextArea(area => {
				area.setPlaceholder('Optional description').setValue(this.description);
				area.inputEl.addClass('pf-textarea');
				area.onChange(val => { this.description = val; });
			});

		new Setting(contentEl)
			.setName('Type')
			.addDropdown(drop => {
				drop.addOption('task', 'Task');
				drop.addOption('bug', 'Bug');
				drop.addOption('feature', 'Feature');
				drop.addOption('story', 'Story');
				drop.setValue(this.type);
				drop.onChange(val => { this.type = val as TicketType; });
			});

		new Setting(contentEl)
			.setName('Priority')
			.addDropdown(drop => {
				drop.addOption('low', 'Low');
				drop.addOption('medium', 'Medium');
				drop.addOption('high', 'High');
				drop.addOption('critical', 'Critical');
				drop.setValue(this.priority);
				drop.onChange(val => { this.priority = val as TicketPriority; });
			});

		new Setting(contentEl)
			.setName('Status')
			.addDropdown(drop => {
				drop.addOption('todo', 'To Do');
				drop.addOption('in-progress', 'In Progress');
				drop.addOption('in-review', 'In Review');
				drop.addOption('done', 'Done');
				drop.setValue(this.status);
				drop.onChange(val => { this.status = val as TicketStatus; });
			});

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });

		if (isEdit) {
			footer.createEl('button', { cls: 'pf-btn pf-btn-danger', text: 'Delete' })
				.addEventListener('click', async () => {
					await this.plugin.store.deleteTicket((this.context as EditTicketContext).ticket.id);
					new Notice('Ticket deleted.');
					this.close();
					this.onSave();
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
		if (!this.title.trim()) {
			new Notice('Ticket title is required.');
			return;
		}

		if (isEditContext(this.context)) {
			await this.plugin.store.updateTicket(this.context.ticket.id, {
				title: this.title.trim(),
				description: this.description.trim(),
				type: this.type,
				priority: this.priority,
				status: this.status,
				sprintId: this.context.sprintId,
			});
			new Notice('Ticket updated.');
		} else {
			await this.plugin.store.createTicket({
				projectId: this.context.projectId,
				sprintId: this.context.sprintId,
				title: this.title.trim(),
				description: this.description.trim(),
				type: this.type,
				priority: this.priority,
				status: this.status,
			});
			new Notice('Ticket created.');
		}

		this.close();
		this.onSave();
	}
}
