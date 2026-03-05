/**
 * Morning Briefing — Personalized daily intelligence briefing.
 * Shows top signals, buying windows closing, new decision-makers,
 * cascade alerts, follow-up reminders, and one team insight.
 * Designed to be read in 90 seconds.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-briefing-styles';

export interface BriefingData {
  date: string;
  greeting: string;
  // Top 3 signals needing attention
  topSignals: Array<{
    company: string;
    signal: string;
    urgency: 'critical' | 'high' | 'medium';
    signalType: string;
    source: string;
    timestamp: string;
    action: string;
  }>;
  // Buying windows closing this week
  closingWindows: Array<{
    company: string;
    windowCloses: string;
    propensityScore: number;
    keySignal: string;
    recommendedAction: string;
  }>;
  // New decision-makers
  newDecisionMakers: Array<{
    name: string;
    title: string;
    company: string;
    previousCompany: string;
    detectedAt: string;
  }>;
  // Cascade alerts
  cascadeAlerts: Array<{
    triggerEvent: string;
    impactedCompanies: number;
    summary: string;
  }>;
  // Follow-up reminders
  followUps: Array<{
    contact: string;
    company: string;
    lastOutreach: string;
    daysSince: number;
    suggestedAction: string;
  }>;
  // Team insight
  teamInsight: string;
  // Summary stats
  stats: {
    newSignals: number;
    watchlistCompanies: number;
    pipelineValue: string;
    tasksToday: number;
  };
}

const STYLES = `
  .si-briefing {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
  }

  /* ---- Header ---- */

  .si-briefing-header {
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #1E293B;
  }

  .si-briefing-date {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .si-briefing-greeting {
    font-size: 24px;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0 0 16px;
    line-height: 1.3;
  }

  .si-briefing-stats {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }

  .si-briefing-stat {
    font-size: 13px;
    color: #94a3b8;
  }

  .si-briefing-stat strong {
    color: #e2e8f0;
    font-weight: 600;
  }

  /* ---- Section ---- */

  .si-briefing-section {
    margin-bottom: 28px;
  }

  .si-briefing-section-title {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .si-briefing-section-count {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    padding: 1px 6px;
    border-radius: 100px;
    font-size: 10px;
  }

  /* ---- Signal Card ---- */

  .si-briefing-signal {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 8px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    transition: border-color 0.15s;
    cursor: pointer;
  }

  .si-briefing-signal:hover {
    border-color: #334155;
  }

  .si-briefing-signal-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 6px;
    flex-shrink: 0;
  }

  .si-briefing-signal-dot--critical { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.4); }
  .si-briefing-signal-dot--high { background: #f59e0b; }
  .si-briefing-signal-dot--medium { background: #3b82f6; }

  .si-briefing-signal-content {
    flex: 1;
    min-width: 0;
  }

  .si-briefing-signal-company {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 4px;
  }

  .si-briefing-signal-text {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .si-briefing-signal-meta {
    font-size: 11px;
    color: #475569;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .si-briefing-signal-action {
    font-size: 12px;
    color: #3b82f6;
    cursor: pointer;
    font-weight: 500;
    flex-shrink: 0;
    align-self: center;
  }

  .si-briefing-signal-action:hover {
    text-decoration: underline;
  }

  /* ---- Window Card ---- */

  .si-briefing-window {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .si-briefing-window-timer {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    border: 2px solid;
  }

  .si-briefing-window-timer--urgent { border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.08); }
  .si-briefing-window-timer--soon { border-color: #f59e0b; color: #f59e0b; background: rgba(245,158,11,0.08); }
  .si-briefing-window-timer--safe { border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.08); }

  .si-briefing-window-info { flex: 1; min-width: 0; }

  .si-briefing-window-company {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 2px;
  }

  .si-briefing-window-detail {
    font-size: 12px;
    color: #94a3b8;
  }

  .si-briefing-window-score {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 100px;
    flex-shrink: 0;
  }

  /* ---- Person Card ---- */

  .si-briefing-person {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .si-briefing-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #1e293b;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .si-briefing-person-info { flex: 1; }

  .si-briefing-person-name {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-briefing-person-detail {
    font-size: 12px;
    color: #94a3b8;
  }

  .si-briefing-person-prev {
    font-size: 11px;
    color: #475569;
    margin-top: 2px;
  }

  /* ---- Cascade Alert ---- */

  .si-briefing-cascade {
    background: rgba(249, 115, 22, 0.06);
    border: 1px solid rgba(249, 115, 22, 0.2);
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 8px;
  }

  .si-briefing-cascade-trigger {
    font-size: 13px;
    font-weight: 600;
    color: #fb923c;
    margin-bottom: 4px;
  }

  .si-briefing-cascade-summary {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
  }

  /* ---- Follow-up ---- */

  .si-briefing-followup {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .si-briefing-followup-days {
    font-size: 12px;
    font-weight: 700;
    color: #f59e0b;
    width: 36px;
    text-align: center;
    flex-shrink: 0;
  }

  .si-briefing-followup-info { flex: 1; }

  .si-briefing-followup-contact {
    font-size: 13px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .si-briefing-followup-detail {
    font-size: 12px;
    color: #94a3b8;
  }

  /* ---- Team Insight ---- */

  .si-briefing-insight {
    background: rgba(139, 92, 246, 0.06);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 10px;
    padding: 16px;
    font-size: 13px;
    color: #c4b5fd;
    line-height: 1.6;
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .si-briefing-insight-icon {
    flex-shrink: 0;
    font-size: 14px;
  }

  /* ---- Responsive ---- */

  @media (max-width: 600px) {
    .si-briefing { padding: 24px 16px; }
    .si-briefing-stats { flex-direction: column; gap: 8px; }
  }
`;

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function timerClass(dateStr: string): string {
  const d = daysUntil(dateStr);
  if (d <= 3) return 'urgent';
  if (d <= 7) return 'soon';
  return 'safe';
}

export class MorningBriefing {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private data: BriefingData;
  private onCompanyClick: ((company: string) => void) | null = null;
  private onActionClick: ((action: string, context: Record<string, string>) => void) | null = null;

  constructor(data: BriefingData) {
    this.data = data;
    this.root = document.createElement('div');
    this.root.className = 'si-briefing';
    this.injectStyles();
    this.buildUI();
  }

  public onCompanySelect(callback: (company: string) => void): void {
    this.onCompanyClick = callback;
  }

  public onAction(callback: (action: string, context: Record<string, string>) => void): void {
    this.onActionClick = callback;
  }

  public setData(data: BriefingData): void {
    this.data = data;
    this.buildUI();
  }

  public render(container: HTMLElement): void {
    container.appendChild(this.root);
  }

  public destroy(): void {
    this.root.remove();
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

  private buildUI(): void {
    this.root.innerHTML = '';

    // Header
    this.root.appendChild(this.buildHeader());

    // Top Signals
    if (this.data.topSignals.length > 0) {
      this.root.appendChild(this.buildSection('Needs Your Attention', this.data.topSignals.length, this.buildTopSignals()));
    }

    // Buying Windows
    if (this.data.closingWindows.length > 0) {
      this.root.appendChild(this.buildSection('Buying Windows Closing', this.data.closingWindows.length, this.buildClosingWindows()));
    }

    // Cascade Alerts
    if (this.data.cascadeAlerts.length > 0) {
      this.root.appendChild(this.buildSection('Market Cascade Alerts', this.data.cascadeAlerts.length, this.buildCascadeAlerts()));
    }

    // New Decision Makers
    if (this.data.newDecisionMakers.length > 0) {
      this.root.appendChild(this.buildSection('New Decision Makers Detected', this.data.newDecisionMakers.length, this.buildNewDMs()));
    }

    // Follow-up Reminders
    if (this.data.followUps.length > 0) {
      this.root.appendChild(this.buildSection('Follow-up Reminders', this.data.followUps.length, this.buildFollowUps()));
    }

    // Team Insight
    if (this.data.teamInsight) {
      this.root.appendChild(this.buildTeamInsight());
    }
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'si-briefing-header';
    header.innerHTML = `
      <div class="si-briefing-date">${this.data.date}</div>
      <h1 class="si-briefing-greeting">${this.data.greeting}</h1>
      <div class="si-briefing-stats">
        <span class="si-briefing-stat"><strong>${this.data.stats.newSignals}</strong> new signals</span>
        <span class="si-briefing-stat"><strong>${this.data.stats.watchlistCompanies}</strong> watched companies</span>
        <span class="si-briefing-stat"><strong>${this.data.stats.pipelineValue}</strong> pipeline</span>
        <span class="si-briefing-stat"><strong>${this.data.stats.tasksToday}</strong> tasks today</span>
      </div>
    `;
    return header;
  }

  private buildSection(title: string, count: number, content: HTMLElement): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-briefing-section';

    const titleEl = document.createElement('div');
    titleEl.className = 'si-briefing-section-title';
    titleEl.innerHTML = `${title} <span class="si-briefing-section-count">${count}</span>`;
    section.appendChild(titleEl);
    section.appendChild(content);
    return section;
  }

  private buildTopSignals(): HTMLElement {
    const container = document.createElement('div');
    for (const signal of this.data.topSignals) {
      const el = document.createElement('div');
      el.className = 'si-briefing-signal';
      el.innerHTML = `
        <div class="si-briefing-signal-dot si-briefing-signal-dot--${signal.urgency}"></div>
        <div class="si-briefing-signal-content">
          <div class="si-briefing-signal-company">${signal.company}</div>
          <div class="si-briefing-signal-text">${signal.signal}</div>
          <div class="si-briefing-signal-meta">
            <span>${signal.signalType.replace(/_/g, ' ')}</span>
            <span>${signal.source}</span>
            <span>${signal.timestamp}</span>
          </div>
        </div>
        <span class="si-briefing-signal-action">${signal.action}</span>
      `;
      el.addEventListener('click', () => this.onCompanyClick?.(signal.company));
      container.appendChild(el);
    }
    return container;
  }

  private buildClosingWindows(): HTMLElement {
    const container = document.createElement('div');
    for (const win of this.data.closingWindows) {
      const d = daysUntil(win.windowCloses);
      const cls = timerClass(win.windowCloses);
      const el = document.createElement('div');
      el.className = 'si-briefing-window';
      el.innerHTML = `
        <div class="si-briefing-window-timer si-briefing-window-timer--${cls}">${d}d</div>
        <div class="si-briefing-window-info">
          <div class="si-briefing-window-company">${win.company}</div>
          <div class="si-briefing-window-detail">${win.keySignal}</div>
        </div>
        <span class="si-briefing-window-score" style="background:rgba(16,185,129,0.12);color:#34d399">P${win.propensityScore}</span>
      `;
      el.addEventListener('click', () => this.onCompanyClick?.(win.company));
      container.appendChild(el);
    }
    return container;
  }

  private buildCascadeAlerts(): HTMLElement {
    const container = document.createElement('div');
    for (const alert of this.data.cascadeAlerts) {
      const el = document.createElement('div');
      el.className = 'si-briefing-cascade';
      el.innerHTML = `
        <div class="si-briefing-cascade-trigger">${alert.triggerEvent} \u2192 ${alert.impactedCompanies} companies affected</div>
        <div class="si-briefing-cascade-summary">${alert.summary}</div>
      `;
      container.appendChild(el);
    }
    return container;
  }

  private buildNewDMs(): HTMLElement {
    const container = document.createElement('div');
    for (const dm of this.data.newDecisionMakers) {
      const el = document.createElement('div');
      el.className = 'si-briefing-person';
      el.innerHTML = `
        <div class="si-briefing-avatar">${getInitials(dm.name)}</div>
        <div class="si-briefing-person-info">
          <div class="si-briefing-person-name">${dm.name}</div>
          <div class="si-briefing-person-detail">${dm.title} at ${dm.company}</div>
          <div class="si-briefing-person-prev">Previously: ${dm.previousCompany}</div>
        </div>
      `;
      el.addEventListener('click', () => this.onCompanyClick?.(dm.company));
      container.appendChild(el);
    }
    return container;
  }

  private buildFollowUps(): HTMLElement {
    const container = document.createElement('div');
    for (const fu of this.data.followUps) {
      const el = document.createElement('div');
      el.className = 'si-briefing-followup';
      el.innerHTML = `
        <div class="si-briefing-followup-days">${fu.daysSince}d</div>
        <div class="si-briefing-followup-info">
          <div class="si-briefing-followup-contact">${fu.contact} at ${fu.company}</div>
          <div class="si-briefing-followup-detail">${fu.suggestedAction}</div>
        </div>
      `;
      el.addEventListener('click', () => this.onActionClick?.('followup', { contact: fu.contact, company: fu.company }));
      container.appendChild(el);
    }
    return container;
  }

  private buildTeamInsight(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-briefing-section';
    const insight = document.createElement('div');
    insight.className = 'si-briefing-insight';
    insight.innerHTML = `
      <span class="si-briefing-insight-icon">AI</span>
      <span>${this.data.teamInsight}</span>
    `;
    section.appendChild(insight);
    return section;
  }
}
