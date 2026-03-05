/**
 * Analytics Dashboard — Revenue intelligence, pipeline metrics,
 * conversion tracking, and AI-generated insights.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-analytics-styles';

export interface AnalyticsData {
  // KPIs
  pipelineValue: number;
  weightedPipeline: number;
  winRate: number;
  winRateTrend: number; // percentage change
  avgDealSize: number;
  avgCycleLength: number; // days
  dealsWon: number;
  revenueWon: number;

  // Funnel
  funnel: Array<{ stage: string; count: number; value: number; conversionRate: number }>;

  // Signal ROI
  signalROI: Array<{ signalType: string; dealsInfluenced: number; revenue: number; conversionRate: number }>;

  // Rep Leaderboard
  reps: Array<{ name: string; dealsWon: number; revenue: number; winRate: number; avgCycle: number }>;

  // Insights
  insights: string[];

  // Trends
  revenueTrend: Array<{ date: string; value: number }>;
}

const STYLES = `
  .si-analytics {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
  }

  .si-analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-analytics-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .si-analytics-period {
    font-size: 12px;
    color: #64748b;
    padding: 6px 14px;
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 8px;
  }

  /* ---- KPI Grid ---- */

  .si-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }

  .si-kpi {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 16px;
  }

  .si-kpi-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .si-kpi-value {
    font-size: 24px;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 4px;
  }

  .si-kpi-trend {
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .si-kpi-trend--up { color: #34d399; }
  .si-kpi-trend--down { color: #f87171; }
  .si-kpi-trend--flat { color: #64748b; }

  /* ---- Two Column Layout ---- */

  .si-analytics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  @media (max-width: 900px) {
    .si-analytics-grid { grid-template-columns: 1fr; }
  }

  /* ---- Section Card ---- */

  .si-analytics-card {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 20px;
  }

  .si-analytics-card-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0 0 16px;
  }

  /* ---- Funnel Visualization ---- */

  .si-funnel-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .si-funnel-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .si-funnel-row-label {
    width: 100px;
    font-size: 12px;
    color: #94a3b8;
    text-align: right;
    flex-shrink: 0;
  }

  .si-funnel-row-bar-bg {
    flex: 1;
    height: 28px;
    background: #1e293b;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }

  .si-funnel-row-bar {
    height: 100%;
    border-radius: 6px;
    transition: width 0.5s ease;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    min-width: fit-content;
  }

  .si-funnel-row-meta {
    width: 70px;
    font-size: 11px;
    color: #64748b;
    flex-shrink: 0;
    text-align: right;
  }

  /* ---- Signal ROI ---- */

  .si-roi-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .si-roi-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(30,41,59,0.5);
  }

  .si-roi-row:last-child {
    border-bottom: none;
  }

  .si-roi-type {
    font-size: 12px;
    color: #e2e8f0;
    font-weight: 500;
    min-width: 120px;
  }

  .si-roi-deals {
    font-size: 12px;
    color: #64748b;
  }

  .si-roi-revenue {
    font-size: 12px;
    font-weight: 600;
    color: #34d399;
    min-width: 70px;
    text-align: right;
  }

  .si-roi-conv {
    font-size: 11px;
    color: #3b82f6;
    min-width: 50px;
    text-align: right;
  }

  /* ---- Rep Leaderboard ---- */

  .si-leaderboard {
    width: 100%;
  }

  .si-leaderboard-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(30,41,59,0.5);
  }

  .si-leaderboard-row:last-child { border-bottom: none; }

  .si-leaderboard-rank {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .si-leaderboard-rank-1 { background: rgba(234,179,8,0.15); color: #fbbf24; }
  .si-leaderboard-rank-2 { background: rgba(148,163,184,0.15); color: #94a3b8; }
  .si-leaderboard-rank-3 { background: rgba(180,83,9,0.15); color: #d97706; }
  .si-leaderboard-rank-default { background: #1e293b; color: #64748b; }

  .si-leaderboard-name {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: #e2e8f0;
  }

  .si-leaderboard-stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #94a3b8;
  }

  .si-leaderboard-stats strong {
    color: #e2e8f0;
  }

  /* ---- Insights ---- */

  .si-insights {
    margin-bottom: 24px;
  }

  .si-insights-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .si-insight {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.5;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .si-insight-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(139,92,246,0.15);
    color: #a78bfa;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    margin-top: 1px;
  }

  /* ---- Mini Sparkline ---- */

  .si-mini-chart {
    height: 60px;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding-top: 8px;
  }

  .si-mini-bar {
    flex: 1;
    border-radius: 2px 2px 0 0;
    transition: height 0.3s ease;
    min-width: 4px;
  }

  /* ---- Responsive ---- */

  @media (max-width: 768px) {
    .si-analytics { padding: 16px; }
    .si-kpi-grid { grid-template-columns: repeat(2, 1fr); }
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

// Analytics loaded dynamically from revenue-analytics service — starts empty
const INITIAL_ANALYTICS: AnalyticsData = {
  pipelineValue: 0,
  weightedPipeline: 0,
  winRate: 0,
  winRateTrend: 0,
  avgDealSize: 0,
  avgCycleLength: 0,
  dealsWon: 0,
  revenueWon: 0,
  funnel: [],
  signalROI: [],
  reps: [],
  insights: ['Loading analytics data...'],
  revenueTrend: [],
};

const FUNNEL_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#f97316', '#10b981'];

export class AnalyticsDashboard {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private data: AnalyticsData = INITIAL_ANALYTICS;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'si-analytics';
    this.injectStyles();
    this.buildUI();
  }

  public setData(data: AnalyticsData): void {
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
    header.className = 'si-analytics-header';
    header.innerHTML = `
      <h1 class="si-analytics-title">Revenue Intelligence</h1>
      <span class="si-analytics-period">Last 90 days</span>
    `;
    this.root.appendChild(header);

    // KPI Grid
    this.root.appendChild(this.buildKPIs());

    // AI Insights
    this.root.appendChild(this.buildInsights());

    // Two-column: Funnel + Signal ROI
    const grid1 = document.createElement('div');
    grid1.className = 'si-analytics-grid';
    grid1.appendChild(this.buildFunnel());
    grid1.appendChild(this.buildSignalROI());
    this.root.appendChild(grid1);

    // Two-column: Revenue Trend + Leaderboard
    const grid2 = document.createElement('div');
    grid2.className = 'si-analytics-grid';
    grid2.appendChild(this.buildRevenueTrend());
    grid2.appendChild(this.buildLeaderboard());
    this.root.appendChild(grid2);
  }

  private buildKPIs(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'si-kpi-grid';

    const kpis = [
      { label: 'Pipeline Value', value: formatCurrency(this.data.pipelineValue), trend: 12, trendLabel: 'vs last quarter' },
      { label: 'Weighted Pipeline', value: formatCurrency(this.data.weightedPipeline), trend: 8, trendLabel: 'vs last quarter' },
      { label: 'Win Rate', value: `${this.data.winRate}%`, trend: this.data.winRateTrend, trendLabel: 'vs last quarter' },
      { label: 'Avg Deal Size', value: formatCurrency(this.data.avgDealSize), trend: 5, trendLabel: 'vs last quarter' },
      { label: 'Avg Cycle', value: `${this.data.avgCycleLength}d`, trend: -3, trendLabel: 'days shorter' },
      { label: 'Revenue Won', value: formatCurrency(this.data.revenueWon), trend: 15, trendLabel: 'vs last quarter' },
    ];

    for (const kpi of kpis) {
      const card = document.createElement('div');
      card.className = 'si-kpi';

      const trendClass = kpi.trend > 0 ? 'up' : kpi.trend < 0 ? 'down' : 'flat';
      const trendArrow = kpi.trend > 0 ? '&#9650;' : kpi.trend < 0 ? '&#9660;' : '&#8722;';

      card.innerHTML = `
        <div class="si-kpi-label">${kpi.label}</div>
        <div class="si-kpi-value">${kpi.value}</div>
        <span class="si-kpi-trend si-kpi-trend--${trendClass}">
          ${trendArrow} ${Math.abs(kpi.trend)}% ${kpi.trendLabel}
        </span>
      `;
      grid.appendChild(card);
    }

    return grid;
  }

  private buildInsights(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-insights';

    const list = document.createElement('div');
    list.className = 'si-insights-list';

    for (const insight of this.data.insights) {
      const item = document.createElement('div');
      item.className = 'si-insight';
      item.innerHTML = `
        <span class="si-insight-icon">AI</span>
        <span>${insight}</span>
      `;
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }

  private buildFunnel(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'si-analytics-card';

    const title = document.createElement('h3');
    title.className = 'si-analytics-card-title';
    title.textContent = 'Conversion Funnel';
    card.appendChild(title);

    const rows = document.createElement('div');
    rows.className = 'si-funnel-rows';

    const maxCount = Math.max(...this.data.funnel.map(f => f.count), 1);

    this.data.funnel.forEach((stage, i) => {
      const row = document.createElement('div');
      row.className = 'si-funnel-row';

      const pct = (stage.count / maxCount) * 100;
      const color = FUNNEL_COLORS[i % FUNNEL_COLORS.length]!;

      row.innerHTML = `
        <div class="si-funnel-row-label">${stage.stage}</div>
        <div class="si-funnel-row-bar-bg">
          <div class="si-funnel-row-bar" style="width:${pct}%;background:${color}">${stage.count}</div>
        </div>
        <div class="si-funnel-row-meta">${stage.conversionRate}%</div>
      `;
      rows.appendChild(row);
    });

    card.appendChild(rows);
    return card;
  }

  private buildSignalROI(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'si-analytics-card';

    const title = document.createElement('h3');
    title.className = 'si-analytics-card-title';
    title.textContent = 'Signal ROI';
    card.appendChild(title);

    const rows = document.createElement('div');
    rows.className = 'si-roi-rows';

    for (const signal of this.data.signalROI) {
      const row = document.createElement('div');
      row.className = 'si-roi-row';
      row.innerHTML = `
        <span class="si-roi-type">${formatSignalType(signal.signalType)}</span>
        <span class="si-roi-deals">${signal.dealsInfluenced} deals</span>
        <span class="si-roi-revenue">${formatCurrency(signal.revenue)}</span>
        <span class="si-roi-conv">${signal.conversionRate}%</span>
      `;
      rows.appendChild(row);
    }

    card.appendChild(rows);
    return card;
  }

  private buildRevenueTrend(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'si-analytics-card';

    const title = document.createElement('h3');
    title.className = 'si-analytics-card-title';
    title.textContent = 'Weekly Revenue Trend';
    card.appendChild(title);

    const chart = document.createElement('div');
    chart.className = 'si-mini-chart';

    const maxValue = Math.max(...this.data.revenueTrend.map(d => d.value), 1);

    for (const point of this.data.revenueTrend) {
      const bar = document.createElement('div');
      bar.className = 'si-mini-bar';
      const height = Math.max(4, (point.value / maxValue) * 52);
      bar.style.height = `${height}px`;
      bar.style.background = '#3b82f6';
      bar.title = `${point.date}: ${formatCurrency(point.value)}`;
      chart.appendChild(bar);
    }

    card.appendChild(chart);
    return card;
  }

  private buildLeaderboard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'si-analytics-card';

    const title = document.createElement('h3');
    title.className = 'si-analytics-card-title';
    title.textContent = 'Rep Leaderboard';
    card.appendChild(title);

    const board = document.createElement('div');
    board.className = 'si-leaderboard';

    this.data.reps.forEach((rep, i) => {
      const row = document.createElement('div');
      row.className = 'si-leaderboard-row';

      const rankClass = i === 0 ? '1' : i === 1 ? '2' : i === 2 ? '3' : 'default';

      row.innerHTML = `
        <div class="si-leaderboard-rank si-leaderboard-rank-${rankClass}">${i + 1}</div>
        <div class="si-leaderboard-name">${rep.name}</div>
        <div class="si-leaderboard-stats">
          <span><strong>${rep.dealsWon}</strong> won</span>
          <span><strong>${formatCurrency(rep.revenue)}</strong></span>
          <span><strong>${rep.winRate}%</strong> WR</span>
        </div>
      `;
      board.appendChild(row);
    });

    card.appendChild(board);
    return card;
  }
}
