/**
 * SalesIntel App — Main application orchestrator
 * Manages the app shell (sidebar + topbar + page routing),
 * data loading, and service initialization.
 */

import { STORAGE_KEYS } from '@/config';
import { Dashboard } from '@/components/Dashboard';
import { TargetsPanel } from '@/components/TargetsPanel';
import { SignalAlertsPanel } from '@/components/SignalAlertsPanel';
import { CompanyIntelligence } from '@/components/CompanyIntelligence';
import { PipelineDashboard } from '@/components/PipelineDashboard';
import { EngagementTracker } from '@/components/EngagementTracker';
import { CompetitiveBattlecard } from '@/components/CompetitiveBattlecard';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { CommandPalette } from '@/components/CommandPalette';
import { MorningBriefing } from '@/components/MorningBriefing';
import { WinLossInsights } from '@/components/WinLossInsights';
import { TerritoryView } from '@/components/TerritoryView';
import { loadFromStorage } from '@/utils';
import { mlWorker } from '@/services/ml-worker';
import { getAiFlowSettings, isHeadlineMemoryEnabled } from '@/services/ai-flow-settings';
import { dataFreshness } from '@/services/data-freshness';
import { researchAgent } from '@/services/research-agent';
import { monitorAgent } from '@/services/monitor-agent';
import { dealPipeline } from '@/services/deal-pipeline';
import { emailSequenceManager } from '@/services/email-sequences';
import { revenueAnalytics } from '@/services/revenue-analytics';

type Page = 'dashboard' | 'targets' | 'signals' | 'pipeline' | 'prospects' | 'campaigns' | 'analytics' | 'compete' | 'briefing' | 'territory' | 'settings' | 'company-detail';

// SVG icon paths (Lucide-style, stroke-width 1.5, 20x20 viewBox)
const ICONS: Record<string, string> = {
  dashboard: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  targets: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  signals: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  pipeline: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  prospects: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  campaigns: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  analytics: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  compete: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C5.71 4 7 5.29 7 6.5V8"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C18.29 4 17 5.29 17 6.5V8"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  briefing: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  territory: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
};

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
}

const NAV_ITEMS: Array<{ id: Page; label: string; icon: string; badge?: number }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'targets', label: 'My Targets', icon: 'targets' },
  { id: 'signals', label: 'Signal Alerts', icon: 'signals', badge: 0 },
  { id: 'pipeline', label: 'Pipeline', icon: 'pipeline' },
  { id: 'prospects', label: 'Prospects', icon: 'prospects' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaigns' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'compete', label: 'Compete', icon: 'compete' },
  { id: 'briefing', label: 'Briefing', icon: 'briefing' },
  { id: 'territory', label: 'Territory', icon: 'territory' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export class App {
  private container: HTMLElement;
  private currentPage: Page = 'dashboard';
  private pageContainer: HTMLElement | null = null;
  private navButtons: Map<Page, HTMLElement> = new Map();

  // Page instances
  private dashboard: Dashboard | null = null;
  private targetsPanel: TargetsPanel | null = null;
  private signalAlertsPanel: SignalAlertsPanel | null = null;
  private companyIntelligence: CompanyIntelligence | null = null;
  private pipelineDashboard: PipelineDashboard | null = null;
  private engagementTracker: EngagementTracker | null = null;
  private competitiveBattlecard: CompetitiveBattlecard | null = null;
  private analyticsDashboard: AnalyticsDashboard | null = null;
  private morningBriefing: MorningBriefing | null = null;
  private territoryView: TerritoryView | null = null;
  private winLossInsights: WinLossInsights | null = null;
  private commandPalette: CommandPalette | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;
  }

  async init(): Promise<void> {
    // Clear the skeleton
    this.container.innerHTML = '';

    // Build the app shell
    this.renderShell();

    // Initialize Command Palette (⌘K)
    this.commandPalette = new CommandPalette();
    this.commandPalette.registerCommands([
      { id: 'nav-dashboard', label: 'Go to Dashboard', category: 'navigation', handler: () => this.navigateTo('dashboard') },
      { id: 'nav-targets', label: 'Go to Targets', category: 'navigation', handler: () => this.navigateTo('targets') },
      { id: 'nav-signals', label: 'Go to Signal Alerts', category: 'navigation', handler: () => this.navigateTo('signals') },
      { id: 'nav-pipeline', label: 'Go to Pipeline', category: 'navigation', handler: () => this.navigateTo('pipeline') },
      { id: 'nav-analytics', label: 'Go to Analytics', category: 'navigation', handler: () => this.navigateTo('analytics') },
      { id: 'nav-compete', label: 'Go to Compete', category: 'navigation', handler: () => this.navigateTo('compete') },
      { id: 'nav-briefing', label: 'Go to Morning Briefing', category: 'navigation', handler: () => this.navigateTo('briefing') },
      { id: 'nav-territory', label: 'Go to Territory', category: 'navigation', handler: () => this.navigateTo('territory') },
      { id: 'nav-settings', label: 'Go to Settings', category: 'navigation', handler: () => this.navigateTo('settings') },
      { id: 'action-research', label: 'Research a Company', description: 'Run deep research on any company', category: 'ai', handler: () => {
        const name = prompt('Enter company name:');
        if (name) this.showCompanyIntelligence(name);
      }},
    ]);

    // Navigate to default page
    this.navigateTo('dashboard');

    // Initialize ML worker in background (non-blocking)
    this.initServices();

    console.log('[SalesIntel] App initialized');
  }

  private renderShell(): void {
    // Sidebar
    const sidebar = document.createElement('aside');
    sidebar.className = 'si-sidebar';
    sidebar.innerHTML = `
      <div class="si-sidebar-logo">Sales<span>Intel</span></div>
      <nav class="si-sidebar-nav" id="si-nav"></nav>
      <div class="si-sidebar-footer">
        <div class="si-plan-badge">
          <span><strong>Pro Plan</strong></span>
          <span>750 / 1,000</span>
        </div>
      </div>
    `;

    // Render nav items
    const nav = sidebar.querySelector('#si-nav')!;
    for (const item of NAV_ITEMS) {
      const btn = document.createElement('button');
      btn.className = 'si-nav-item';
      btn.dataset.page = item.id;
      btn.innerHTML = `
        ${icon(item.icon)}
        <span>${item.label}</span>
        ${item.badge !== undefined && item.badge > 0 ? `<span class="si-nav-badge">${item.badge}</span>` : ''}
      `;
      btn.addEventListener('click', () => this.navigateTo(item.id));
      nav.appendChild(btn);
      this.navButtons.set(item.id, btn);
    }

    // Main area
    const main = document.createElement('div');
    main.className = 'si-main';

    // Top bar
    const topbar = document.createElement('header');
    topbar.className = 'si-topbar';
    topbar.innerHTML = `
      <div class="si-topbar-search">
        ${icon('search')}
        <input type="text" placeholder="Search for companies or leads..." />
      </div>
      <div class="si-live-indicator">
        <div class="si-live-dot"></div>
        <span>Live Market Data</span>
      </div>
      <div class="si-topbar-actions">
        <button class="si-topbar-btn" aria-label="Notifications">
          ${icon('bell')}
        </button>
        <div class="si-user-avatar">U</div>
      </div>
    `;

    // Global search handler
    const searchInput = topbar.querySelector('input')!;
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          this.showCompanyIntelligence(query);
        }
      }
    });

    // Page container
    const page = document.createElement('main');
    page.className = 'si-page';
    page.id = 'si-page-content';
    this.pageContainer = page;

    main.appendChild(topbar);
    main.appendChild(page);

    this.container.appendChild(sidebar);
    this.container.appendChild(main);
  }

  navigateTo(page: Page): void {
    if (page === this.currentPage && page !== 'company-detail') return;

    this.currentPage = page;

    // Update nav active state
    this.navButtons.forEach((btn, id) => {
      btn.classList.toggle('active', id === page);
    });

    // Clear current page
    this.destroyCurrentPage();
    if (this.pageContainer) {
      this.pageContainer.innerHTML = '';
    }

    // Render new page
    switch (page) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'targets':
        this.renderTargets();
        break;
      case 'signals':
        this.renderSignalAlerts();
        break;
      case 'pipeline':
        this.renderPipeline();
        break;
      case 'prospects':
        this.renderEngagement();
        break;
      case 'campaigns':
        this.renderEngagement();
        break;
      case 'analytics':
        this.renderAnalytics();
        break;
      case 'compete':
        this.renderCompete();
        break;
      case 'briefing':
        this.renderBriefing();
        break;
      case 'territory':
        this.renderTerritory();
        break;
      case 'settings':
        this.renderPlaceholder('Settings', 'Signal preferences, API keys, and team configuration.');
        break;
      case 'company-detail':
        // Handled by showCompanyIntelligence
        break;
    }
  }

  private renderDashboard(): void {
    if (!this.pageContainer) return;
    this.dashboard = new Dashboard();
    this.dashboard.onSearch((company, _email) => {
      if (company) {
        this.showCompanyIntelligence(company);
      }
    });
    this.dashboard.render(this.pageContainer);
  }

  private renderTargets(): void {
    if (!this.pageContainer) return;
    this.targetsPanel = new TargetsPanel();
    this.targetsPanel.onViewTarget((company) => {
      this.showCompanyIntelligence(company);
    });
    this.targetsPanel.render(this.pageContainer);

    // Load saved targets
    const savedTargets = loadFromStorage(STORAGE_KEYS.targets, []);
    if (savedTargets.length > 0) {
      this.targetsPanel.setTargets(savedTargets);
    }
  }

  private renderSignalAlerts(): void {
    if (!this.pageContainer) return;
    this.signalAlertsPanel = new SignalAlertsPanel();
    this.signalAlertsPanel.onAction((action, signalId) => {
      console.log(`[SalesIntel] Signal action: ${action} on ${signalId}`);
      if (action === 'view_detail') {
        this.showCompanyIntelligence(signalId);
      }
    });
    this.signalAlertsPanel.render(this.pageContainer);
  }

  showCompanyIntelligence(companyName: string): void {
    this.currentPage = 'company-detail';

    // Update nav — no nav item is active for detail page
    this.navButtons.forEach((btn) => {
      btn.classList.remove('active');
    });

    this.destroyCurrentPage();
    if (this.pageContainer) {
      this.pageContainer.innerHTML = '';
    }

    this.companyIntelligence = new CompanyIntelligence();

    // Show loading state with company name while research runs
    this.companyIntelligence.setCompanyData({
      name: companyName,
      category: 'Researching...',
      location: '—',
      employeeRange: '—',
      fundingStage: '—',
      executives: [],
      triggers: [],
      socialPosts: [],
      icebreakers: [],
      timeline: [],
      accountHealthScore: 0,
    });

    if (this.pageContainer) {
      this.companyIntelligence.render(this.pageContainer);
    }

    // Run real research via the research agent
    researchAgent.runResearch(companyName).then((result) => {
      if (!this.companyIntelligence) return; // navigated away

      // Map research result → CompanyIntelData
      const executives = (result.orgChart ?? []).map(p => ({
        name: p.name,
        title: p.title,
      }));

      const triggers = (result.signals ?? []).slice(0, 6).map(s => ({
        label: s.title,
        type: (s.strength === 'strong' ? 'new' : 'detected') as 'new' | 'detected',
        description: `${s.source} — ${s.type.replace(/_/g, ' ')}`,
        actionText: 'VIEW SIGNAL',
      }));

      const timeline = (result.signals ?? []).slice(0, 8).map(s => ({
        date: s.timestamp || new Date().toISOString(),
        title: s.title,
        description: s.source,
      }));

      const icebreakers = (result.recommendedActions ?? []).slice(0, 3);

      this.companyIntelligence.setCompanyData({
        name: result.firmographics?.name ?? companyName,
        domain: result.domain,
        category: result.firmographics?.industry ?? result.lifecycleStage ?? 'Unknown',
        location: result.firmographics?.location ?? '—',
        employeeRange: '—',
        fundingStage: result.lifecycleStage ?? '—',
        website: result.firmographics?.website,
        executives,
        triggers,
        socialPosts: (result.newsMentions ?? []).slice(0, 3).map(n => ({
          author: n.title,
          preview: n.url,
          likes: n.points ?? 0,
          comments: 0,
          shares: 0,
          timestamp: n.date,
        })),
        icebreakers,
        timeline,
        accountHealthScore: result.accountHealthScore ?? 0,
      });
    }).catch((err) => {
      console.warn('[SalesIntel] Research failed:', err);
      if (this.companyIntelligence) {
        this.companyIntelligence.setCompanyData({
          name: companyName,
          category: 'Research unavailable',
          location: '—',
          employeeRange: '—',
          fundingStage: '—',
          executives: [],
          triggers: [],
          socialPosts: [],
          icebreakers: ['Try searching again or check your network connection.'],
          timeline: [],
          accountHealthScore: 0,
        });
      }
    });
  }

  private renderPipeline(): void {
    if (!this.pageContainer) return;
    this.pipelineDashboard = new PipelineDashboard();
    this.pipelineDashboard.onDealSelect((dealId) => {
      console.log(`[SalesIntel] View deal: ${dealId}`);
    });
    this.pipelineDashboard.onNewDeal(() => {
      console.log('[SalesIntel] Create new deal');
    });
    this.pipelineDashboard.render(this.pageContainer);

    // Load real deals from deal-pipeline service
    dealPipeline.getDeals().then(deals => {
      if (!this.pipelineDashboard || deals.length === 0) return;
      this.pipelineDashboard.setDeals(deals.map(d => ({
        id: d.id,
        company: d.company,
        contactName: d.contactName,
        dealValue: d.dealValue,
        stage: d.stage,
        probability: d.probability,
        expectedCloseDate: d.expectedCloseDate,
        signals: d.signals?.length ?? 0,
        healthScore: 50,
        tags: d.tags ?? [],
        daysInStage: 0,
      })));
    }).catch((err: unknown) => console.warn('[SalesIntel] Pipeline load error:', err));
  }

  private renderEngagement(): void {
    if (!this.pageContainer) return;
    this.engagementTracker = new EngagementTracker();
    this.engagementTracker.onSequenceSelect((seqId) => {
      console.log(`[SalesIntel] View sequence: ${seqId}`);
    });
    this.engagementTracker.render(this.pageContainer);

    // Load real sequences from email-sequences service
    emailSequenceManager.listSequences().then(seqs => {
      if (!this.engagementTracker || seqs.length === 0) return;
      this.engagementTracker.setSequences(seqs.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status as 'active' | 'paused' | 'draft',
        totalEnrolled: s.stats.totalEnrolled,
        active: s.stats.active,
        replied: s.stats.replied,
        openRate: s.stats.openRate,
        replyRate: s.stats.replyRate,
        steps: s.steps?.length ?? 0,
      })));
    }).catch((err: unknown) => console.warn('[SalesIntel] Sequences load error:', err));
  }

  private renderAnalytics(): void {
    if (!this.pageContainer) return;
    this.analyticsDashboard = new AnalyticsDashboard();
    this.analyticsDashboard.render(this.pageContainer);

    // Load real analytics from revenue-analytics service
    revenueAnalytics.getExecutiveSummary().then((summary: { pipelineValue: number; weightedPipeline: number; winRate: number; avgDealSize: number; avgCycleLength: number; dealsWonThisPeriod: number; revenueThisPeriod: number; insights: string[] }) => {
      if (!this.analyticsDashboard) return;
      this.analyticsDashboard.setData({
        pipelineValue: summary.pipelineValue ?? 0,
        weightedPipeline: summary.weightedPipeline ?? 0,
        winRate: Math.round((summary.winRate ?? 0) * 100),
        winRateTrend: 0,
        avgDealSize: summary.avgDealSize ?? 0,
        avgCycleLength: summary.avgCycleLength ?? 0,
        dealsWon: summary.dealsWonThisPeriod ?? 0,
        revenueWon: summary.revenueThisPeriod ?? 0,
        funnel: [],
        signalROI: [],
        reps: [],
        insights: summary.insights ?? [],
        revenueTrend: [],
      });
    }).catch((err: unknown) => console.warn('[SalesIntel] Analytics load error:', err));
  }

  private renderCompete(): void {
    if (!this.pageContainer) return;
    this.competitiveBattlecard = new CompetitiveBattlecard();
    this.competitiveBattlecard.render(this.pageContainer);
  }

  private renderBriefing(): void {
    if (!this.pageContainer) return;
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // Populate from monitor agent alerts
    const alerts = monitorAgent.getAlerts?.() ?? [];
    const topSignals = alerts.slice(0, 5).map(a => ({
      company: a.company,
      signal: a.signal?.title ?? 'New signal detected',
      urgency: ('high') as 'critical' | 'high' | 'medium',
      signalType: a.signal?.type ?? 'press_release',
      source: a.signal?.source ?? 'monitor',
      timestamp: a.detectedAt.toISOString(),
      action: 'Review signal',
    }));

    this.morningBriefing = new MorningBriefing({
      date: dateStr,
      greeting: 'Good morning',
      topSignals,
      closingWindows: [],
      cascadeAlerts: [],
      newDecisionMakers: [],
      followUps: [],
      teamInsight: '',
      stats: {
        newSignals: alerts.length,
        watchlistCompanies: 0,
        pipelineValue: '$0',
        tasksToday: 0,
      },
    });
    this.morningBriefing.render(this.pageContainer);
  }

  private renderTerritory(): void {
    if (!this.pageContainer) return;
    this.territoryView = new TerritoryView({
      repName: 'My',
      totalAccounts: 0,
      activeSignals: 0,
      pipelineValue: 0,
      territories: [],
    });
    this.territoryView.render(this.pageContainer);

    // Populate from deal-pipeline accounts
    dealPipeline.getDeals().then((deals: Array<{ company: string; dealValue: number; probability: number; stage: string; expectedCloseDate: string; tags: string[]; updatedAt: string; createdAt: string }>) => {
      if (!this.territoryView) return;
      const tier1 = deals.filter(d => d.dealValue >= 100000);
      const tier2 = deals.filter(d => d.dealValue >= 50000 && d.dealValue < 100000);
      const tier3 = deals.filter(d => d.dealValue < 50000);

      const mapDeals = (dealsArr: typeof deals) => dealsArr.map(d => ({
        company: d.company,
        industry: d.tags?.[0] ?? 'Unknown',
        healthScore: 50,
        propensityScore: d.probability ?? 30,
        signalCount: 0,
        buyingWindow: d.expectedCloseDate ? '30-60 days' : '90+ days',
        lastSignal: d.stage,
        lastSignalDate: d.updatedAt ?? d.createdAt ?? new Date().toISOString(),
      }));

      const territories: Array<{ tier: 1 | 2 | 3; tierLabel: string; accounts: ReturnType<typeof mapDeals> }> = [
        { tier: 1 as const, tierLabel: 'Strategic (>$100K)', accounts: mapDeals(tier1) },
        { tier: 2 as const, tierLabel: 'Growth ($50K-$100K)', accounts: mapDeals(tier2) },
        { tier: 3 as const, tierLabel: 'Velocity (<$50K)', accounts: mapDeals(tier3) },
      ].filter(g => g.accounts.length > 0);

      this.territoryView!.setData({
        repName: 'My',
        totalAccounts: deals.length,
        activeSignals: 0,
        pipelineValue: deals.reduce((s, d) => s + d.dealValue, 0),
        territories,
      });
    }).catch((err: unknown) => console.warn('[SalesIntel] Territory load error:', err));
  }

  private renderPlaceholder(title: string, description: string): void {
    if (!this.pageContainer) return;
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;text-align:center;';
    placeholder.innerHTML = `
      <h2 style="font-size:24px;font-weight:600;color:#e2e8f0;margin-bottom:12px;">${title}</h2>
      <p style="font-size:14px;color:#94a3b8;max-width:400px;">${description}</p>
    `;
    this.pageContainer.appendChild(placeholder);
  }

  private destroyCurrentPage(): void {
    this.dashboard?.destroy();
    this.dashboard = null;
    this.targetsPanel?.destroy();
    this.targetsPanel = null;
    this.signalAlertsPanel?.destroy();
    this.signalAlertsPanel = null;
    this.companyIntelligence?.destroy();
    this.companyIntelligence = null;
    this.pipelineDashboard?.destroy();
    this.pipelineDashboard = null;
    this.engagementTracker?.destroy();
    this.engagementTracker = null;
    this.competitiveBattlecard?.destroy();
    this.competitiveBattlecard = null;
    this.analyticsDashboard?.destroy();
    this.analyticsDashboard = null;
    this.morningBriefing?.destroy();
    this.morningBriefing = null;
    this.territoryView?.destroy();
    this.territoryView = null;
    this.winLossInsights?.destroy();
    this.winLossInsights = null;
  }

  private async initServices(): Promise<void> {
    try {
      // Initialize ML worker for NER and embeddings
      const aiSettings = getAiFlowSettings();
      if (aiSettings.browserModel) {
        mlWorker.init().catch(err => {
          console.warn('[SalesIntel] ML worker init failed:', err);
        });
      }

      // Initialize headline memory / signal memory if enabled
      if (isHeadlineMemoryEnabled()) {
        console.log('[SalesIntel] Signal Memory (RAG) enabled');
      }

      // Report data freshness
      dataFreshness.reportUpdate('rss', 0);

      // Start continuous monitoring agent
      monitorAgent.startPeriodicMonitoring();
      console.log('[SalesIntel] Monitor Agent started');

    } catch (err) {
      console.warn('[SalesIntel] Service init error:', err);
    }
  }

  destroy(): void {
    this.destroyCurrentPage();
    this.commandPalette?.destroy();
    this.commandPalette = null;
    monitorAgent.stopPeriodicMonitoring?.();
    this.container.innerHTML = '';
    this.navButtons.clear();
  }
}
