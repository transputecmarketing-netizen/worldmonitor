/**
 * Competitive Battlecard — Side-by-side comparison, strengths/weaknesses,
 * win strategies, and objection handling.
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-battlecard-styles';

export interface BattlecardData {
  competitorName: string;
  competitorDomain?: string;
  marketPosition: 'leader' | 'challenger' | 'niche' | 'emerging';
  ourProduct: string;
  overview: string;
  differentiators: Array<{
    feature: string;
    ours: string;
    theirs: string;
    advantage: 'us' | 'them' | 'tie';
  }>;
  headToHead: Array<{
    category: string;
    feature: string;
    us: boolean | string;
    them: boolean | string;
  }>;
  objections: Array<{
    objection: string;
    response: string;
    evidence?: string;
  }>;
  winStrategies: string[];
  loseReasons: string[];
  talkTrack: string;
  positioning: string;
  winRate: number;
  totalDeals: number;
  avgDealSize: number;
  testimonials: Array<{
    company: string;
    quote: string;
    role: string;
  }>;
}

const STYLES = `
  .si-battlecard {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
    max-width: 1000px;
  }

  .si-bc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-bc-title-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .si-bc-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .si-bc-vs {
    font-size: 13px;
    color: #64748b;
    padding: 4px 12px;
    background: #1e293b;
    border-radius: 100px;
  }

  .si-bc-position {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 100px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .si-bc-position--leader { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
  .si-bc-position--challenger { background: rgba(249,115,22,0.12); color: #fb923c; border: 1px solid rgba(249,115,22,0.2); }
  .si-bc-position--niche { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.2); }
  .si-bc-position--emerging { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }

  /* ---- Win Rate Stats ---- */

  .si-bc-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .si-bc-stat {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 16px;
    text-align: center;
  }

  .si-bc-stat-value {
    font-size: 24px;
    font-weight: 700;
  }

  .si-bc-stat-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 4px;
  }

  /* ---- Section ---- */

  .si-bc-section {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }

  .si-bc-section-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0 0 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .si-bc-section-icon {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
  }

  /* ---- Comparison Table ---- */

  .si-bc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .si-bc-table th {
    text-align: left;
    padding: 8px 12px;
    font-weight: 600;
    color: #94a3b8;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #1E293B;
  }

  .si-bc-table td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(30,41,59,0.5);
    vertical-align: top;
  }

  .si-bc-table tr:last-child td {
    border-bottom: none;
  }

  .si-bc-advantage {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .si-bc-advantage--us { background: rgba(16,185,129,0.12); color: #34d399; }
  .si-bc-advantage--them { background: rgba(239,68,68,0.12); color: #f87171; }
  .si-bc-advantage--tie { background: rgba(107,114,128,0.12); color: #9ca3af; }

  .si-bc-check { color: #34d399; }
  .si-bc-cross { color: #f87171; }

  /* ---- Objection Cards ---- */

  .si-bc-objections {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .si-bc-objection {
    background: #0A0F1C;
    border: 1px solid #1E293B;
    border-radius: 8px;
    padding: 14px;
  }

  .si-bc-objection-q {
    font-size: 13px;
    font-weight: 600;
    color: #f87171;
    margin-bottom: 8px;
  }

  .si-bc-objection-a {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.6;
    margin-bottom: 4px;
  }

  .si-bc-objection-evidence {
    font-size: 11px;
    color: #3b82f6;
    font-style: italic;
  }

  /* ---- Strategy Lists ---- */

  .si-bc-strategies {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .si-bc-strategy-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .si-bc-strategy-list li {
    font-size: 13px;
    color: #94a3b8;
    padding-left: 20px;
    position: relative;
    line-height: 1.5;
  }

  .si-bc-strategy-list li::before {
    position: absolute;
    left: 0;
    top: 2px;
    font-size: 12px;
  }

  .si-bc-win-list li::before { content: '\\2714'; color: #34d399; }
  .si-bc-lose-list li::before { content: '\\26A0'; color: #f59e0b; }

  /* ---- Talk Track ---- */

  .si-bc-talk-track {
    font-size: 13px;
    color: #94a3b8;
    line-height: 1.7;
    background: #0A0F1C;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid #1E293B;
    white-space: pre-line;
  }

  /* ---- Testimonials ---- */

  .si-bc-testimonials {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .si-bc-testimonial {
    background: #0A0F1C;
    border: 1px solid #1E293B;
    border-radius: 8px;
    padding: 14px;
  }

  .si-bc-testimonial-quote {
    font-size: 13px;
    color: #e2e8f0;
    font-style: italic;
    line-height: 1.6;
    margin-bottom: 8px;
  }

  .si-bc-testimonial-source {
    font-size: 11px;
    color: #64748b;
  }

  /* ---- Responsive ---- */

  @media (max-width: 768px) {
    .si-battlecard { padding: 16px; }
    .si-bc-stats { grid-template-columns: 1fr; }
    .si-bc-strategies { grid-template-columns: 1fr; }
  }
`;

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

// Default battlecard — loaded from competitive-intel service when available
const DEFAULT_BATTLECARD: BattlecardData = {
  competitorName: 'ZoomInfo',
  competitorDomain: 'zoominfo.com',
  marketPosition: 'leader',
  ourProduct: 'SalesIntel',
  overview: 'ZoomInfo is the market leader in B2B contact databases with 100M+ contacts. Strong on volume but weaker on real-time signal intelligence and AI-driven timing recommendations.',
  differentiators: [
    { feature: 'Real-time Signal Intelligence', ours: 'AI-powered signal convergence with 10+ signal types, real-time alerts', theirs: 'Basic intent data from Bombora partnership, limited signal types', advantage: 'us' },
    { feature: 'Contact Database Size', ours: '50M+ contacts with high accuracy', theirs: '100M+ contacts, industry largest database', advantage: 'them' },
    { feature: 'AI Timing Engine', ours: 'Proprietary "Why Now" engine with convergence scoring and predictive timing', theirs: 'Basic buyer intent scores, no timing recommendations', advantage: 'us' },
    { feature: 'Outreach Generation', ours: 'AI-drafted personalized outreach with signal context', theirs: 'Template-based sequences via Engage product', advantage: 'us' },
    { feature: 'Pricing', ours: 'Transparent per-seat pricing starting at $99/mo', theirs: 'Enterprise-only pricing, starts at $15K/yr', advantage: 'us' },
  ],
  headToHead: [
    { category: 'Data', feature: 'Contact Database', us: '50M+', them: '100M+' },
    { category: 'Data', feature: 'Real-time Signals', us: true, them: false },
    { category: 'Data', feature: 'Tech Stack Detection', us: true, them: true },
    { category: 'Intelligence', feature: 'Signal Convergence', us: true, them: false },
    { category: 'Intelligence', feature: 'AI Timing Score', us: true, them: false },
    { category: 'Intelligence', feature: 'Competitive Intel', us: true, them: false },
    { category: 'Outreach', feature: 'AI Message Drafting', us: true, them: false },
    { category: 'Outreach', feature: 'Email Sequences', us: true, them: true },
    { category: 'Platform', feature: 'CRM Integration', us: true, them: true },
    { category: 'Platform', feature: 'API Access', us: true, them: true },
    { category: 'Platform', feature: 'Free Trial', us: '14 days', them: 'No' },
  ],
  objections: [
    { objection: '"ZoomInfo has more contacts"', response: 'True — ZoomInfo has the largest database. But database size doesn\'t close deals. Our signal intelligence tells you WHEN to reach out and WHAT to say. Teams using SalesIntel report 3x higher response rates because of personalized, signal-timed outreach.', evidence: 'Stripe increased response rates from 12% to 38% after switching to signal-based timing.' },
    { objection: '"We already use ZoomInfo"', response: 'Great — many of our customers use both. SalesIntel isn\'t a data replacement, it\'s an intelligence layer. Keep ZoomInfo for contact lookup, add SalesIntel for the "why now" context that makes your outreach 3x more effective.', evidence: 'Datadog runs both tools — SalesIntel for timing, ZoomInfo for contacts — and saw 45% more meetings booked.' },
    { objection: '"ZoomInfo has more integrations"', response: 'ZoomInfo has broader CRM integrations, but our focused integration with Salesforce and HubSpot covers 90% of use cases. Plus, our API is fully open — any custom integration takes hours, not weeks.' },
  ],
  winStrategies: [
    'Lead with signal intelligence demo — show a real prospect with convergence scoring',
    'Emphasize the "Why Now" engine — ZoomInfo can\'t tell you WHEN to reach out',
    'Show AI-drafted outreach vs ZoomInfo\'s templates — personalization wins',
    'Price advantage: SalesIntel is 5-10x cheaper for similar team sizes',
    'Free trial: Let the product sell itself — ZoomInfo requires a sales call',
  ],
  loseReasons: [
    'Buyer needs massive contact database (100K+ lookups/month)',
    'Deep investment in ZoomInfo Engage for sequence automation',
    'Enterprise procurement requires vendor on approved list',
    'Multi-year ZoomInfo contract lock-in with heavy discount',
  ],
  talkTrack: `"I see you're using ZoomInfo — great tool for contact data. What we hear from teams like yours is that having the right contacts is only half the battle. The other half is knowing WHEN to reach out and WHAT to say.

That's where SalesIntel is different. Our signal intelligence engine monitors 10+ buying signals — funding events, executive moves, tech stack changes, hiring surges — and tells you the exact moment a prospect is most likely to engage.

For example, [reference a specific signal for their target account]. Instead of spray-and-pray outreach, your team would have AI-drafted messages that reference specific triggers. Teams using this approach see 3x higher response rates.

Want me to show you what the signals look like for one of your target accounts?"`,
  positioning: 'SalesIntel is the AI-powered signal intelligence platform that tells your team WHO to contact, WHEN to reach out, and WHAT to say. While ZoomInfo provides the contacts, SalesIntel provides the context.',
  winRate: 42,
  totalDeals: 24,
  avgDealSize: 85000,
  testimonials: [
    { company: 'Stripe', quote: 'SalesIntel\'s signal timing transformed our outbound. We went from 12% to 38% response rates in 60 days.', role: 'VP Sales' },
    { company: 'Datadog', quote: 'We use SalesIntel alongside ZoomInfo. The intelligence layer is irreplaceable — our AEs won\'t prospect without it.', role: 'Director of Sales Development' },
  ],
};

export class CompetitiveBattlecard {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private data: BattlecardData = DEFAULT_BATTLECARD;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'si-battlecard';
    this.injectStyles();
    this.buildUI();
  }

  public setData(data: BattlecardData): void {
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

    // Win Rate Stats
    this.root.appendChild(this.buildStats());

    // Overview
    this.root.appendChild(this.buildOverview());

    // Feature Comparison Table
    this.root.appendChild(this.buildComparisonTable());

    // Head-to-Head
    this.root.appendChild(this.buildHeadToHead());

    // Objection Handling
    this.root.appendChild(this.buildObjections());

    // Win/Lose Strategies
    this.root.appendChild(this.buildStrategies());

    // Talk Track
    this.root.appendChild(this.buildTalkTrack());

    // Testimonials
    if (this.data.testimonials.length > 0) {
      this.root.appendChild(this.buildTestimonials());
    }
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'si-bc-header';
    header.innerHTML = `
      <div class="si-bc-title-group">
        <h1 class="si-bc-title">${this.data.ourProduct}</h1>
        <span class="si-bc-vs">vs</span>
        <h1 class="si-bc-title">${this.data.competitorName}</h1>
      </div>
      <span class="si-bc-position si-bc-position--${this.data.marketPosition}">${this.data.marketPosition}</span>
    `;
    return header;
  }

  private buildStats(): HTMLElement {
    const stats = document.createElement('div');
    stats.className = 'si-bc-stats';

    const winColor = this.data.winRate >= 50 ? '#34d399' : this.data.winRate >= 30 ? '#fbbf24' : '#f87171';

    stats.innerHTML = `
      <div class="si-bc-stat">
        <div class="si-bc-stat-value" style="color:${winColor}">${this.data.winRate}%</div>
        <div class="si-bc-stat-label">Win Rate vs ${this.data.competitorName}</div>
      </div>
      <div class="si-bc-stat">
        <div class="si-bc-stat-value">${this.data.totalDeals}</div>
        <div class="si-bc-stat-label">Competitive Deals</div>
      </div>
      <div class="si-bc-stat">
        <div class="si-bc-stat-value">${formatCurrency(this.data.avgDealSize)}</div>
        <div class="si-bc-stat-label">Avg Deal Size</div>
      </div>
    `;
    return stats;
  }

  private buildOverview(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';
    section.innerHTML = `
      <h3 class="si-bc-section-title">Overview</h3>
      <p style="font-size:13px;color:#94a3b8;line-height:1.7;margin:0">${this.data.overview}</p>
    `;
    return section;
  }

  private buildComparisonTable(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Key Differentiators';
    section.appendChild(title);

    const table = document.createElement('table');
    table.className = 'si-bc-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:20%">Feature</th>
          <th style="width:35%">${this.data.ourProduct}</th>
          <th style="width:35%">${this.data.competitorName}</th>
          <th style="width:10%">Edge</th>
        </tr>
      </thead>
      <tbody>
        ${this.data.differentiators.map(d => `
          <tr>
            <td style="font-weight:500;color:#e2e8f0">${d.feature}</td>
            <td style="color:#94a3b8">${d.ours}</td>
            <td style="color:#94a3b8">${d.theirs}</td>
            <td>
              <span class="si-bc-advantage si-bc-advantage--${d.advantage}">
                ${d.advantage === 'us' ? 'Us' : d.advantage === 'them' ? 'Them' : 'Tie'}
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;

    section.appendChild(table);
    return section;
  }

  private buildHeadToHead(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Head-to-Head Feature Matrix';
    section.appendChild(title);

    const table = document.createElement('table');
    table.className = 'si-bc-table';

    const renderValue = (val: boolean | string): string => {
      if (typeof val === 'boolean') {
        return val
          ? '<span class="si-bc-check">&#10004;</span>'
          : '<span class="si-bc-cross">&#10008;</span>';
      }
      return `<span style="color:#94a3b8">${val}</span>`;
    };

    table.innerHTML = `
      <thead>
        <tr>
          <th>Category</th>
          <th>Feature</th>
          <th>${this.data.ourProduct}</th>
          <th>${this.data.competitorName}</th>
        </tr>
      </thead>
      <tbody>
        ${this.data.headToHead.map(h => `
          <tr>
            <td style="color:#64748b;font-size:11px;text-transform:uppercase">${h.category}</td>
            <td style="color:#e2e8f0">${h.feature}</td>
            <td>${renderValue(h.us)}</td>
            <td>${renderValue(h.them)}</td>
          </tr>
        `).join('')}
      </tbody>
    `;

    section.appendChild(table);
    return section;
  }

  private buildObjections(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Objection Handling';
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'si-bc-objections';

    for (const obj of this.data.objections) {
      const card = document.createElement('div');
      card.className = 'si-bc-objection';
      card.innerHTML = `
        <div class="si-bc-objection-q">${obj.objection}</div>
        <div class="si-bc-objection-a">${obj.response}</div>
        ${obj.evidence ? `<div class="si-bc-objection-evidence">${obj.evidence}</div>` : ''}
      `;
      list.appendChild(card);
    }

    section.appendChild(list);
    return section;
  }

  private buildStrategies(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Win & Loss Patterns';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'si-bc-strategies';

    grid.innerHTML = `
      <div>
        <h4 style="font-size:12px;font-weight:600;color:#34d399;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">How We Win</h4>
        <ul class="si-bc-strategy-list si-bc-win-list">
          ${this.data.winStrategies.map(s => `<li>${s}</li>`).join('')}
        </ul>
      </div>
      <div>
        <h4 style="font-size:12px;font-weight:600;color:#f59e0b;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">Why We Lose</h4>
        <ul class="si-bc-strategy-list si-bc-lose-list">
          ${this.data.loseReasons.map(s => `<li>${s}</li>`).join('')}
        </ul>
      </div>
    `;

    section.appendChild(grid);
    return section;
  }

  private buildTalkTrack(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Competitive Talk Track';
    section.appendChild(title);

    const track = document.createElement('div');
    track.className = 'si-bc-talk-track';
    track.textContent = this.data.talkTrack;
    section.appendChild(track);

    return section;
  }

  private buildTestimonials(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-bc-section';

    const title = document.createElement('h3');
    title.className = 'si-bc-section-title';
    title.textContent = 'Customer Proof Points';
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'si-bc-testimonials';

    for (const t of this.data.testimonials) {
      const card = document.createElement('div');
      card.className = 'si-bc-testimonial';
      card.innerHTML = `
        <div class="si-bc-testimonial-quote">"${t.quote}"</div>
        <div class="si-bc-testimonial-source">— ${t.role}, ${t.company}</div>
      `;
      list.appendChild(card);
    }

    section.appendChild(list);
    return section;
  }
}
