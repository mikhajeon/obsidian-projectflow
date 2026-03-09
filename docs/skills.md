# Obsidian Plugin API — Quick Reference

Practical cheat sheet for this project. Assumes TypeScript, esbuild, Obsidian 1.4+.

---

## Build Setup

### manifest.json — required fields

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Short description.",
  "author": "your-name",
  "main": "main.js"
}
```

`main` defaults to `main.js` and must match `outfile` in esbuild config. `isDesktopOnly` is optional (default false).

### esbuild.config.mjs — key settings

```js
esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtins],
  format: 'cjs',       // required — Obsidian loads CommonJS
  target: 'es2018',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
});
```

`obsidian` must be in `external` — it is provided by the host app at runtime, not bundled.

Build commands:

```bash
npm run dev      # watch mode with inline sourcemaps
npm run build    # tsc type-check + production bundle
```

---

## Plugin Lifecycle

```typescript
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  async onload(): Promise<void> {
    // Called when plugin is enabled.
    // Register views, commands, ribbon icons, setting tabs here.
  }

  async onunload(): Promise<void> {
    // Called when plugin is disabled.
    // Detach leaves, close connections, clean up event listeners.
    this.app.workspace.detachLeavesOfType(MY_VIEW_TYPE);
  }
}
```

Resources registered via `this.registerX()` helpers are auto-cleaned on unload. Manually created resources (WebSocket, interval, event listeners outside `this.registerEvent`) must be cleaned in `onunload`.

---

## Core Plugin Methods

| Method | Purpose |
|---|---|
| `this.registerView(type, factory)` | Register a custom view type |
| `this.addCommand({ id, name, callback })` | Add a command palette entry |
| `this.addRibbonIcon(icon, title, callback)` | Add a left-sidebar icon |
| `this.addSettingTab(tab)` | Register a settings tab |
| `this.addStatusBarItem()` | Add a status bar element (returns HTMLElement) |
| `this.loadData()` | Load saved plugin data (returns `unknown`) |
| `this.saveData(data)` | Persist plugin data as JSON |
| `this.registerEvent(eventRef)` | Register a workspace/vault event (auto-cleaned) |
| `this.registerInterval(id)` | Register a setInterval result (auto-cleaned) |
| `this.registerDomEvent(el, type, cb)` | Register a DOM event (auto-cleaned) |

### addCommand

```typescript
this.addCommand({
  id: 'open-board',          // unique within plugin, use kebab-case
  name: 'Open kanban board', // sentence case, shown in palette
  callback: () => this.activateView(BOARD_VIEW),
  // hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'b' }],  // optional
  // checkCallback: (checking) => { ... },                  // for conditional commands
});
```

### addRibbonIcon

```typescript
// icon: lucide icon name (kebab-case), e.g. 'layout-dashboard', 'file-text'
const btn = this.addRibbonIcon('layout-dashboard', 'Open board', (evt) => {
  this.activateView(BOARD_VIEW);
});
btn.addClass('my-ribbon-icon'); // optional extra class
```

### loadData / saveData

```typescript
// Stored at: <vault>/<configDir>/plugins/<plugin-id>/data.json
const data = await this.loadData() as MyDataType | null;
await this.saveData({ ...data, key: 'value' });
```

---

## ItemView — Custom Views

### Minimal structure

```typescript
import { ItemView, WorkspaceLeaf } from 'obsidian';

export const MY_VIEW_TYPE = 'my-view';

export class MyView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return MY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'My View';  // shown in tab title
  }

  getIcon(): string {
    return 'layout-dashboard';  // lucide icon, optional
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.createEl('h2', { text: 'Hello from my view' });
  }

  async onClose(): Promise<void> {
    // clean up any view-specific resources here
  }
}
```

`containerEl.children[0]` is the view header bar. `containerEl.children[1]` is the content area.

### Register and activate (main.ts pattern)

```typescript
// In onload():
this.registerView(MY_VIEW_TYPE, (leaf) => new MyView(leaf));

// Activate helper — reuse existing leaf or open in new one:
async activateView(viewType: string): Promise<void> {
  const { workspace } = this.app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(viewType)[0] ?? null;
  if (!leaf) {
    leaf = workspace.getLeaf(false);  // false = reuse current leaf
    if (leaf) await leaf.setViewState({ type: viewType, active: true });
  }
  if (leaf) workspace.revealLeaf(leaf);
}

// In onunload():
this.app.workspace.detachLeavesOfType(MY_VIEW_TYPE);
```

`getLeaf(false)` reuses the current leaf. `getLeaf('tab')` opens a new tab. `getLeaf('split')` splits.

---

## Modal

```typescript
import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Are you sure?' });

    new Setting(contentEl)
      .addButton(btn =>
        btn.setButtonText('Confirm').setCta().onClick(() => {
          this.onConfirm();
          this.close();
        })
      )
      .addButton(btn =>
        btn.setButtonText('Cancel').onClick(() => this.close())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// Usage:
new ConfirmModal(this.app, () => doSomething()).open();
```

---

## Setting (PluginSettingTab)

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';

export class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Section heading — use .setHeading(), not an <h2> element
    new Setting(containerEl).setName('General').setHeading();

    new Setting(containerEl)
      .setName('Enable feature')          // sentence case
      .setDesc('Turns on the feature.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (val) => {
            this.plugin.settings.enabled = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Display name')
      .addText(text =>
        text
          .setPlaceholder('Enter name')
          .setValue(this.plugin.settings.name)
          .onChange(async (val) => {
            this.plugin.settings.name = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Choose option')
      .addDropdown(drop => {
        drop.addOption('a', 'Option A');
        drop.addOption('b', 'Option B');
        drop.setValue(this.plugin.settings.option);
        drop.onChange(async (val) => {
          this.plugin.settings.option = val;
          await this.plugin.saveSettings();
        });
      });

    // Button with destructive action
    new Setting(containerEl)
      .setName('Delete all data')
      .addButton(btn =>
        btn.setButtonText('Delete').setWarning().onClick(async () => {
          await this.plugin.clearData();
          new Notice('Data cleared.');
          this.display();  // re-render settings
        })
      );
  }
}
```

Register in `onload()`:

```typescript
this.addSettingTab(new MySettingTab(this.app, this));
```

---

## Notice

```typescript
import { Notice } from 'obsidian';

new Notice('Operation complete.');           // auto-dismisses (~4 s)
new Notice('Custom timeout.', 8000);         // 8 second timeout
new Notice('Permanent notice.', 0);          // stays until dismissed
```

---

## Vault and File APIs

### Config dir — never hardcode `.obsidian`

```typescript
// WRONG
const path = '.obsidian/plugins/my-plugin/data.json';

// CORRECT
const path = `${this.app.vault.configDir}/plugins/my-plugin/data.json`;
```

### Atomic writes — vault.process() over vault.modify()

```typescript
// AVOID for atomic updates
await this.app.vault.modify(file, newContent);

// PREFER — atomic
await this.app.vault.process(file, (current) => newContent);
```

### Delete — respect user trash preference

```typescript
// WRONG
await this.app.vault.delete(file);

// CORRECT
await this.app.fileManager.trashFile(file);
```

### Path safety — always normalize

```typescript
import { normalizePath } from 'obsidian';

const safe = normalizePath(userProvidedPath);
// Prevents directory traversal, normalizes separators
```

### Vault base path — use instanceof guard, not any cast

```typescript
import { FileSystemAdapter } from 'obsidian';

const adapter = this.app.vault.adapter;
if (adapter instanceof FileSystemAdapter) {
  const basePath = adapter.getBasePath(); // absolute OS path
}
```

---

## DOM Construction — Never Use innerHTML

```typescript
// WRONG — XSS risk
el.innerHTML = '<b>Hello</b>';

// CORRECT — Obsidian DOM helpers
const div = containerEl.createDiv({ cls: 'my-card' });
div.createEl('span', { text: 'Hello', cls: 'my-label' });

// setText for updating text safely
div.setText('Updated content');
```

Use `styles.css` for layout — never inline styles on elements.

---

## Settings Pattern (with defaults)

```typescript
interface MySettings {
  enabled: boolean;
  name: string;
}

const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  name: '',
};

export default class MyPlugin extends Plugin {
  settings!: MySettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    // ...
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

---

## Key Imports Reference

```typescript
import {
  Plugin,
  PluginSettingTab,
  ItemView,
  Modal,
  Setting,
  Notice,
  WorkspaceLeaf,
  normalizePath,
  FileSystemAdapter,
  TFile,
  TFolder,
  App,
} from 'obsidian';
```

---

## Distribution Checklist

Only three files are downloaded when users install from Community Plugins:

- `manifest.json` (required)
- `main.js` (required, built output)
- `styles.css` (optional)

Source files, scripts, and assets in `src/` are not distributed. Any runtime dependencies must be bundled into `main.js` by esbuild.
