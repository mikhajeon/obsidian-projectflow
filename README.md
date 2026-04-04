# ProjectFlow

Personal project management with kanban boards, sprints, and progress tracking -- all inside Obsidian. Manage tickets, plan sprints, and track progress without leaving your vault.

## Features

### Kanban board

- Drag-and-drop cards across customizable status columns (To Do, In Progress, In Review, Done, or your own).
- Multiple board modes: default kanban, group-by-parent, and subtasks-only.
- Collapsible columns with adjustable widths.
- Optional priority-colored card borders.

### Sprint management

- Create sprints with start/end dates, goals, and story point targets.
- Track velocity across sprints.
- Auto-spillover moves incomplete tickets into the next sprint.
- Write retrospective notes after each sprint and generate sprint history reports as markdown files.

### Backlog

- Dedicated backlog view for tickets not yet assigned to a sprint.
- Filter by type, priority, or status and sort by multiple fields.

### Tickets

- Types: Task, Bug, Story, Epic, Subtask.
- Priority levels: Low, Medium, High, Critical.
- Story point estimation and checklist items.
- Parent-child relationships (Epic to Story/Task to Subtask).
- Archive completed work and restore it later.

### List view

- Tree-based view of epics and unparented tickets with inline subtask management.
- Resizable table columns.

### Note synchronization

- Each ticket automatically generates a markdown note with frontmatter (title, status, priority, points, and more).
- Two-way sync: edits in the plugin update the note, and frontmatter edits in the note update the plugin.
- Smart file paths organize notes by project, epic, and ticket type.

### Undo and redo

- Up to 50 steps of undo/redo history for ticket changes.

### Custom statuses

- Define per-project status columns with custom labels and colors.

## Installation

### From community plugins

1. Open **Settings > Community plugins** in Obsidian.
2. Select **Browse** and search for **ProjectFlow**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mikhajeon/obsidian-projectflow/releases).
2. Create a folder named `obsidian-projectflow` inside your vault's `.obsidian/plugins/` directory.
3. Copy the three files into that folder.
4. Open **Settings > Community plugins** in Obsidian and enable **ProjectFlow**.

## Usage

### Getting started

1. Open the plugin settings (**Settings > ProjectFlow**) and configure the base folder where ticket notes will be stored (default: `ProjectFlow`).
2. Create a new project from the settings page or use the **New project** command.
3. Click the ProjectFlow ribbon icon or run the **Open kanban board** command to open the board view.

### Working with the board

- Use the tabs at the top to switch between **Board**, **By Parent**, **Backlog**, **List**, and **Archive** views.
- Click **+ Ticket** at the bottom of any column to create a new ticket in that status.
- Drag cards between columns to change their status, or drag vertically to reorder within a column.
- Right-click a card to edit, open its note, add subtasks, move to backlog, archive, or delete.

### Sprints

- Open the sprint panel from the board view toolbar to create and manage sprints.
- Activate a sprint to scope the board to that sprint's tickets.
- When a sprint ends, complete it to auto-generate a report and optionally spill remaining tickets into the next sprint.

### Commands

- **Open kanban board** -- open the board view.
- **Open backlog** -- open the backlog view.
- **Open sprint panel** -- open the sprint management panel.
- **New project** -- create a new project.
- **Undo last ticket change** -- undo the most recent ticket modification.
- **Redo ticket change** -- redo an undone modification.

## Data storage

All plugin data is stored locally inside your Obsidian vault. No network requests are made and no external services are used. Ticket notes are plain markdown files with YAML frontmatter, so they remain fully accessible even without the plugin.

## License

[MIT](LICENSE)
