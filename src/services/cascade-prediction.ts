/**
 * Commercial Cascade Prediction Service
 * Traces how major events ripple through the intelligence graph,
 * predicting downstream impacts on related companies.
 */

import type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CascadeEvent {
  id: string;
  triggerSignal: { company: string; type: string; title: string; timestamp: Date };
  cascadePaths: CascadePath[];
  totalImpactedCompanies: number;
  generatedAt: Date;
}

export interface CascadePath {
  description: string;
  impactedCompany: string;
  impactType:
    | 'competitive_pressure'
    | 'vendor_displacement'
    | 'talent_competition'
    | 'portfolio_cross_sell'
    | 'supply_chain'
    | 'market_shift';
  probability: number; // 0-1
  commercialRelevance: number; // 0-100
  reasoning: string;
  recommendedAction: string;
  timeframe: 'immediate' | '30_days' | '90_days' | '6_months';
}

export interface CascadeAlert {
  id: string;
  company: string;
  event: string;
  impactedWatchlistCompanies: number;
  topPaths: CascadePath[];
  urgency: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ImpactType = CascadePath['impactType'];
type Timeframe = CascadePath['timeframe'];

interface PathTemplate {
  descriptionTemplate: string;
  impactType: ImpactType;
  baseProbability: number;
  timeframe: Timeframe;
  reasoningTemplate: string;
  actionTemplate: string;
}

type SignalCategory =
  | 'funding_event'
  | 'executive_hire'
  | 'acquisition'
  | 'layoffs'
  | 'ipo_filing';

const CACHE_KEY = 'cascade_prediction_recent';
const MAX_CACHED_CASCADES = 200;

// ---------------------------------------------------------------------------
// Cascade path templates keyed by signal category
// ---------------------------------------------------------------------------

const CASCADE_TEMPLATES: Record<SignalCategory, PathTemplate[]> = {
  funding_event: [
    {
      descriptionTemplate: '{company} funding round creates competitive pressure on {impacted}',
      impactType: 'competitive_pressure',
      baseProbability: 0.75,
      timeframe: '30_days',
      reasoningTemplate:
        'New capital at {company} enables aggressive market expansion, directly threatening {impacted} market share in overlapping segments.',
      actionTemplate:
        'Reach out to {impacted} to discuss defensive positioning and highlight differentiation against {company}.',
    },
    {
      descriptionTemplate: '{company} funding may displace existing vendors at {impacted}',
      impactType: 'vendor_displacement',
      baseProbability: 0.45,
      timeframe: '90_days',
      reasoningTemplate:
        'Well-funded {company} will likely invest in building in-house capabilities or switching to premium vendors, displacing current solutions at {impacted}.',
      actionTemplate:
        'Proactively engage {impacted} procurement to lock in renewals before {company} begins vendor consolidation.',
    },
    {
      descriptionTemplate: 'Portfolio cross-sell opportunity at {impacted} following {company} funding',
      impactType: 'portfolio_cross_sell',
      baseProbability: 0.6,
      timeframe: '30_days',
      reasoningTemplate:
        '{company} funding validates the market segment; {impacted} as a portfolio sibling is primed for complementary product expansion.',
      actionTemplate:
        'Introduce cross-sell bundle to {impacted} leveraging momentum from {company} funding announcement.',
    },
  ],

  executive_hire: [
    {
      descriptionTemplate: '{company} executive hire intensifies talent competition affecting {impacted}',
      impactType: 'talent_competition',
      baseProbability: 0.65,
      timeframe: 'immediate',
      reasoningTemplate:
        'Senior hire at {company} signals aggressive growth plans; regional talent pool tightens, impacting {impacted} recruiting pipeline.',
      actionTemplate:
        'Position HR/talent solutions to {impacted} emphasising retention strategies amid increased local competition from {company}.',
    },
    {
      descriptionTemplate: '{company} new executive opens vendor review window impacting {impacted}',
      impactType: 'vendor_displacement',
      baseProbability: 0.55,
      timeframe: '90_days',
      reasoningTemplate:
        'New leadership at {company} typically triggers a 90-day vendor audit; {impacted} vendors face potential displacement.',
      actionTemplate:
        'Schedule executive briefing with new {company} leadership within 30 days to secure incumbency before vendor review.',
    },
    {
      descriptionTemplate: 'Backfill opportunity at {impacted} after executive departs to {company}',
      impactType: 'market_shift',
      baseProbability: 0.5,
      timeframe: '30_days',
      reasoningTemplate:
        'Executive departure from {impacted} to {company} creates leadership vacuum and potential strategy shifts at {impacted}.',
      actionTemplate:
        'Engage {impacted} interim leadership to position as strategic partner during transition period.',
    },
  ],

  acquisition: [
    {
      descriptionTemplate: '{company} acquisition triggers portfolio consolidation affecting {impacted}',
      impactType: 'portfolio_cross_sell',
      baseProbability: 0.7,
      timeframe: '90_days',
      reasoningTemplate:
        'Post-acquisition integration at {company} creates consolidation pressure; {impacted} as a portfolio company may face overlapping product rationalisation.',
      actionTemplate:
        'Propose integration/migration services to {impacted} ahead of {company} post-merger tech stack consolidation.',
    },
    {
      descriptionTemplate: '{company} acquisition forces competitive response from {impacted}',
      impactType: 'competitive_pressure',
      baseProbability: 0.65,
      timeframe: '30_days',
      reasoningTemplate:
        'Strategic acquisition by {company} shifts market dynamics; {impacted} must respond with own M&A, partnerships, or product acceleration.',
      actionTemplate:
        'Approach {impacted} leadership with competitive intelligence package and partnership proposal before they finalise response strategy.',
    },
    {
      descriptionTemplate: '{company} acquisition drives tech stack consolidation at {impacted}',
      impactType: 'supply_chain',
      baseProbability: 0.6,
      timeframe: '6_months',
      reasoningTemplate:
        'Combined {company} entity will rationalise duplicate tooling; {impacted} supply chain and vendor relationships face review.',
      actionTemplate:
        'Map overlapping vendor footprint at {impacted} and prepare migration/consolidation proposal for decision-makers.',
    },
  ],

  layoffs: [
    {
      descriptionTemplate: '{company} layoffs create talent acquisition opportunity for {impacted}',
      impactType: 'talent_competition',
      baseProbability: 0.8,
      timeframe: 'immediate',
      reasoningTemplate:
        'Displaced talent from {company} represents immediate hiring opportunity for {impacted} in the same talent market.',
      actionTemplate:
        'Alert {impacted} recruiting team about available talent from {company} layoffs; offer recruiting/staffing solutions.',
    },
    {
      descriptionTemplate: '{company} layoffs signal vendor budget cuts impacting {impacted}',
      impactType: 'vendor_displacement',
      baseProbability: 0.7,
      timeframe: 'immediate',
      reasoningTemplate:
        'Cost-cutting at {company} will cascade to vendor budget reductions; {impacted} as a supplier faces contract risk.',
      actionTemplate:
        'Proactively contact {impacted} account team to discuss contract protection strategies and value reinforcement.',
    },
    {
      descriptionTemplate: '{company} layoffs send negative market signal affecting {impacted}',
      impactType: 'market_shift',
      baseProbability: 0.5,
      timeframe: '30_days',
      reasoningTemplate:
        'Layoffs at {company} may indicate broader sector headwinds; {impacted} in the same vertical should prepare for similar pressures.',
      actionTemplate:
        'Brief {impacted} leadership on sector trends and offer efficiency/cost-optimization solutions preemptively.',
    },
  ],

  ipo_filing: [
    {
      descriptionTemplate: '{company} IPO filing drives compliance tool purchasing at {impacted}',
      impactType: 'supply_chain',
      baseProbability: 0.85,
      timeframe: 'immediate',
      reasoningTemplate:
        'IPO-bound {company} must meet SOX/SEC compliance requirements; {impacted} compliance and audit tool vendors see immediate demand.',
      actionTemplate:
        'Fast-track compliance/governance solution proposal to {company} and highlight {impacted} as a proven vendor for IPO-stage companies.',
    },
    {
      descriptionTemplate: '{company} IPO triggers audit vendor selection impacting {impacted}',
      impactType: 'vendor_displacement',
      baseProbability: 0.75,
      timeframe: '30_days',
      reasoningTemplate:
        'Pre-IPO audit requirements at {company} open competitive window; {impacted} audit/consulting firms can win new mandates.',
      actionTemplate:
        'Introduce {impacted} audit and advisory services to {company} CFO office within the IPO preparation timeline.',
    },
    {
      descriptionTemplate: '{company} IPO filing creates PR agency hiring opportunity for {impacted}',
      impactType: 'market_shift',
      baseProbability: 0.7,
      timeframe: '30_days',
      reasoningTemplate:
        'IPO roadshow preparation at {company} drives demand for investor relations and PR; {impacted} agencies positioned for new mandates.',
      actionTemplate:
        'Connect {impacted} IR/PR capabilities with {company} communications team to support IPO narrative.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

function classifySignal(signal: CompanySignal): SignalCategory | null {
  switch (signal.type) {
    case 'funding_event':
      return 'funding_event';
    case 'executive_movement':
    case 'leadership_activity':
      return 'executive_hire';
    case 'hiring_surge':
    case 'job_posting':
      // Layoffs are detected by keywords in the title
      if (isLayoffSignal(signal)) return 'layoffs';
      return null;
    case 'financial_trigger':
      if (isIpoSignal(signal)) return 'ipo_filing';
      if (isAcquisitionSignal(signal)) return 'acquisition';
      return null;
    case 'press_release':
      if (isAcquisitionSignal(signal)) return 'acquisition';
      if (isIpoSignal(signal)) return 'ipo_filing';
      if (isLayoffSignal(signal)) return 'layoffs';
      return null;
    default:
      return null;
  }
}

function isLayoffSignal(signal: CompanySignal): boolean {
  const text = `${signal.title} ${signal.summary ?? ''}`.toLowerCase();
  return /\b(layoff|lay off|rif|reduction[- ]in[- ]force|downsiz|restructur|workforce reduction|job cuts)\b/.test(
    text,
  );
}

function isIpoSignal(signal: CompanySignal): boolean {
  const text = `${signal.title} ${signal.summary ?? ''}`.toLowerCase();
  return /\b(ipo|initial public offering|s-1 filing|going public|public listing)\b/.test(text);
}

function isAcquisitionSignal(signal: CompanySignal): boolean {
  const text = `${signal.title} ${signal.summary ?? ''}`.toLowerCase();
  return /\b(acqui|merger|m&a|buyout|takeover)\b/.test(text);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function deriveImpactedCompanies(signal: CompanySignal, category: SignalCategory): string[] {
  const companies: string[] = [];
  const people = signal.people ?? [];

  // Derive plausible impacted entities from signal metadata
  // In a real system, this would query a company graph / CRM.
  // Here we derive synthetic but deterministic names for downstream analysis.

  const baseName = signal.company;

  switch (category) {
    case 'funding_event':
      companies.push(`${baseName} Competitor A`, `${baseName} Vendor Network`, `${baseName} Portfolio Co`);
      break;
    case 'executive_hire':
      companies.push(
        `${baseName} Regional Rival`,
        `${baseName} Incumbent Vendor`,
        people.length > 0 ? `${people[0]} Former Employer` : `${baseName} Talent Pool`,
      );
      break;
    case 'acquisition':
      companies.push(`${baseName} Portfolio Entity`, `${baseName} Market Rival`, `${baseName} Tech Vendor`);
      break;
    case 'layoffs':
      companies.push(`${baseName} Sector Peer`, `${baseName} Supplier`, `${baseName} Market Segment`);
      break;
    case 'ipo_filing':
      companies.push(`${baseName} Compliance Vendor`, `${baseName} Audit Partner`, `${baseName} PR Agency`);
      break;
  }

  return companies;
}

function urgencyFromRelevance(maxRelevance: number): CascadeAlert['urgency'] {
  if (maxRelevance >= 85) return 'critical';
  if (maxRelevance >= 65) return 'high';
  if (maxRelevance >= 40) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// CascadePredictionEngine
// ---------------------------------------------------------------------------

export class CascadePredictionEngine {
  private recentCascades: CascadeEvent[] = [];
  private initialized = false;

  // ------------------------------------------------------------------
  // Initialisation — load cached cascades
  // ------------------------------------------------------------------

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const cached = await getPersistentCache<CascadeEvent[]>(CACHE_KEY);
    if (cached?.data) {
      this.recentCascades = cached.data.map((evt) => ({
        ...evt,
        generatedAt: new Date(evt.generatedAt),
        triggerSignal: {
          ...evt.triggerSignal,
          timestamp: new Date(evt.triggerSignal.timestamp),
        },
      }));
    }
  }

  private async persistCascades(): Promise<void> {
    await setPersistentCache(CACHE_KEY, this.recentCascades);
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Given a CompanySignal, trace potential cascade effects through the
   * commercial intelligence graph and return a CascadeEvent with all
   * identified impact paths.
   */
  async analyzeCascade(signal: CompanySignal): Promise<CascadeEvent> {
    await this.ensureInitialized();

    const category = classifySignal(signal);
    const cascadePaths: CascadePath[] = [];

    if (category) {
      const templates = CASCADE_TEMPLATES[category];
      const impactedCompanies = deriveImpactedCompanies(signal, category);

      for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        if (!template) continue;
        const impactedCompany = impactedCompanies[i % impactedCompanies.length];
        const vars = { company: signal.company, impacted: impactedCompany ?? '' };

        const path: CascadePath = {
          description: interpolate(template.descriptionTemplate, vars),
          impactedCompany: impactedCompany ?? '',
          impactType: template.impactType,
          probability: this.adjustProbability(template.baseProbability, signal),
          commercialRelevance: 0, // scored below
          reasoning: interpolate(template.reasoningTemplate, vars),
          recommendedAction: interpolate(template.actionTemplate, vars),
          timeframe: template.timeframe,
        };

        path.commercialRelevance = this.scoreCascadePath(path);
        cascadePaths.push(path);
      }
    }

    // Sort by commercial relevance descending
    cascadePaths.sort((a, b) => b.commercialRelevance - a.commercialRelevance);

    const uniqueCompanies = new Set(cascadePaths.map((p) => p.impactedCompany));

    const event: CascadeEvent = {
      id: generateId('cascade'),
      triggerSignal: {
        company: signal.company,
        type: signal.type,
        title: signal.title,
        timestamp: signal.timestamp,
      },
      cascadePaths,
      totalImpactedCompanies: uniqueCompanies.size,
      generatedAt: new Date(),
    };

    // Store and persist
    this.recentCascades.unshift(event);
    if (this.recentCascades.length > MAX_CACHED_CASCADES) {
      this.recentCascades = this.recentCascades.slice(0, MAX_CACHED_CASCADES);
    }
    await this.persistCascades();

    return event;
  }

  /**
   * For a list of company names, return cascade alerts where any impacted
   * company on the watchlist appears in a recent cascade path.
   */
  async getCascadeAlerts(watchlist: string[]): Promise<CascadeAlert[]> {
    await this.ensureInitialized();

    const watchlistLower = new Set(watchlist.map((w) => w.toLowerCase()));
    const alerts: CascadeAlert[] = [];

    for (const cascade of this.recentCascades) {
      const matchingPaths = cascade.cascadePaths.filter((p) =>
        watchlistLower.has(p.impactedCompany.toLowerCase()),
      );

      if (matchingPaths.length === 0) continue;

      const topPaths = matchingPaths
        .sort((a, b) => b.commercialRelevance - a.commercialRelevance)
        .slice(0, 5);

      const maxRelevance = topPaths.length > 0 ? (topPaths[0]?.commercialRelevance ?? 0) : 0;
      const impactedWatchlistCompanies = new Set(
        matchingPaths.map((p) => p.impactedCompany.toLowerCase()),
      ).size;

      const alert: CascadeAlert = {
        id: generateId('alert'),
        company: cascade.triggerSignal.company,
        event: cascade.triggerSignal.title,
        impactedWatchlistCompanies,
        topPaths,
        urgency: urgencyFromRelevance(maxRelevance),
        summary: buildAlertSummary(cascade, matchingPaths),
      };

      alerts.push(alert);
    }

    // Sort alerts: critical first, then by impacted count
    alerts.sort((a, b) => {
      const urgencyOrder: Record<CascadeAlert['urgency'], number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return b.impactedWatchlistCompanies - a.impactedWatchlistCompanies;
    });

    return alerts;
  }

  /**
   * Return the most recent cascade analyses, newest first.
   */
  async getRecentCascades(limit: number = 20): Promise<CascadeEvent[]> {
    await this.ensureInitialized();
    return this.recentCascades.slice(0, limit);
  }

  /**
   * Calculate commercial relevance score (0-100) for a cascade path.
   *
   * Factors:
   *  - Base probability contributes up to 40 points
   *  - Impact type weight contributes up to 30 points
   *  - Timeframe urgency contributes up to 30 points
   */
  scoreCascadePath(path: CascadePath): number {
    // Probability contribution (0-40)
    const probabilityScore = path.probability * 40;

    // Impact type weights (0-30)
    const impactWeights: Record<ImpactType, number> = {
      competitive_pressure: 28,
      vendor_displacement: 30,
      talent_competition: 18,
      portfolio_cross_sell: 25,
      supply_chain: 22,
      market_shift: 15,
    };
    const impactScore = impactWeights[path.impactType];

    // Timeframe urgency (0-30)
    const timeframeWeights: Record<Timeframe, number> = {
      immediate: 30,
      '30_days': 22,
      '90_days': 14,
      '6_months': 8,
    };
    const timeframeScore = timeframeWeights[path.timeframe];

    const raw = probabilityScore + impactScore + timeframeScore;
    return Math.min(100, Math.max(0, Math.round(raw)));
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Adjust base probability using signal metadata.
   * Higher signal scores and higher source tiers increase probability.
   */
  private adjustProbability(baseProbability: number, signal: CompanySignal): number {
    let adjusted = baseProbability;

    // Signal score modifier: 0-100 mapped to -0.1 .. +0.1
    const scoreModifier = ((signal.signalScore - 50) / 50) * 0.1;
    adjusted += scoreModifier;

    // Source tier modifier: tier 1 = +0.05, tier 4 = -0.1
    const tierModifiers: Record<number, number> = { 1: 0.05, 2: 0.02, 3: -0.03, 4: -0.1 };
    adjusted += tierModifiers[signal.sourceTier] ?? 0;

    // Strength modifier
    const strengthModifiers: Record<string, number> = {
      critical: 0.1,
      high: 0.05,
      medium: 0,
      low: -0.05,
    };
    adjusted += strengthModifiers[signal.strength] ?? 0;

    return Math.min(1, Math.max(0, Number(adjusted.toFixed(3))));
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function buildAlertSummary(cascade: CascadeEvent, matchingPaths: CascadePath[]): string {
  const company = cascade.triggerSignal.company;
  const event = cascade.triggerSignal.type.replace(/_/g, ' ');
  const count = matchingPaths.length;
  const topImpact = matchingPaths[0];

  if (!topImpact) {
    return `${company} ${event} may impact watched companies.`;
  }

  const impactLabel = topImpact.impactType.replace(/_/g, ' ');
  return (
    `${company} ${event} creates ${count} cascade path${count > 1 ? 's' : ''} ` +
    `affecting your watchlist. Highest-relevance impact: ${impactLabel} ` +
    `on ${topImpact.impactedCompany} (score ${topImpact.commercialRelevance}/100).`
  );
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const cascadePrediction = new CascadePredictionEngine();
