import { Menu, Notice } from 'obsidian';
import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import type { Ticket } from '../types';
import { TICKET_STATUS_LABELS } from '../types';
import { ConfirmModal } from '../modals/ConfirmModal';
import { deleteTicketNote, generateTicketNote } from '../ticketNote';

export class ArchivePanelView {
	private view: BoardView;

	constructor(view: BoardView) {
		this.view = view;
	}

	render(container: HTMLElement, store: ProjectStore, projectId: string): void {
		const scrollArea = container.createEl('div', { cls: 'pf-backlog-list pf-tbl-container pf-archive-panel' });

		const archiveCols = [
			{ key: 'name',       label: 'Name',        cssVar: '--pf-col-name',     default: 280, sortField: 'title'    },
			{ key: 'priority',   label: 'Priority',    cssVar: '--pf-col-priority', default: 100, sortField: 'priority' },
			{ key: 'status',     label: 'Status',      cssVar: '--pf-col-status',   default: 110, sortField: 'status'   },
			{ key: 'archivedAt', label: 'Archived',    cssVar: '--pf-col-extra',    default: 150, sortField: 'archived' },
		];
		const savedWidths = store.getColWidths('archive');
		for (const col of archiveCols) {
			scrollArea.style.setProperty(col.cssVar, `${savedWidths[col.key] ?? col.default}px`);
		}

		this.view.renderTableHeader(scrollArea, archiveCols, (key, width) => {
			const current = store.getColWidths('archive');
			store.setColWidths('archive', { ...current, [key]: width });
		}, this.view.sortOrder, async (next) => {
			this.view.sortOrder = next;
			await this.view.plugin.store.setSortOrder('archive', next);
			const scrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			const scrollTop = scrollEl?.scrollTop ?? 0;
			this.view.render();
			const newScrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			if (newScrollEl) newScrollEl.scrollTop = scrollTop;
		});

		const archived = store.getArchivedTickets(projectId);

		if (archived.length === 0) {
			scrollArea.createEl('div', { cls: 'pf-empty-state', text: 'No archived tickets.' });
			return;
		}

		// ── Bulk actions toolbar ──────────────────────────────────────────────
		const toolbar = scrollArea.createEl('div', { cls: 'pf-archive-toolbar' });
		const selectedIds = new Set<string>();

		const updateToolbar = () => {
			const count = selectedIds.size;
			selCountEl.setText(count > 0 ? `${count} selected` : '');
			unarchiveBtn.style.display = count > 0 ? '' : 'none';
			deleteBtn.style.display = count > 0 ? '' : 'none';
		};

		const selCountEl = toolbar.createEl('span', { cls: 'pf-archive-sel-count' });
		const unarchiveBtn = toolbar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Restore selected' });
		unarchiveBtn.style.display = 'none';
		unarchiveBtn.addEventListener('click', async () => {
			const ids = [...selectedIds];
			for (const id of ids) {
				await store.unarchiveTicket(id);
				generateTicketNote(this.view.plugin, id).catch(() => { /* silent */ });
			}
			new Notice(`Restored ${ids.length} ticket${ids.length !== 1 ? 's' : ''}.`);
			this.view.render();
		});
		const deleteBtn = toolbar.createEl('button', { cls: 'pf-btn pf-btn-sm pf-btn-danger', text: 'Delete selected' });
		deleteBtn.style.display = 'none';
		deleteBtn.addEventListener('click', () => {
			const ids = [...selectedIds];
			new ConfirmModal(
				this.view.app,
				`Permanently delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''}? This cannot be undone.`,
				async () => {
					for (const id of ids) {
						await deleteTicketNote(this.view.plugin, id);
						await store.deleteTicket(id);
					}
					new Notice(`Deleted ${ids.length} ticket${ids.length !== 1 ? 's' : ''}.`);
					this.view.render();
				}
			).open();
		});

		// ── Rows ──────────────────────────────────────────────────────────────
		for (const ticket of archived) {
			this.renderArchiveRow(scrollArea, store, ticket, selectedIds, updateToolbar);
		}

		updateToolbar();
	}

	private renderArchiveRow(
		container: HTMLElement,
		store: ProjectStore,
		ticket: Ticket,
		selectedIds: Set<string>,
		updateToolbar: () => void,
	): void {
		const row = container.createEl('div', { cls: `pf-tbl-row pf-archive-row` });
		row.dataset.ticketId = ticket.id;

		// Drag handle placeholder (no drag in archive)
		row.createEl('div', { cls: 'pf-drag-handle pf-drag-handle-disabled' });

		// Checkbox
		const cbCell = row.createEl('div', { cls: 'pf-row-checkbox-cell' });
		const cb = cbCell.createEl('input', { cls: 'pf-row-checkbox' }) as HTMLInputElement;
		cb.type = 'checkbox';
		cb.checked = selectedIds.has(ticket.id);
		cb.addEventListener('click', (e) => {
			e.stopPropagation();
			if (selectedIds.has(ticket.id)) {
				selectedIds.delete(ticket.id);
				row.removeClass('pf-row-selected');
			} else {
				selectedIds.add(ticket.id);
				row.addClass('pf-row-selected');
			}
			updateToolbar();
		});
		if (selectedIds.has(ticket.id)) row.addClass('pf-row-selected');

		// Name cell
		const nameCell = row.createEl('div', { cls: 'pf-tbl-cell pf-tbl-cell-name' });
		const nameInner = nameCell.createEl('div', { cls: 'pf-tbl-name-inner' });
		nameInner.createEl('span', { cls: `pf-type-icon pf-type-icon-${ticket.type}`, text: this.view.TYPE_ICONS[ticket.type] ?? '◻' });
		nameInner.createEl('span', { cls: 'pf-tbl-title', text: ticket.title });
		if (ticket.points !== undefined) {
			nameInner.createEl('span', { cls: 'pf-badge pf-points', text: `${ticket.points} pts` });
		}

		// Priority cell
		row.createEl('div', { cls: 'pf-tbl-cell' })
			.createEl('span', { cls: `pf-badge pf-pri-${ticket.priority}`, text: ticket.priority });

		// Status cell
		this.view.makeStatusBadge(row.createEl('div', { cls: 'pf-tbl-cell' }), ticket.status, ticket.projectId);

		// Archived date cell
		const dateCell = row.createEl('div', { cls: 'pf-tbl-cell' });
		if (ticket.archivedAt) {
			dateCell.createEl('span', { cls: 'pf-tbl-date', text: new Date(ticket.archivedAt).toLocaleDateString() });
		}

		// Context menu
		row.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Restore').setIcon('rotate-ccw').onClick(async () => {
					await store.unarchiveTicket(ticket.id);
					generateTicketNote(this.view.plugin, ticket.id).catch(() => { /* silent */ });
					new Notice('Ticket restored.');
					this.view.render();
				})
			);
			menu.addSeparator();
			menu.addItem(item =>
				item.setTitle('Delete permanently').setIcon('trash').onClick(() => {
					new ConfirmModal(
						this.view.app,
						`Permanently delete "${ticket.title}"? This cannot be undone.`,
						async () => {
							await deleteTicketNote(this.view.plugin, ticket.id);
							await store.deleteTicket(ticket.id);
							new Notice('Ticket deleted.');
							this.view.render();
						}
					).open();
				})
			);
			menu.showAtMouseEvent(e);
		});

		// Click to restore (with confirmation)
		row.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'INPUT') return;
			const menu = new Menu();
			menu.addItem(item =>
				item.setTitle('Restore ticket').setIcon('rotate-ccw').onClick(async () => {
					await store.unarchiveTicket(ticket.id);
					generateTicketNote(this.view.plugin, ticket.id).catch(() => { /* silent */ });
					new Notice('Ticket restored.');
					this.view.render();
				})
			);
			menu.addItem(item =>
				item.setTitle('Delete permanently').setIcon('trash').onClick(() => {
					new ConfirmModal(
						this.view.app,
						`Permanently delete "${ticket.title}"? This cannot be undone.`,
						async () => {
							await deleteTicketNote(this.view.plugin, ticket.id);
							await store.deleteTicket(ticket.id);
							new Notice('Ticket deleted.');
							this.view.render();
						}
					).open();
				})
			);
			menu.showAtMouseEvent(e);
		});
	}
}
