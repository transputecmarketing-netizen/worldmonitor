/**
 * Pipeline Dashboard — Kanban board + deal cards + revenue forecasting
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-pipeline-styles';

const PIPELINE_STAGES = [
  { id: 'prospecting', label: 'Prospecting', color: '#6b7280', probability: 10 },
  { id: 'qualification', label: 'Qualification', color: '#8b5cf6', probability: 20 },
  { id: 'discovery', label: 'Discovery', color: '#3b82f6', probability: 40 },
  { id: 'proposal', label: 'Proposal', color: '#f59e0b', probability: 60 },
  { id: 'negotiation', label: 'Negotiation', color: '#f97316', probability: 80 },
  { id: 'closed_won', label: 'Closed Won', color: '#10b981', probability: 100 },
  { id: 'closed_lost', label: 'Closed Lost', color: '#ef4444', probability: 0 },
] as const;

type PipelineStageId = typeof PIPELINE_STAGES[number]['id'];

export interface PipelineDeal {
  id: string;
  company: string;
  contactName: string;
  dealValue: number;
  stage: PipelineStageId;
  probability: number;
  expectedCloseDate: string;
  signals: number;
  healthScore: number;
  tags: string[];
  daysInStage: number;
}

interface ForecastData {
  committed: number;
  bestCase: number;
  expected: number;
  pipeline: number;
  quota: number;
}

const STYLES = `
  .si-pipeline {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
  }

  .si-pipeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-pipeline-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .si-pipeline-actions {
    display: flex;
    gap: 8px;
  }

  .si-pipeline-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #1E293B;
    background: #0f172a;
    color: #e2e8f0;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .si-pipeline-btn:hover {
    background: #1e293b;
  }

  .si-pipeline-btn--primary {
    background: #3B82F6;
    border-color: #3B82F6;
    color: #fff;
  }

  .si-pipeline-btn--primary:hover {
    background: #2563EB;
  }

  /* ---- Forecast Strip ---- */

  .si-forecast-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }

  .si-forecast-card {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 16px;
    text-align: center;
  }

  .si-forecast-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    margin-bottom: 8px;
  }

  .si-forecast-value {
    font-size: 22px;
    font-weight: 700;
    color: #e2e8f0;
  }

  .si-forecast-sub {
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
  }

  .si-forecast-bar {
    width: 100%;
    height: 4px;
    background: #1e293b;
    border-radius: 2px;
    margin-top: 10px;
    overflow: hidden;
  }

  .si-forecast-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  /* ---- Kanban Board ---- */

  .si-kanban {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 16px;
    min-height: 400px;
  }

  .si-kanban::-webkit-scrollbar {
    height: 6px;
  }

  .si-kanban::-webkit-scrollbar-track {
    background: #0A0F1C;
    border-radius: 3px;
  }

  .si-kanban::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 3px;
  }

  .si-kanban-column {
    min-width: 260px;
    max-width: 280px;
    flex-shrink: 0;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid #1E293B;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    max-height: 600px;
  }

  .si-kanban-column-header {
    padding: 12px 16px;
    border-bottom: 1px solid #1E293B;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .si-kanban-column-title {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .si-kanban-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .si-kanban-count {
    font-size: 11px;
    color: #64748b;
    background: #1e293b;
    padding: 2px 8px;
    border-radius: 100px;
  }

  .si-kanban-column-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }

  .si-kanban-column-body::-webkit-scrollbar {
    width: 4px;
  }

  .si-kanban-column-body::-webkit-scrollbar-thumb {
    background: #334155;
    border-radius: 2px;
  }

  .si-kanban-column-footer {
    padding: 8px 16px;
    border-top: 1px solid #1E293B;
    font-size: 11px;
    color: #64748b;
    flex-shrink: 0;
  }

  /* ---- Deal Card ---- */

  .si-deal-card {
    background: #0A0F1C;
    border: 1px solid #1E293B;
    border-radius: 8px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .si-deal-card:hover {
    border-color: #334155;
    transform: translateY(-1px);
  }

  .si-deal-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .si-deal-company {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .si-deal-value {
    font-size: 13px;
    font-weight: 600;
    color: #10b981;
  }

  .si-deal-contact {
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .si-deal-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .si-deal-signals {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #3b82f6;
    background: rgba(59, 130, 246, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .si-deal-health {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .si-deal-health--hot {
    color: #f97316;
    background: rgba(249, 115, 22, 0.1);
  }

  .si-deal-health--warm {
    color: #eab308;
    background: rgba(234, 179, 8, 0.1);
  }

  .si-deal-health--cold {
    color: #6b7280;
    background: rgba(107, 114, 128, 0.1);
  }

  .si-deal-close-date {
    font-size: 10px;
    color: #64748b;
  }

  .si-deal-tags {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .si-deal-tag {
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(59, 130, 246, 0.08);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.15);
  }

  .si-deal-days {
    font-size: 10px;
    color: #64748b;
    margin-top: 6px;
  }

  /* ---- Pipeline Summary Bar ---- */

  .si-pipeline-summary {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 24px;
    background: #1e293b;
  }

  .si-pipeline-summary-segment {
    transition: width 0.5s ease;
    min-width: 2px;
  }

  /* ---- Empty State ---- */

  .si-kanban-empty {
    text-align: center;
    padding: 32px 16px;
    color: #475569;
    font-size: 12px;
  }

  /* ---- Responsive ---- */

  @media (max-width: 768px) {
    .si-pipeline {
      padding: 16px;
    }

    .si-kanban-column {
      min-width: 240px;
    }

    .si-forecast-strip {
      grid-template-columns: repeat(2, 1fr);
    }
  }
`;

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

function getHealthClass(score: number): string {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

function getHealthLabel(score: number): string {
  if (score >= 85) return 'On Fire';
  if (score >= 70) return 'Hot';
  if (score >= 50) return 'Warm';
  if (score >= 30) return 'Warming';
  return 'Cold';
}

// Deals loaded dynamically from deal-pipeline service
const INITIAL_DEALS: PipelineDeal[] = [];

const INITIAL_FORECAST: ForecastData = {
  committed: 0,
  bestCase: 0,
  expected: 0,
  pipeline: 0,
  quota: 0,
};

export class PipelineDashboard {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private deals: PipelineDeal[] = INITIAL_DEALS;
  private forecast: ForecastData = INITIAL_FORECAST;
  private onDealClick: ((dealId: string) => void) | null = null;
  private onCreateDeal: (() => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'si-pipeline';
    this.injectStyles();
    this.buildUI();
  }

  public onDealSelect(callback: (dealId: string) => void): void {
    this.onDealClick = callback;
  }

  public onNewDeal(callback: () => void): void {
    this.onCreateDeal = callback;
  }

  public setDeals(deals: PipelineDeal[]): void {
    this.deals = deals;
    this.buildUI();
  }

  public setForecast(forecast: ForecastData): void {
    this.forecast = forecast;
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
    header.className = 'si-pipeline-header';
    header.innerHTML = `
      <h1 class="si-pipeline-title">Deal Pipeline</h1>
      <div class="si-pipeline-actions">
        <button class="si-pipeline-btn">Export</button>
        <button class="si-pipeline-btn si-pipeline-btn--primary" id="si-new-deal-btn">+ New Deal</button>
      </div>
    `;
    header.querySelector('#si-new-deal-btn')?.addEventListener('click', () => this.onCreateDeal?.());
    this.root.appendChild(header);

    // Forecast Strip
    this.root.appendChild(this.buildForecastStrip());

    // Pipeline Summary Bar
    this.root.appendChild(this.buildSummaryBar());

    // Kanban Board
    this.root.appendChild(this.buildKanban());
  }

  private buildForecastStrip(): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'si-forecast-strip';

    const { committed, bestCase, expected, pipeline, quota } = this.forecast;
    const attainment = quota > 0 ? Math.round((expected / quota) * 100) : 0;

    const cards = [
      { label: 'Pipeline', value: formatCurrency(pipeline), sub: `${this.deals.filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length} open deals`, bar: 1, barColor: '#3b82f6' },
      { label: 'Committed', value: formatCurrency(committed), sub: 'Negotiation+', bar: quota > 0 ? committed / quota : 0, barColor: '#f97316' },
      { label: 'Expected', value: formatCurrency(expected), sub: 'Weighted value', bar: quota > 0 ? expected / quota : 0, barColor: '#8b5cf6' },
      { label: 'Best Case', value: formatCurrency(bestCase), sub: 'All open value', bar: quota > 0 ? bestCase / quota : 0, barColor: '#10b981' },
      { label: 'Quota Attainment', value: `${attainment}%`, sub: `Quota: ${formatCurrency(quota)}`, bar: Math.min(1, attainment / 100), barColor: attainment >= 100 ? '#10b981' : attainment >= 70 ? '#eab308' : '#ef4444' },
    ];

    for (const card of cards) {
      const el = document.createElement('div');
      el.className = 'si-forecast-card';
      el.innerHTML = `
        <div class="si-forecast-label">${card.label}</div>
        <div class="si-forecast-value">${card.value}</div>
        <div class="si-forecast-sub">${card.sub}</div>
        <div class="si-forecast-bar">
          <div class="si-forecast-bar-fill" style="width:${Math.round(card.bar * 100)}%;background:${card.barColor}"></div>
        </div>
      `;
      strip.appendChild(el);
    }

    return strip;
  }

  private buildSummaryBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'si-pipeline-summary';

    const totalValue = this.deals.reduce((sum, d) => sum + d.dealValue, 0) || 1;

    for (const stage of PIPELINE_STAGES) {
      const stageDeals = this.deals.filter(d => d.stage === stage.id);
      const stageValue = stageDeals.reduce((sum, d) => sum + d.dealValue, 0);
      const pct = (stageValue / totalValue) * 100;

      if (pct > 0) {
        const segment = document.createElement('div');
        segment.className = 'si-pipeline-summary-segment';
        segment.style.width = `${pct}%`;
        segment.style.background = stage.color;
        segment.title = `${stage.label}: ${formatCurrency(stageValue)} (${stageDeals.length} deals)`;
        bar.appendChild(segment);
      }
    }

    return bar;
  }

  private buildKanban(): HTMLElement {
    const kanban = document.createElement('div');
    kanban.className = 'si-kanban';

    for (const stage of PIPELINE_STAGES) {
      const stageDeals = this.deals.filter(d => d.stage === stage.id);
      const stageValue = stageDeals.reduce((sum, d) => sum + d.dealValue, 0);

      const column = document.createElement('div');
      column.className = 'si-kanban-column';

      // Column header
      const colHeader = document.createElement('div');
      colHeader.className = 'si-kanban-column-header';
      colHeader.innerHTML = `
        <div class="si-kanban-column-title">
          <span class="si-kanban-dot" style="background:${stage.color}"></span>
          ${stage.label}
        </div>
        <span class="si-kanban-count">${stageDeals.length}</span>
      `;
      column.appendChild(colHeader);

      // Column body
      const colBody = document.createElement('div');
      colBody.className = 'si-kanban-column-body';

      if (stageDeals.length === 0) {
        colBody.innerHTML = '<div class="si-kanban-empty">No deals</div>';
      } else {
        for (const deal of stageDeals) {
          colBody.appendChild(this.buildDealCard(deal));
        }
      }
      column.appendChild(colBody);

      // Column footer
      const colFooter = document.createElement('div');
      colFooter.className = 'si-kanban-column-footer';
      colFooter.textContent = `Total: ${formatCurrency(stageValue)}`;
      column.appendChild(colFooter);

      kanban.appendChild(column);
    }

    return kanban;
  }

  private buildDealCard(deal: PipelineDeal): HTMLElement {
    const card = document.createElement('div');
    card.className = 'si-deal-card';
    card.addEventListener('click', () => this.onDealClick?.(deal.id));

    const healthClass = getHealthClass(deal.healthScore);
    const healthLabel = getHealthLabel(deal.healthScore);

    card.innerHTML = `
      <div class="si-deal-card-top">
        <div class="si-deal-company">${deal.company}</div>
        <div class="si-deal-value">${formatCurrency(deal.dealValue)}</div>
      </div>
      <div class="si-deal-contact">${deal.contactName}</div>
      <div class="si-deal-meta">
        <span class="si-deal-signals">${deal.signals} signals</span>
        <span class="si-deal-health si-deal-health--${healthClass}">${healthLabel}</span>
      </div>
      <div class="si-deal-meta" style="margin-top:6px">
        <span class="si-deal-close-date">Close: ${new Date(deal.expectedCloseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span class="si-deal-close-date">${deal.probability}% prob.</span>
      </div>
      ${deal.tags.length > 0 ? `
        <div class="si-deal-tags">
          ${deal.tags.map(t => `<span class="si-deal-tag">${t}</span>`).join('')}
        </div>
      ` : ''}
      ${deal.daysInStage > 0 ? `<div class="si-deal-days">${deal.daysInStage}d in stage</div>` : ''}
    `;

    return card;
  }
}
