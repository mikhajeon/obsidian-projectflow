import type { BoardView } from './BoardView';
import type { ProjectStore } from '../store';
import { TicketModal } from '../modals/TicketModal';
import { ConfirmModal } from '../modals/ConfirmModal';
import { deleteTicketNote } from '../ticketNote';
import { ListDragHandler } from './ListDragHandler';
import { ListRowRenderer } from './ListRowRenderer';

export class ListPanelView {
	private view: BoardView;
	private dragHandler: ListDragHandler;
	private rowRenderer: ListRowRenderer;

	constructor(view: BoardView) {
		this.view = view;
		this.dragHandler = new ListDragHandler(view);
		this.rowRenderer = new ListRowRenderer(view, this.dragHandler);
	}

	render(
		container: HTMLElement,
		store: ProjectStore,
		projectId: string,
	): void {
		const scrollArea = container.createEl('div', { cls: 'pf-epics-list pf-tbl-container' });
		const epicsCols = [
			{ key: 'name',     label: 'Name',     cssVar: '--pf-col-name',     default: 320, sortField: 'title'    },
			{ key: 'priority', label: 'Priority', cssVar: '--pf-col-priority', default: 100, sortField: 'priority' },
			{ key: 'status',   label: 'Status',   cssVar: '--pf-col-status',   default: 110, sortField: 'status'   },
			{ key: 'points',   label: 'Points',   cssVar: '--pf-col-extra',    default: 80,  sortField: 'points'   },
		];
		const savedListWidths = store.getColWidths('list');
		for (const col of epicsCols) {
			scrollArea.style.setProperty(col.cssVar, `${savedListWidths[col.key] ?? col.default}px`);
		}

		const epics = store.getEpics(projectId);
		const rogueTickets = store.getUnparentedTickets(projectId);

		if (epics.length === 0 && rogueTickets.length === 0) {
			this.view.renderEmpty(scrollArea, 'No tickets yet.', 'Create a ticket to get started.', () =>
				new TicketModal(this.view.app, this.view.plugin, { projectId, sprintId: null }, () => this.view.render()).open()
			);
			return;
		}

		const filteredTop = [...epics, ...rogueTickets]
			.filter(t => this.view.filterType === 'all' || t.type === this.view.filterType || t.type === 'epic')
			.filter(t => this.view.filterPriority === 'all' || t.priority === this.view.filterPriority)
			.filter(t => this.view.filterStatus === 'all' || t.status === this.view.filterStatus || t.type === 'epic');
		const topLevel = this.view.sortOrder === 'manual'
			? filteredTop.sort((a, b) => a.order - b.order)
			: this.view.applySort(filteredTop, this.view.sortOrder);

		const orderedIds: string[] = [];
		for (const item of topLevel) {
			orderedIds.push(item.id);
			if (item.type === 'epic') {
				const children = store.getChildTickets(item.id);
				if (!this.view.collapsedSections.has(item.id)) {
					for (const child of children) {
						orderedIds.push(child.id);
						if (!this.view.collapsedSections.has(child.id)) {
							for (const sub of store.getChildTickets(child.id)) {
								orderedIds.push(sub.id);
							}
						}
					}
				}
			} else if (!this.view.collapsedSections.has(item.id)) {
				for (const sub of store.getChildTickets(item.id)) {
					orderedIds.push(sub.id);
				}
			}
		}

		for (const id of [...this.view.selectedIds]) {
			if (!orderedIds.includes(id)) this.view.selectedIds.delete(id);
		}

		if (this.view.selectedIds.size > 0) scrollArea.addClass('pf-has-selection');

		this.view.renderTableHeader(scrollArea, epicsCols, (key, width) => {
			const current = store.getColWidths('list');
			store.setColWidths('list', { ...current, [key]: width });
		}, this.view.sortOrder, async (next) => {
			this.view.sortOrder = next;
			await this.view.plugin.store.setSortOrder('list', next);
			const scrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			const scrollTop = scrollEl?.scrollTop ?? 0;
			this.view.render();
			const newScrollEl = this.view.contentEl.querySelector<HTMLElement>('.pf-tbl-container');
			if (newScrollEl) newScrollEl.scrollTop = scrollTop;
		});

		const dropLineEl = scrollArea.createEl('div', { cls: 'pf-drop-line' });

		for (const item of topLevel) {
			if (item.type === 'epic') {
				this.rowRenderer.renderEpicSection(scrollArea, store, projectId, item, orderedIds);
			} else {
				this.rowRenderer.renderRogueRow(scrollArea, store, projectId, item, epics, orderedIds);
			}
		}

		// Selection action bar — always rendered to reserve space; hidden when empty
		{
			const hasSelection = this.view.selectedIds.size > 0;
			const bar = scrollArea.createEl('div', { cls: 'pf-selection-bar' });
			if (hasSelection) {
				const levels = new Set([...this.view.selectedIds].map(id => this.view.getTicketLevel(id)).filter(Boolean));
				const dragAllowed = levels.size === 1;
				bar.createEl('span', { cls: 'pf-selection-bar-count', text: `${this.view.selectedIds.size} selected` });
				if (!dragAllowed) {
					bar.createEl('span', { cls: 'pf-selection-bar-locked', text: 'Drag locked: mixed hierarchy' });
				}
				const archiveBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Archive selected' });
				archiveBtn.addEventListener('click', async () => {
					const ids = [...this.view.selectedIds];
					await store.bulkArchiveTickets(ids);
					this.view.selectedIds.clear();
					this.view.lastSelectedId = null;
					this.view.render();
				});
				const deleteBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Delete selected' });
				deleteBtn.addEventListener('click', async () => {
					const ids = [...this.view.selectedIds];
					const totalDescendants = ids.reduce((n, id) => n + store.getDescendantIds(id).length, 0);
					const msg = totalDescendants > 0
						? `Delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''} and ${totalDescendants} descendant${totalDescendants !== 1 ? 's' : ''}? This cannot be undone.`
						: `Delete ${ids.length} ticket${ids.length !== 1 ? 's' : ''}? This cannot be undone.`;
					new ConfirmModal(this.view.app, msg, async () => {
						for (const id of ids) {
							await deleteTicketNote(this.view.plugin, id);
							await store.deleteTicket(id);
						}
						this.view.selectedIds.clear();
						this.view.lastSelectedId = null;
						this.view.render();
					}).open();
				});
				const clearBtn = bar.createEl('button', { cls: 'pf-btn pf-btn-sm', text: 'Clear' });
				clearBtn.addEventListener('click', () => {
					this.view.selectedIds.clear();
					this.view.lastSelectedId = null;
					this.view.render();
				});
			}
		}

		this.dragHandler.setupDragDrop(scrollArea, dropLineEl, store, projectId);
	}
}
