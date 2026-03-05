/**
 * Territory View — Structured account territory view grouped by tier
 * with aggregate signal health and buying window indicators.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-territory-styles';

export interface TerritoryData {
  repName: string;
  totalAccounts: number;
  activeSignals: number;
  pipelineValue: number;
  territories: TerritoryGroup[];
  comparison?: TerritoryComparison[];
}

export interface TerritoryGroup {
  tier: 1 | 2 | 3;
  tierLabel: string;
  accounts: TerritoryAccount[];
}

export interface TerritoryAccount {
  company: string;
  domain?: string;
  industry: string;
  healthScore: number;
  propensityScore: number;
  signalCount: number;
  buyingWindow: string;
  lastSignal: string;
  lastSignalDate: string;
  dealValue?: number;
  dealStage?: string;
}

export interface TerritoryComparison {
  repName: string;
  accountCount: number;
  avgHealth: number;
  highIntentAccounts: number;
  closingThisMonth: number;
  pipelineValue: number;
}

const STYLES = `
  .si-territory {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
  }

  .si-territory-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-territory-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .si-territory-stats {
    display: flex;
    gap: 24px;
  }

  .si-territory-stat {
    font-size: 13px;
    color: #94a3b8;
  }

  .si-territory-stat strong {
    color: #e2e8f0;
    font-weight: 600;
  }

  /* ---- Tier Groups ---- */

  .si-tier-group {
    margin-bottom: 24px;
  }

  .si-tier-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1E293B;
  }

  .si-tier-badge {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .si-tier-badge--1 { background: rgba(234,179,8,0.15); color: #fbbf24; }
  .si-tier-badge--2 { background: rgba(59,130,246,0.15); color: #60a5fa; }
  .si-tier-badge--3 { background: rgba(107,114,128,0.15); color: #9ca3af; }

  .si-tier-label {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-tier-count {
    font-size: 12px;
    color: #64748b;
  }

  /* ---- Account Row ---- */

  .si-territory-account {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 6px;
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1.5fr;
    gap: 12px;
    align-items: center;
    cursor: pointer;
    transition: border-color 0.15s;
    font-size: 12px;
  }

  .si-territory-account:hover { border-color: #334155; }

  .si-territory-account-name {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-territory-account-industry {
    font-size: 11px;
    color: #64748b;
    margin-top: 2px;
  }

  .si-territory-score {
    text-align: center;
    font-weight: 600;
  }

  .si-territory-signals {
    text-align: center;
    color: #94a3b8;
  }

  .si-territory-window {
    text-align: center;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 100px;
    font-weight: 500;
  }

  .si-territory-window--urgent { background: rgba(239,68,68,0.12); color: #f87171; }
  .si-territory-window--soon { background: rgba(245,158,11,0.12); color: #fbbf24; }
  .si-territory-window--later { background: rgba(59,130,246,0.12); color: #60a5fa; }
  .si-territory-window--monitor { background: rgba(107,114,128,0.12); color: #9ca3af; }

  .si-territory-last-signal {
    font-size: 11px;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .si-territory-last-date {
    font-size: 10px;
    color: #475569;
    margin-top: 2px;
  }

  /* ---- Comparison Table ---- */

  .si-territory-comparison {
    margin-top: 24px;
  }

  .si-territory-comparison-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 12px;
  }

  .si-territory-comp-row {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 6px;
    display: grid;
    grid-template-columns: 2fr repeat(5, 1fr);
    gap: 12px;
    align-items: center;
    font-size: 12px;
  }

  .si-territory-comp-name {
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-territory-comp-metric {
    text-align: center;
    color: #94a3b8;
  }

  .si-territory-comp-metric strong {
    display: block;
    color: #e2e8f0;
    font-size: 14px;
  }

  /* ---- Column Headers ---- */

  .si-territory-col-headers {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1.5fr;
    gap: 12px;
    padding: 0 16px 8px;
    font-size: 10px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .si-territory-col-header--center { text-align: center; }

  @media (max-width: 900px) {
    .si-territory { padding: 16px; }
    .si-territory-account,
    .si-territory-col-headers { grid-template-columns: 1.5fr 1fr 1fr 1fr; }
    .si-territory-account > *:nth-child(n+5),
    .si-territory-col-headers > *:nth-child(n+5) { display: none; }
  }
`;

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function scoreColor(score: number): string {
  if (score >= 75) return '#10b981';
  if (score >= 50) return '#f59e0b';
  if (score >= 25) return '#3b82f6';
  return '#6b7280';
}

function windowClass(window: string): string {
  if (window.includes('0-30') || window.includes('closing')) return 'urgent';
  if (window.includes('30-60') || window.includes('1-3')) return 'soon';
  if (window.includes('60-90') || window.includes('3-6')) return 'later';
  return 'monitor';
}

export class TerritoryView {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private data: TerritoryData;
  private onCompanyClick: ((company: string) => void) | null = null;

  constructor(data: TerritoryData) {
    this.data = data;
    this.root = document.createElement('div');
    this.root.className = 'si-territory';
    this.injectStyles();
    this.buildUI();
  }

  public onCompanySelect(callback: (company: string) => void): void {
    this.onCompanyClick = callback;
  }

  public setData(data: TerritoryData): void {
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
    header.className = 'si-territory-header';
    header.innerHTML = `
      <div>
        <h1 class="si-territory-title">${this.data.repName}'s Territory</h1>
      </div>
      <div class="si-territory-stats">
        <span class="si-territory-stat"><strong>${this.data.totalAccounts}</strong> accounts</span>
        <span class="si-territory-stat"><strong>${this.data.activeSignals}</strong> active signals</span>
        <span class="si-territory-stat"><strong>${formatCurrency(this.data.pipelineValue)}</strong> pipeline</span>
      </div>
    `;
    this.root.appendChild(header);

    // Column headers
    const colHeaders = document.createElement('div');
    colHeaders.className = 'si-territory-col-headers';
    colHeaders.innerHTML = `
      <span>Account</span>
      <span class="si-territory-col-header--center">Health</span>
      <span class="si-territory-col-header--center">Propensity</span>
      <span class="si-territory-col-header--center">Signals</span>
      <span class="si-territory-col-header--center">Window</span>
      <span>Last Signal</span>
    `;
    this.root.appendChild(colHeaders);

    // Tier groups
    for (const group of this.data.territories) {
      this.root.appendChild(this.buildTierGroup(group));
    }

    // Comparison table
    if (this.data.comparison && this.data.comparison.length > 0) {
      this.root.appendChild(this.buildComparison());
    }
  }

  private buildTierGroup(group: TerritoryGroup): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-tier-group';

    const header = document.createElement('div');
    header.className = 'si-tier-header';
    header.innerHTML = `
      <span class="si-tier-badge si-tier-badge--${group.tier}">T${group.tier}</span>
      <span class="si-tier-label">${group.tierLabel}</span>
      <span class="si-tier-count">${group.accounts.length} accounts</span>
    `;
    section.appendChild(header);

    for (const account of group.accounts) {
      const row = document.createElement('div');
      row.className = 'si-territory-account';
      row.addEventListener('click', () => this.onCompanyClick?.(account.company));

      const hColor = scoreColor(account.healthScore);
      const pColor = scoreColor(account.propensityScore);
      const wClass = windowClass(account.buyingWindow);

      row.innerHTML = `
        <div>
          <div class="si-territory-account-name">${account.company}</div>
          <div class="si-territory-account-industry">${account.industry}</div>
        </div>
        <div class="si-territory-score" style="color:${hColor}">${account.healthScore}</div>
        <div class="si-territory-score" style="color:${pColor}">${account.propensityScore}</div>
        <div class="si-territory-signals">${account.signalCount}</div>
        <div><span class="si-territory-window si-territory-window--${wClass}">${account.buyingWindow}</span></div>
        <div>
          <div class="si-territory-last-signal">${account.lastSignal}</div>
          <div class="si-territory-last-date">${account.lastSignalDate}</div>
        </div>
      `;

      section.appendChild(row);
    }

    return section;
  }

  private buildComparison(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-territory-comparison';

    const title = document.createElement('div');
    title.className = 'si-territory-comparison-title';
    title.textContent = 'Territory Comparison';
    section.appendChild(title);

    for (const rep of this.data.comparison!) {
      const row = document.createElement('div');
      row.className = 'si-territory-comp-row';
      row.innerHTML = `
        <span class="si-territory-comp-name">${rep.repName}</span>
        <div class="si-territory-comp-metric"><strong>${rep.accountCount}</strong>Accounts</div>
        <div class="si-territory-comp-metric"><strong>${rep.avgHealth}</strong>Avg Health</div>
        <div class="si-territory-comp-metric"><strong>${rep.highIntentAccounts}</strong>High Intent</div>
        <div class="si-territory-comp-metric"><strong>${rep.closingThisMonth}</strong>Closing Soon</div>
        <div class="si-territory-comp-metric"><strong>${formatCurrency(rep.pipelineValue)}</strong>Pipeline</div>
      `;
      section.appendChild(row);
    }

    return section;
  }
}
