/**
 * Win/Loss Insights — Pattern analysis from deal outcomes.
 * Shows actionable insights derived from closed deals.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-winloss-styles';

export interface WinLossData {
  totalDeals: number;
  wonDeals: number;
  lostDeals: number;
  winRate: number;
  patterns: WinLossPattern[];
  recommendations: Recommendation[];
  signalCorrelations: SignalCorrelation[];
  priorityAccounts: PriorityAccount[];
}

export interface WinLossPattern {
  type: 'win' | 'loss';
  description: string;
  evidence: string;
  impact: 'high' | 'medium' | 'low';
  metric?: string;
}

export interface Recommendation {
  title: string;
  description: string;
  priority: 'critical' | 'important' | 'nice_to_have';
  basedOn: string;
}

export interface SignalCorrelation {
  signalType: string;
  winRate: number;
  avgDealSize: number;
  avgCycleLength: number;
  totalDeals: number;
  insight: string;
}

export interface PriorityAccount {
  company: string;
  score: number;
  reason: string;
  recommendedAction: string;
  buyingWindow: string;
}

const STYLES = `
  .si-wl {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
    max-width: 900px;
  }

  .si-wl-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-wl-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .si-wl-subtitle {
    font-size: 13px;
    color: #64748b;
  }

  /* ---- Stats Strip ---- */

  .si-wl-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .si-wl-stat {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 16px;
    text-align: center;
  }

  .si-wl-stat-value {
    font-size: 28px;
    font-weight: 700;
  }

  .si-wl-stat-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 4px;
  }

  /* ---- Patterns Section ---- */

  .si-wl-section {
    margin-bottom: 24px;
  }

  .si-wl-section-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0 0 12px;
  }

  .si-wl-pattern {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 8px;
    border-left: 3px solid;
  }

  .si-wl-pattern--win { border-left-color: #10b981; }
  .si-wl-pattern--loss { border-left-color: #f59e0b; }

  .si-wl-pattern-desc {
    font-size: 14px;
    font-weight: 500;
    color: #e2e8f0;
    margin-bottom: 6px;
    line-height: 1.4;
  }

  .si-wl-pattern-evidence {
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.5;
  }

  .si-wl-pattern-metric {
    font-size: 11px;
    font-weight: 600;
    color: #3b82f6;
    margin-top: 6px;
  }

  /* ---- Recommendations ---- */

  .si-wl-rec {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 8px;
  }

  .si-wl-rec-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .si-wl-rec-priority {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .si-wl-rec-priority--critical { background: rgba(239,68,68,0.12); color: #f87171; }
  .si-wl-rec-priority--important { background: rgba(59,130,246,0.12); color: #60a5fa; }
  .si-wl-rec-priority--nice_to_have { background: rgba(107,114,128,0.12); color: #9ca3af; }

  .si-wl-rec-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-wl-rec-desc {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
    margin-bottom: 4px;
  }

  .si-wl-rec-basis {
    font-size: 11px;
    color: #475569;
    font-style: italic;
  }

  /* ---- Signal Correlations ---- */

  .si-wl-correlations {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .si-wl-corr {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 1.5fr repeat(3, 1fr) 2fr;
    gap: 12px;
    align-items: center;
    font-size: 12px;
  }

  .si-wl-corr-type {
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-wl-corr-metric {
    text-align: center;
    color: #94a3b8;
  }

  .si-wl-corr-metric strong {
    display: block;
    font-size: 14px;
    color: #e2e8f0;
  }

  .si-wl-corr-insight {
    color: #64748b;
    font-size: 11px;
    line-height: 1.4;
  }

  /* ---- Priority Accounts ---- */

  .si-wl-account {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .si-wl-account:hover { border-color: #334155; }

  .si-wl-account-score {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    flex-shrink: 0;
    border: 2px solid;
  }

  .si-wl-account-info { flex: 1; min-width: 0; }

  .si-wl-account-name {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-wl-account-reason {
    font-size: 12px;
    color: #94a3b8;
    margin-top: 2px;
  }

  .si-wl-account-action {
    font-size: 12px;
    color: #3b82f6;
    flex-shrink: 0;
  }

  .si-wl-account-window {
    font-size: 10px;
    color: #64748b;
    padding: 2px 8px;
    background: #1e293b;
    border-radius: 100px;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .si-wl { padding: 16px; }
    .si-wl-stats { grid-template-columns: repeat(2, 1fr); }
    .si-wl-corr { grid-template-columns: 1fr; gap: 4px; }
  }
`;

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function formatSignalType(type: string): string {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#3b82f6';
  return '#6b7280';
}

export class WinLossInsights {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private data: WinLossData;
  private onCompanyClick: ((company: string) => void) | null = null;

  constructor(data: WinLossData) {
    this.data = data;
    this.root = document.createElement('div');
    this.root.className = 'si-wl';
    this.injectStyles();
    this.buildUI();
  }

  public onCompanySelect(callback: (company: string) => void): void {
    this.onCompanyClick = callback;
  }

  public setData(data: WinLossData): void {
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
    const header = document.createElement('div');
    header.className = 'si-wl-header';
    header.innerHTML = `
      <div>
        <h1 class="si-wl-title">Win/Loss Intelligence</h1>
        <p class="si-wl-subtitle">Data-driven insights from ${this.data.totalDeals} closed deals</p>
      </div>
    `;
    this.root.appendChild(header);

    // Stats
    this.root.appendChild(this.buildStats());

    // Recommendations
    if (this.data.recommendations.length > 0) {
      this.root.appendChild(this.buildRecommendations());
    }

    // Win Patterns
    const winPatterns = this.data.patterns.filter(p => p.type === 'win');
    const lossPatterns = this.data.patterns.filter(p => p.type === 'loss');

    if (winPatterns.length > 0) {
      this.root.appendChild(this.buildPatterns('Why You Win', winPatterns));
    }

    if (lossPatterns.length > 0) {
      this.root.appendChild(this.buildPatterns('Why You Lose', lossPatterns));
    }

    // Signal Correlations
    if (this.data.signalCorrelations.length > 0) {
      this.root.appendChild(this.buildCorrelations());
    }

    // Priority Accounts
    if (this.data.priorityAccounts.length > 0) {
      this.root.appendChild(this.buildPriorityAccounts());
    }
  }

  private buildStats(): HTMLElement {
    const stats = document.createElement('div');
    stats.className = 'si-wl-stats';

    const winRateColor = this.data.winRate >= 40 ? '#10b981' : this.data.winRate >= 25 ? '#f59e0b' : '#ef4444';

    const items = [
      { value: `${this.data.totalDeals}`, label: 'Total Deals', color: '#e2e8f0' },
      { value: `${this.data.wonDeals}`, label: 'Won', color: '#10b981' },
      { value: `${this.data.lostDeals}`, label: 'Lost', color: '#f59e0b' },
      { value: `${this.data.winRate}%`, label: 'Win Rate', color: winRateColor },
    ];

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'si-wl-stat';
      el.innerHTML = `
        <div class="si-wl-stat-value" style="color:${item.color}">${item.value}</div>
        <div class="si-wl-stat-label">${item.label}</div>
      `;
      stats.appendChild(el);
    }

    return stats;
  }

  private buildPatterns(title: string, patterns: WinLossPattern[]): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-wl-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'si-wl-section-title';
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    for (const pattern of patterns) {
      const el = document.createElement('div');
      el.className = `si-wl-pattern si-wl-pattern--${pattern.type}`;
      el.innerHTML = `
        <div class="si-wl-pattern-desc">${pattern.description}</div>
        <div class="si-wl-pattern-evidence">${pattern.evidence}</div>
        ${pattern.metric ? `<div class="si-wl-pattern-metric">${pattern.metric}</div>` : ''}
      `;
      section.appendChild(el);
    }

    return section;
  }

  private buildRecommendations(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-wl-section';

    const title = document.createElement('h3');
    title.className = 'si-wl-section-title';
    title.textContent = 'Actionable Recommendations';
    section.appendChild(title);

    for (const rec of this.data.recommendations) {
      const el = document.createElement('div');
      el.className = 'si-wl-rec';
      el.innerHTML = `
        <div class="si-wl-rec-header">
          <span class="si-wl-rec-priority si-wl-rec-priority--${rec.priority}">${rec.priority.replace(/_/g, ' ')}</span>
          <span class="si-wl-rec-title">${rec.title}</span>
        </div>
        <div class="si-wl-rec-desc">${rec.description}</div>
        <div class="si-wl-rec-basis">Based on: ${rec.basedOn}</div>
      `;
      section.appendChild(el);
    }

    return section;
  }

  private buildCorrelations(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-wl-section';

    const title = document.createElement('h3');
    title.className = 'si-wl-section-title';
    title.textContent = 'Signal-to-Outcome Correlations';
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'si-wl-correlations';

    for (const corr of this.data.signalCorrelations) {
      const el = document.createElement('div');
      el.className = 'si-wl-corr';
      el.innerHTML = `
        <span class="si-wl-corr-type">${formatSignalType(corr.signalType)}</span>
        <div class="si-wl-corr-metric"><strong>${corr.winRate}%</strong>Win Rate</div>
        <div class="si-wl-corr-metric"><strong>${formatCurrency(corr.avgDealSize)}</strong>Avg Deal</div>
        <div class="si-wl-corr-metric"><strong>${corr.avgCycleLength}d</strong>Avg Cycle</div>
        <div class="si-wl-corr-insight">${corr.insight}</div>
      `;
      list.appendChild(el);
    }

    section.appendChild(list);
    return section;
  }

  private buildPriorityAccounts(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-wl-section';

    const title = document.createElement('h3');
    title.className = 'si-wl-section-title';
    title.textContent = 'Priority Accounts This Week';
    section.appendChild(title);

    for (const account of this.data.priorityAccounts) {
      const color = scoreColor(account.score);
      const el = document.createElement('div');
      el.className = 'si-wl-account';
      el.innerHTML = `
        <div class="si-wl-account-score" style="border-color:${color};color:${color};background:${color}10">${account.score}</div>
        <div class="si-wl-account-info">
          <div class="si-wl-account-name">${account.company}</div>
          <div class="si-wl-account-reason">${account.reason}</div>
        </div>
        <span class="si-wl-account-window">${account.buyingWindow}</span>
        <span class="si-wl-account-action">${account.recommendedAction}</span>
      `;
      el.addEventListener('click', () => this.onCompanyClick?.(account.company));
      section.appendChild(el);
    }

    return section;
  }
}
