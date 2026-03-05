/**
 * Command Palette — Spotlight/Raycast-style ⌘K command palette
 * for instant navigation, search, and AI-powered actions.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-cmdpalette-styles';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  category: 'navigation' | 'action' | 'search' | 'ai';
  icon?: string;
  shortcut?: string;
  handler: () => void;
}

const STYLES = `
  .si-cmd-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 20vh;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
    font-family: Inter, system-ui, -apple-system, sans-serif;
  }

  .si-cmd-overlay--visible {
    opacity: 1;
    pointer-events: all;
  }

  .si-cmd-container {
    width: 560px;
    max-width: 90vw;
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 16px;
    box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    transform: scale(0.96) translateY(-8px);
    transition: transform 0.15s ease;
  }

  .si-cmd-overlay--visible .si-cmd-container {
    transform: scale(1) translateY(0);
  }

  .si-cmd-input-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid #1E293B;
  }

  .si-cmd-search-icon {
    width: 18px;
    height: 18px;
    color: #64748b;
    flex-shrink: 0;
  }

  .si-cmd-input {
    flex: 1;
    border: none;
    background: transparent;
    color: #e2e8f0;
    font-family: inherit;
    font-size: 15px;
    outline: none;
  }

  .si-cmd-input::placeholder {
    color: #475569;
  }

  .si-cmd-shortcut {
    font-size: 11px;
    color: #475569;
    padding: 2px 6px;
    background: #1e293b;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .si-cmd-results {
    max-height: 320px;
    overflow-y: auto;
    padding: 8px;
  }

  .si-cmd-results::-webkit-scrollbar {
    width: 4px;
  }

  .si-cmd-results::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 2px;
  }

  .si-cmd-category {
    font-size: 10px;
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 12px 4px;
  }

  .si-cmd-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .si-cmd-item:hover,
  .si-cmd-item--active {
    background: rgba(59, 130, 246, 0.1);
  }

  .si-cmd-item-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .si-cmd-item-icon--nav { color: #3b82f6; }
  .si-cmd-item-icon--action { color: #10b981; }
  .si-cmd-item-icon--search { color: #f59e0b; }
  .si-cmd-item-icon--ai { color: #a78bfa; }

  .si-cmd-item-content {
    flex: 1;
    min-width: 0;
  }

  .si-cmd-item-label {
    font-size: 13px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .si-cmd-item-desc {
    font-size: 11px;
    color: #64748b;
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .si-cmd-item-shortcut {
    font-size: 10px;
    color: #475569;
    padding: 2px 6px;
    background: #1e293b;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .si-cmd-footer {
    padding: 8px 16px;
    border-top: 1px solid #1E293B;
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: #475569;
  }

  .si-cmd-footer kbd {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    background: #1e293b;
    border-radius: 3px;
    font-family: inherit;
    font-size: 10px;
    margin: 0 2px;
  }

  .si-cmd-empty {
    padding: 32px 16px;
    text-align: center;
    color: #475569;
    font-size: 13px;
  }
`;

const CATEGORY_ICONS: Record<string, string> = {
  navigation: '\u2302',
  action: '\u26A1',
  search: '\uD83D\uDD0D',
  ai: '\u2728',
};

export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private resultsContainer: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private commands: CommandItem[] = [];
  private filteredCommands: CommandItem[] = [];
  private activeIndex = 0;
  private isVisible = false;
  private keydownHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.injectStyles();

    // Build overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'si-cmd-overlay';

    const container = document.createElement('div');
    container.className = 'si-cmd-container';

    // Input
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'si-cmd-input-wrapper';
    inputWrapper.innerHTML = `
      <svg class="si-cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    `;
    this.input = document.createElement('input');
    this.input.className = 'si-cmd-input';
    this.input.placeholder = 'Type a command or search...';
    this.input.type = 'text';
    inputWrapper.appendChild(this.input);

    const esc = document.createElement('span');
    esc.className = 'si-cmd-shortcut';
    esc.textContent = 'ESC';
    inputWrapper.appendChild(esc);

    // Results
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'si-cmd-results';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'si-cmd-footer';
    footer.innerHTML = `
      <span><kbd>\u2191\u2193</kbd> Navigate</span>
      <span><kbd>\u21B5</kbd> Select</span>
      <span><kbd>ESC</kbd> Close</span>
    `;

    container.appendChild(inputWrapper);
    container.appendChild(this.resultsContainer);
    container.appendChild(footer);
    this.overlay.appendChild(container);

    // Event handlers
    this.input.addEventListener('input', () => this.onQueryChange());
    this.input.addEventListener('keydown', (e) => this.onInputKeydown(e));
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Global ⌘K / Ctrl+K handler
    this.keydownHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
    };

    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.keydownHandler);
  }

  public registerCommands(commands: CommandItem[]): void {
    this.commands = commands;
    this.filteredCommands = commands;
  }

  public addCommand(command: CommandItem): void {
    this.commands.push(command);
  }

  public show(): void {
    this.isVisible = true;
    this.overlay.classList.add('si-cmd-overlay--visible');
    this.input.value = '';
    this.filteredCommands = this.commands;
    this.activeIndex = 0;
    this.renderResults();
    requestAnimationFrame(() => this.input.focus());
  }

  public hide(): void {
    this.isVisible = false;
    this.overlay.classList.remove('si-cmd-overlay--visible');
    this.input.blur();
  }

  public toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  public destroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    this.overlay.remove();
    if (this.styleElement?.parentNode) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    this.styleElement = document.createElement('style');
    this.styleElement.id = STYLE_ID;
    this.styleElement.textContent = STYLES;
    document.head.appendChild(this.styleElement);
  }

  private onQueryChange(): void {
    const query = this.input.value.trim().toLowerCase();
    if (!query) {
      this.filteredCommands = this.commands;
    } else {
      this.filteredCommands = this.commands.filter(cmd =>
        cmd.label.toLowerCase().includes(query) ||
        (cmd.description?.toLowerCase().includes(query)) ||
        cmd.category.includes(query),
      );
    }
    this.activeIndex = 0;
    this.renderResults();
  }

  private onInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filteredCommands.length - 1);
        this.renderResults();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.renderResults();
        break;
      case 'Enter':
        e.preventDefault();
        const selectedCommand = this.filteredCommands[this.activeIndex];
        if (selectedCommand) {
          this.executeCommand(selectedCommand);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
    }
  }

  private executeCommand(command: CommandItem): void {
    this.hide();
    command.handler();
  }

  private renderResults(): void {
    this.resultsContainer.innerHTML = '';

    if (this.filteredCommands.length === 0) {
      this.resultsContainer.innerHTML = '<div class="si-cmd-empty">No results found. Try a different search.</div>';
      return;
    }

    // Group by category
    const grouped = new Map<string, CommandItem[]>();
    for (const cmd of this.filteredCommands) {
      const group = grouped.get(cmd.category) ?? [];
      group.push(cmd);
      grouped.set(cmd.category, group);
    }

    let globalIndex = 0;
    for (const [category, items] of grouped) {
      const catLabel = document.createElement('div');
      catLabel.className = 'si-cmd-category';
      catLabel.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      this.resultsContainer.appendChild(catLabel);

      for (const item of items) {
        const el = document.createElement('div');
        el.className = `si-cmd-item ${globalIndex === this.activeIndex ? 'si-cmd-item--active' : ''}`;

        const icon = CATEGORY_ICONS[item.category] ?? '';

        el.innerHTML = `
          <div class="si-cmd-item-icon si-cmd-item-icon--${item.category}">${item.icon ?? icon}</div>
          <div class="si-cmd-item-content">
            <div class="si-cmd-item-label">${item.label}</div>
            ${item.description ? `<div class="si-cmd-item-desc">${item.description}</div>` : ''}
          </div>
          ${item.shortcut ? `<span class="si-cmd-item-shortcut">${item.shortcut}</span>` : ''}
        `;

        const idx = globalIndex;
        el.addEventListener('click', () => {
          this.activeIndex = idx;
          this.executeCommand(item);
        });
        el.addEventListener('mouseenter', () => {
          this.activeIndex = idx;
          this.renderResults();
        });

        this.resultsContainer.appendChild(el);
        globalIndex++;
      }
    }

    // Scroll active item into view
    const activeEl = this.resultsContainer.querySelector('.si-cmd-item--active') as HTMLElement | null;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }
}
