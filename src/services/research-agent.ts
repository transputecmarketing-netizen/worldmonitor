/**
 * Research Agent Orchestrator — SalesIntel
 *
 * Autonomous multi-step DAG that runs parallel + sequential research steps
 * when given a company name. Orchestrates enrichment API calls, processes
 * results through scoring and synthesis, and produces a full ResearchResult.
 */

import { computeAccountHealth, DEFAULT_ICP } from './account-health';
// Re-export CompanySignal so consumers can access it from this module
export type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ResearchStep {
  id: string;
  name: string;
  status: ResearchStatus;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

interface ResearchResult {
  company: string;
  domain?: string;
  status: ResearchStatus;
  steps: ResearchStep[];
  firmographics: {
    name: string;
    domain?: string;
    description?: string;
    location?: string;
    industry?: string;
    founded?: number;
    website?: string;
  } | null;
  techStack: Array<{ name: string; category: string; confidence: number }>;
  signals: Array<{
    type: string;
    title: string;
    source: string;
    timestamp: string;
    strength: string;
    url?: string;
  }>;
  orgChart: Array<{ name: string; title: string }>;
  financials: {
    totalFilings?: number;
    recentFilings?: Array<{ form: string; date: string; description: string }>;
  } | null;
  newsMentions: Array<{ title: string; url: string; points: number; date: string }>;
  whyNowNarrative: string;
  recommendedActions: string[];
  predictedObjections: Array<{ objection: string; counter: string }>;
  accountHealthScore: number;
  propensityScore: number;
  lifecycleStage: string;
  buyingWindow: string;
  startedAt: number;
  completedAt?: number;
  sources: string[];
}

interface ResearchProgress {
  company: string;
  totalSteps: number;
  completedSteps: number;
  currentStep: string;
  partialResult: Partial<ResearchResult>;
}

// ---------------------------------------------------------------------------
// API response shapes (what the enrichment endpoints return)
// ---------------------------------------------------------------------------

interface CompanyEnrichmentResponse {
  name: string;
  domain?: string;
  description?: string;
  location?: string;
  industry?: string;
  founded?: number;
  website?: string;
  employeeCount?: number;
  revenue?: number;
  fundingStage?: string;
  techStack?: Array<{ name: string; category: string; confidence: number }>;
  financials?: {
    totalFilings?: number;
    recentFilings?: Array<{ form: string; date: string; description: string }>;
  };
}

interface SignalEnrichmentResponse {
  company: string;
  signals: Array<{
    type: string;
    title: string;
    source: string;
    timestamp: string;
    strength: string;
    url?: string;
    people?: string[];
    jobTitle?: string;
    fundingAmount?: string;
  }>;
  newsMentions?: Array<{ title: string; url: string; points: number; date: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const CACHE_KEY_PREFIX = 'research-agent:';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const SIGNAL_TYPE_CATEGORIES: Record<string, string> = {
  executive_movement: 'People',
  funding_event: 'Financial',
  expansion_signal: 'Growth',
  technology_adoption: 'Technology',
  hiring_surge: 'People',
  financial_trigger: 'Financial',
  leadership_activity: 'People',
  press_release: 'Media',
  job_posting: 'People',
  tender_rfp: 'Procurement',
};

const LIFECYCLE_STAGES = ['unknown', 'awareness', 'consideration', 'evaluation', 'decision'] as const;

// ---------------------------------------------------------------------------
// Fetch with retry + timeout (circuit-breaker style)
// ---------------------------------------------------------------------------

async function fetchWithRetry<T>(url: string, retries: number = MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry exhausted retries');
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function createStep(id: string, name: string): ResearchStep {
  return { id, name, status: 'pending' };
}

function startStep(step: ResearchStep): void {
  step.status = 'running';
  step.startedAt = Date.now();
}

function completeStep(step: ResearchStep, result: unknown): void {
  step.status = 'completed';
  step.completedAt = Date.now();
  step.result = result;
}

function failStep(step: ResearchStep, error: string): void {
  step.status = 'failed';
  step.completedAt = Date.now();
  step.error = error;
}

// ---------------------------------------------------------------------------
// Signal classification helpers
// ---------------------------------------------------------------------------

interface ClassifiedSignal {
  type: string;
  title: string;
  source: string;
  timestamp: string;
  strength: string;
  url?: string;
  category: string;
}

function classifySignals(
  rawSignals: SignalEnrichmentResponse['signals'],
): ClassifiedSignal[] {
  return rawSignals.map(signal => ({
    ...signal,
    category: SIGNAL_TYPE_CATEGORIES[signal.type] ?? 'Other',
  }));
}

function extractOrgChart(
  rawSignals: SignalEnrichmentResponse['signals'],
): Array<{ name: string; title: string }> {
  const seen = new Set<string>();
  const entries: Array<{ name: string; title: string }> = [];

  for (const signal of rawSignals) {
    if (!signal.people) continue;
    for (const person of signal.people) {
      const key = person.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        name: person,
        title: signal.jobTitle ?? inferTitleFromSignal(signal.type, signal.title),
      });
    }
  }

  return entries;
}

function inferTitleFromSignal(signalType: string, title: string): string {
  const titleLower = title.toLowerCase();
  if (titleLower.includes('ceo') || titleLower.includes('chief executive')) return 'CEO';
  if (titleLower.includes('cto') || titleLower.includes('chief technology')) return 'CTO';
  if (titleLower.includes('cfo') || titleLower.includes('chief financial')) return 'CFO';
  if (titleLower.includes('coo') || titleLower.includes('chief operating')) return 'COO';
  if (titleLower.includes('vp ') || titleLower.includes('vice president')) return 'VP';
  if (titleLower.includes('director')) return 'Director';
  if (signalType === 'executive_movement' || signalType === 'leadership_activity') return 'Executive';
  return 'Employee';
}

function identifyCompetitors(
  description: string | undefined,
  industry: string | undefined,
): string[] {
  if (!description && !industry) return [];
  const text = `${description ?? ''} ${industry ?? ''}`.toLowerCase();

  const competitorKeywords = [
    'competes with', 'competitor', 'alternative to', 'compared to', 'versus', 'vs.',
  ];

  const competitors: string[] = [];
  for (const keyword of competitorKeywords) {
    const idx = text.indexOf(keyword);
    if (idx !== -1) {
      const after = text.slice(idx + keyword.length, idx + keyword.length + 100);
      const matches = after.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g);
      if (matches) {
        competitors.push(...matches.slice(0, 3));
      }
    }
  }

  return [...new Set(competitors)];
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function calcPropensityScore(classified: ClassifiedSignal[]): number {
  if (classified.length === 0) return 0;

  const highIntentTypes = new Set([
    'funding_event', 'tender_rfp', 'hiring_surge', 'technology_adoption',
  ]);

  let score = 0;
  const strengthWeights: Record<string, number> = {
    critical: 15,
    high: 10,
    medium: 5,
    low: 2,
  };

  for (const signal of classified) {
    const base = strengthWeights[signal.strength] ?? 2;
    const multiplier = highIntentTypes.has(signal.type) ? 1.5 : 1.0;
    score += base * multiplier;
  }

  // Diversity bonus: more distinct categories raise the score
  const categories = new Set(classified.map(s => s.category));
  score += categories.size * 5;

  return Math.round(Math.min(100, score));
}

function predictBuyingWindow(classified: ClassifiedSignal[]): string {
  if (classified.length === 0) return 'No signals';

  const now = Date.now();
  const recentThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
  const midThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days

  const recentCount = classified.filter(s => {
    const ts = new Date(s.timestamp).getTime();
    return (now - ts) <= recentThreshold;
  }).length;

  const midCount = classified.filter(s => {
    const ts = new Date(s.timestamp).getTime();
    return (now - ts) > recentThreshold && (now - ts) <= midThreshold;
  }).length;

  const hasHighIntent = classified.some(
    s => s.type === 'tender_rfp' || s.type === 'funding_event',
  );

  if (hasHighIntent && recentCount >= 3) return '0-30 days';
  if (recentCount >= 2) return '30-60 days';
  if (midCount >= 3) return '60-90 days';
  if (classified.length > 0) return '90-180 days';
  return 'No buying window detected';
}

function classifyLifecycleStage(classified: ClassifiedSignal[]): string {
  if (classified.length === 0) return LIFECYCLE_STAGES[0];

  const types = new Set(classified.map(s => s.type));

  if (types.has('tender_rfp')) return LIFECYCLE_STAGES[4]; // decision
  if (types.has('technology_adoption') && types.size >= 3) return LIFECYCLE_STAGES[3]; // evaluation
  if (types.has('hiring_surge') || types.has('funding_event')) return LIFECYCLE_STAGES[2]; // consideration
  if (types.size >= 2) return LIFECYCLE_STAGES[1]; // awareness
  return LIFECYCLE_STAGES[0]; // unknown
}

// ---------------------------------------------------------------------------
// Synthesis helpers (template-based, not LLM)
// ---------------------------------------------------------------------------

function generateWhyNowNarrative(
  company: string,
  classified: ClassifiedSignal[],
  score: number,
): string {
  if (classified.length === 0) {
    return `${company} has limited signal activity at this time. Consider monitoring for future opportunities.`;
  }

  const fundingSignal = classified.find(s => s.type === 'funding_event');
  const hiringSignal = classified.find(s => s.type === 'hiring_surge');
  const executiveSignal = classified.find(s => s.type === 'executive_movement');
  const techSignal = classified.find(s => s.type === 'technology_adoption');

  const signalTypes = [...new Set(classified.map(s => s.category))].join(', ');

  let narrative = `${company} presents a strong opportunity right now.`;

  if (fundingSignal) {
    narrative += ` They recently ${fundingSignal.title.toLowerCase()}, creating budget for new initiatives.`;
  }
  if (hiringSignal) {
    narrative += ` Their hiring activity suggests ${hiringSignal.title.toLowerCase()}.`;
  }
  if (executiveSignal) {
    narrative += ` A recent executive change (${executiveSignal.title.toLowerCase()}) opens a window for new vendor conversations.`;
  }
  if (techSignal) {
    narrative += ` Technology adoption signals indicate active evaluation of solutions.`;
  }

  narrative += ` With ${classified.length} active signals across ${signalTypes} categories, the convergence score is ${score}/100.`;

  return narrative;
}

function generateRecommendedActions(
  classified: ClassifiedSignal[],
  lifecycleStage: string,
): string[] {
  const actions: string[] = [];
  const types = new Set(classified.map(s => s.type));

  if (types.has('tender_rfp')) {
    actions.push('Prepare and submit proposal for active RFP/tender immediately.');
  }
  if (types.has('funding_event')) {
    actions.push('Reach out with growth-focused messaging — new budget likely available.');
  }
  if (types.has('executive_movement')) {
    actions.push('Connect with newly appointed executive before incumbent vendors lock in.');
  }
  if (types.has('hiring_surge')) {
    actions.push('Position solution around scaling challenges and onboarding efficiency.');
  }
  if (types.has('technology_adoption')) {
    actions.push('Share competitive comparison and migration/integration playbook.');
  }

  if (lifecycleStage === 'evaluation' || lifecycleStage === 'decision') {
    actions.push('Schedule executive briefing to accelerate deal progression.');
  }
  if (lifecycleStage === 'awareness' || lifecycleStage === 'consideration') {
    actions.push('Send relevant case study to nurture interest and build credibility.');
  }

  if (actions.length === 0) {
    actions.push('Monitor account for emerging signals and set up alerts.');
  }

  return actions;
}

function generatePredictedObjections(
  classified: ClassifiedSignal[],
  firmographics: ResearchResult['firmographics'],
): Array<{ objection: string; counter: string }> {
  const objections: Array<{ objection: string; counter: string }> = [];
  const types = new Set(classified.map(s => s.type));

  if (types.has('funding_event')) {
    objections.push({
      objection: 'We just raised funding and are focused on hiring, not new tools.',
      counter: 'New tools adopted during scaling phases compound ROI. Early adoption before headcount doubles avoids costly migration later.',
    });
  }

  if (types.has('executive_movement')) {
    objections.push({
      objection: 'We have a new leadership team and need time to settle in.',
      counter: 'New leaders often want quick wins. Our solution can deliver measurable results within the first 90 days to build internal credibility.',
    });
  }

  if (types.has('hiring_surge')) {
    objections.push({
      objection: 'We are growing fast and do not have bandwidth to evaluate new vendors.',
      counter: 'Our onboarding takes under a week. Customers at your growth stage typically see productivity gains that free up 10+ hours per team per month.',
    });
  }

  // Generic objections that apply broadly
  objections.push({
    objection: 'We already have an incumbent solution in place.',
    counter: `Based on signal data, your team is actively evaluating alternatives. We can provide a no-risk pilot to demonstrate concrete improvements over your current setup.`,
  });

  if (firmographics?.industry) {
    objections.push({
      objection: `Is your solution proven in the ${firmographics.industry} space?`,
      counter: `We have multiple ${firmographics.industry} customers and can share relevant case studies and references.`,
    });
  }

  return objections;
}

// ---------------------------------------------------------------------------
// ResearchAgent class (singleton)
// ---------------------------------------------------------------------------

type ProgressCallback = (progress: ResearchProgress) => void;

class ResearchAgent {
  private activeResearch = new Map<string, {
    result: Partial<ResearchResult>;
    steps: ResearchStep[];
    abortController: AbortController;
    promise: Promise<ResearchResult>;
  }>();

  private completedResults = new Map<string, ResearchResult>();
  private progressListeners: ProgressCallback[] = [];

  // ---- Public API ---------------------------------------------------------

  async runResearch(company: string, domain?: string): Promise<ResearchResult> {
    const key = this.cacheKey(company);

    // Return existing in-flight research
    const existing = this.activeResearch.get(key);
    if (existing) return existing.promise;

    // Check persistent cache
    const cached = await this.loadFromCache(key);
    if (cached) {
      this.completedResults.set(key, cached);
      return cached;
    }

    // Build the DAG
    const abortController = new AbortController();
    const steps = this.buildSteps();
    const partialResult: Partial<ResearchResult> = {
      company,
      domain,
      status: 'running',
      steps,
      startedAt: Date.now(),
      sources: [],
    };

    const promise = this.executeDAG(company, domain, steps, partialResult, abortController);

    this.activeResearch.set(key, { result: partialResult, steps, abortController, promise });

    const result = await promise.finally(() => {
      this.activeResearch.delete(key);
    });

    this.completedResults.set(key, result);
    await this.saveToCache(key, result);

    return result;
  }

  getProgress(company: string): ResearchProgress | null {
    const key = this.cacheKey(company);
    const active = this.activeResearch.get(key);
    if (!active) return null;

    const completedSteps = active.steps.filter(s => s.status === 'completed').length;
    const currentStep = active.steps.find(s => s.status === 'running')?.name
      ?? active.steps.find(s => s.status === 'pending')?.name
      ?? 'Finalizing';

    return {
      company,
      totalSteps: active.steps.length,
      completedSteps,
      currentStep,
      partialResult: active.result,
    };
  }

  getResult(company: string): ResearchResult | null {
    return this.completedResults.get(this.cacheKey(company)) ?? null;
  }

  getCachedResults(): ResearchResult[] {
    return [...this.completedResults.values()];
  }

  cancelResearch(company: string): boolean {
    const key = this.cacheKey(company);
    const active = this.activeResearch.get(key);
    if (!active) return false;

    active.abortController.abort();
    this.activeResearch.delete(key);
    return true;
  }

  onProgress(callback: ProgressCallback): () => void {
    this.progressListeners.push(callback);
    return () => {
      const idx = this.progressListeners.indexOf(callback);
      if (idx !== -1) this.progressListeners.splice(idx, 1);
    };
  }

  // ---- DAG steps definition -----------------------------------------------

  private buildSteps(): ResearchStep[] {
    return [
      createStep('fetch-company', 'Fetch company enrichment'),
      createStep('fetch-signals', 'Fetch signals'),
      createStep('classify-signals', 'Classify signals'),
      createStep('extract-org-chart', 'Extract org chart'),
      createStep('identify-competitors', 'Identify competitors'),
      createStep('calc-health-score', 'Calculate account health score'),
      createStep('calc-propensity', 'Calculate propensity to buy'),
      createStep('predict-window', 'Predict buying window'),
      createStep('classify-lifecycle', 'Classify lifecycle stage'),
      createStep('generate-narrative', 'Generate Why Now narrative'),
      createStep('generate-actions', 'Generate recommended actions'),
      createStep('generate-objections', 'Generate predicted objections'),
    ];
  }

  private getStep(steps: ResearchStep[], id: string): ResearchStep {
    const step = steps.find(s => s.id === id);
    if (!step) throw new Error(`Step not found: ${id}`);
    return step;
  }

  // ---- DAG execution ------------------------------------------------------

  private async executeDAG(
    company: string,
    domain: string | undefined,
    steps: ResearchStep[],
    partial: Partial<ResearchResult>,
    abortController: AbortController,
  ): Promise<ResearchResult> {
    const sources: string[] = [];

    try {
      // ------------------------------------------------------------------
      // STEP 1 — Parallel: fetch company enrichment + signals
      // ------------------------------------------------------------------
      const companyStep = this.getStep(steps, 'fetch-company');
      const signalsStep = this.getStep(steps, 'fetch-signals');

      startStep(companyStep);
      startStep(signalsStep);
      this.emitProgress(company, steps, partial);

      const companyUrl = domain
        ? `/api/enrichment/company?domain=${encodeURIComponent(domain)}`
        : `/api/enrichment/company?name=${encodeURIComponent(company)}`;

      const signalsUrl = `/api/enrichment/signals?company=${encodeURIComponent(company)}`;

      this.checkAborted(abortController);

      const [companyData, signalsData] = await Promise.allSettled([
        fetchWithRetry<CompanyEnrichmentResponse>(companyUrl),
        fetchWithRetry<SignalEnrichmentResponse>(signalsUrl),
      ]);

      const enrichment = companyData.status === 'fulfilled' ? companyData.value : null;
      const signalResponse = signalsData.status === 'fulfilled' ? signalsData.value : null;

      if (enrichment) {
        completeStep(companyStep, enrichment);
        sources.push('/api/enrichment/company');
      } else {
        failStep(companyStep, companyData.status === 'rejected'
          ? (companyData.reason instanceof Error ? companyData.reason.message : String(companyData.reason))
          : 'Unknown error');
      }

      if (signalResponse) {
        completeStep(signalsStep, signalResponse);
        sources.push('/api/enrichment/signals');
      } else {
        failStep(signalsStep, signalsData.status === 'rejected'
          ? (signalsData.reason instanceof Error ? signalsData.reason.message : String(signalsData.reason))
          : 'Unknown error');
      }

      // Assemble firmographics
      partial.firmographics = enrichment ? {
        name: enrichment.name,
        domain: enrichment.domain,
        description: enrichment.description,
        location: enrichment.location,
        industry: enrichment.industry,
        founded: enrichment.founded,
        website: enrichment.website,
      } : null;

      partial.techStack = enrichment?.techStack ?? [];
      partial.financials = enrichment?.financials ?? null;

      const rawSignals = signalResponse?.signals ?? [];
      partial.signals = rawSignals.map(s => ({
        type: s.type,
        title: s.title,
        source: s.source,
        timestamp: s.timestamp,
        strength: s.strength,
        url: s.url,
      }));
      partial.newsMentions = signalResponse?.newsMentions ?? [];
      partial.sources = sources;

      this.emitProgress(company, steps, partial);

      // ------------------------------------------------------------------
      // STEP 2 — Depends on Step 1: classify, extract, identify
      // ------------------------------------------------------------------
      this.checkAborted(abortController);

      const classifyStep = this.getStep(steps, 'classify-signals');
      const orgStep = this.getStep(steps, 'extract-org-chart');
      const competitorStep = this.getStep(steps, 'identify-competitors');

      startStep(classifyStep);
      startStep(orgStep);
      startStep(competitorStep);
      this.emitProgress(company, steps, partial);

      const classified = classifySignals(rawSignals);
      completeStep(classifyStep, classified);

      const orgChart = extractOrgChart(rawSignals);
      partial.orgChart = orgChart;
      completeStep(orgStep, orgChart);

      const competitors = identifyCompetitors(enrichment?.description, enrichment?.industry);
      completeStep(competitorStep, competitors);

      this.emitProgress(company, steps, partial);

      // ------------------------------------------------------------------
      // STEP 3 — Depends on Step 2: scoring
      // ------------------------------------------------------------------
      this.checkAborted(abortController);

      const healthStep = this.getStep(steps, 'calc-health-score');
      const propensityStep = this.getStep(steps, 'calc-propensity');
      const windowStep = this.getStep(steps, 'predict-window');
      const lifecycleStep = this.getStep(steps, 'classify-lifecycle');

      startStep(healthStep);
      startStep(propensityStep);
      startStep(windowStep);
      startStep(lifecycleStep);
      this.emitProgress(company, steps, partial);

      // Build CompanyInfo for account health computation
      const companyInfo = {
        name: enrichment?.name ?? company,
        domain: enrichment?.domain ?? domain,
        industry: enrichment?.industry ?? 'Unknown',
        employeeCount: enrichment?.employeeCount ?? 0,
        region: enrichment?.location ?? 'Unknown',
        techStack: (enrichment?.techStack ?? []).map(t => t.name),
        revenue: enrichment?.revenue,
        fundingStage: enrichment?.fundingStage,
      };

      // Convert classified signals to AccountSignal format for health computation
      const accountSignals = classified.map((s, i) => ({
        id: `signal-${i}`,
        type: s.type,
        strength: this.mapStrength(s.strength),
        timestamp: new Date(s.timestamp),
        source: s.source,
        isCLevelActivity: s.type === 'executive_movement' || s.type === 'leadership_activity',
        isPublicTouchpoint: s.type === 'press_release' || s.type === 'tender_rfp',
      }));

      const healthResult = computeAccountHealth(companyInfo, accountSignals, DEFAULT_ICP);
      partial.accountHealthScore = healthResult.score;
      completeStep(healthStep, healthResult);

      const propensity = calcPropensityScore(classified);
      partial.propensityScore = propensity;
      completeStep(propensityStep, propensity);

      const buyingWindow = predictBuyingWindow(classified);
      partial.buyingWindow = buyingWindow;
      completeStep(windowStep, buyingWindow);

      const lifecycle = classifyLifecycleStage(classified);
      partial.lifecycleStage = lifecycle;
      completeStep(lifecycleStep, lifecycle);

      this.emitProgress(company, steps, partial);

      // ------------------------------------------------------------------
      // STEP 4 — Depends on Step 3: synthesis
      // ------------------------------------------------------------------
      this.checkAborted(abortController);

      const narrativeStep = this.getStep(steps, 'generate-narrative');
      const actionsStep = this.getStep(steps, 'generate-actions');
      const objectionsStep = this.getStep(steps, 'generate-objections');

      startStep(narrativeStep);
      startStep(actionsStep);
      startStep(objectionsStep);
      this.emitProgress(company, steps, partial);

      const narrative = generateWhyNowNarrative(company, classified, healthResult.score);
      partial.whyNowNarrative = narrative;
      completeStep(narrativeStep, narrative);

      const actions = generateRecommendedActions(classified, lifecycle);
      partial.recommendedActions = actions;
      completeStep(actionsStep, actions);

      const objections = generatePredictedObjections(classified, partial.firmographics ?? null);
      partial.predictedObjections = objections;
      completeStep(objectionsStep, objections);

      // ------------------------------------------------------------------
      // Finalize
      // ------------------------------------------------------------------
      partial.status = 'completed';
      partial.completedAt = Date.now();
      this.emitProgress(company, steps, partial);

      return this.assembleResult(company, domain, steps, partial, sources);

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Mark any running steps as failed
      for (const step of steps) {
        if (step.status === 'running') {
          failStep(step, errorMsg);
        }
      }

      partial.status = 'failed';
      partial.completedAt = Date.now();
      this.emitProgress(company, steps, partial);

      return this.assembleResult(company, domain, steps, partial, sources);
    }
  }

  // ---- Assembly -----------------------------------------------------------

  private assembleResult(
    company: string,
    domain: string | undefined,
    steps: ResearchStep[],
    partial: Partial<ResearchResult>,
    sources: string[],
  ): ResearchResult {
    return {
      company,
      domain,
      status: partial.status ?? 'failed',
      steps,
      firmographics: partial.firmographics ?? null,
      techStack: partial.techStack ?? [],
      signals: partial.signals ?? [],
      orgChart: partial.orgChart ?? [],
      financials: partial.financials ?? null,
      newsMentions: partial.newsMentions ?? [],
      whyNowNarrative: partial.whyNowNarrative ?? '',
      recommendedActions: partial.recommendedActions ?? [],
      predictedObjections: partial.predictedObjections ?? [],
      accountHealthScore: partial.accountHealthScore ?? 0,
      propensityScore: partial.propensityScore ?? 0,
      lifecycleStage: partial.lifecycleStage ?? 'unknown',
      buyingWindow: partial.buyingWindow ?? 'No buying window detected',
      startedAt: partial.startedAt ?? Date.now(),
      completedAt: partial.completedAt,
      sources,
    };
  }

  // ---- Helpers ------------------------------------------------------------

  private mapStrength(strength: string): 'critical' | 'high' | 'medium' | 'low' {
    switch (strength) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      default: return 'low';
    }
  }

  private checkAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new Error('Research cancelled');
    }
  }

  private cacheKey(company: string): string {
    return company.trim().toLowerCase();
  }

  private emitProgress(
    company: string,
    steps: ResearchStep[],
    partial: Partial<ResearchResult>,
  ): void {
    if (this.progressListeners.length === 0) return;

    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const currentStep = steps.find(s => s.status === 'running')?.name
      ?? steps.find(s => s.status === 'pending')?.name
      ?? 'Finalizing';

    const progress: ResearchProgress = {
      company,
      totalSteps: steps.length,
      completedSteps,
      currentStep,
      partialResult: { ...partial },
    };

    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch {
        // Swallow listener errors to avoid disrupting the DAG
      }
    }
  }

  // ---- Persistent cache integration ---------------------------------------

  private async loadFromCache(key: string): Promise<ResearchResult | null> {
    try {
      const envelope = await getPersistentCache<ResearchResult>(`${CACHE_KEY_PREFIX}${key}`);
      if (!envelope) return null;

      const ageMs = Date.now() - envelope.updatedAt;
      if (ageMs > CACHE_TTL_MS) return null;

      return envelope.data;
    } catch {
      return null;
    }
  }

  private async saveToCache(key: string, result: ResearchResult): Promise<void> {
    try {
      await setPersistentCache(`${CACHE_KEY_PREFIX}${key}`, result);
    } catch {
      // Cache write failure is non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const researchAgent = new ResearchAgent();

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type {
  ResearchStatus,
  ResearchStep,
  ResearchResult,
  ResearchProgress,
};
