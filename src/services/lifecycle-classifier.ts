/**
 * Lifecycle Classifier Service
 * Classifies companies into lifecycle stages based on commercial signals
 * and firmographic data, producing stage-specific sales implications.
 */

import type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

type LifecycleStage =
  | 'pre_seed'
  | 'growth'
  | 'scale'
  | 'mature'
  | 'public'
  | 'contraction'
  | 'ma_target'
  | 'post_acquisition';

interface LifecycleClassification {
  company: string;
  stage: LifecycleStage;
  confidence: number; // 0-1
  indicators: string[];
  salesImplication: string;
  recommendedApproach: string;
  classifiedAt: Date;
}

interface Firmographics {
  employeeCount?: number;
  annualRevenue?: number;
  yearFounded?: number;
  isPublic?: boolean;
  recentAcquisition?: boolean;
  parentCompany?: string;
  industry?: string;
}

const CACHE_KEY = 'lifecycle-classifications';

const SALES_IMPLICATIONS: Record<LifecycleStage, { implication: string; approach: string }> = {
  pre_seed: {
    implication: 'Too early — no budget, founder-led decisions only',
    approach: 'Plant seeds for future relationship; offer free tier or community access',
  },
  growth: {
    implication: 'Greenfield — building stack now, fast decisions, budget unlocked',
    approach: 'Lead with speed-to-value and scalability story; target VP-level buyer',
  },
  scale: {
    implication: 'Replacement/consolidation play — outgrowing early tools',
    approach: 'Emphasize enterprise readiness, migration support, and ROI over incumbents',
  },
  mature: {
    implication: 'Procurement-heavy — long cycles, risk-averse, multi-stakeholder',
    approach: 'Engage procurement early; prepare business case with TCO analysis',
  },
  public: {
    implication: 'Compliance-driven — security, governance, and audit requirements dominate',
    approach: 'Lead with compliance certifications, SLAs, and reference customers in same sector',
  },
  contraction: {
    implication: 'Cost-optimization pitch — consolidation and savings messaging',
    approach: 'Position as cost-reduction lever; show concrete savings vs current stack',
  },
  ma_target: {
    implication: 'Decisions frozen — awaiting acquirer direction, but integration creates needs',
    approach: 'Monitor for close; prepare integration pitch for post-acquisition tech consolidation',
  },
  post_acquisition: {
    implication: 'Integration window — new parent may mandate vendor standardization',
    approach: 'Target integration PMO; align with parent company standards if already a customer',
  },
};

interface StageScores {
  stage: LifecycleStage;
  score: number;
  indicators: string[];
}

class LifecycleClassifier {
  private classifications: Map<string, LifecycleClassification> = new Map();
  private initialized = false;

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    const cached = await getPersistentCache<Record<string, LifecycleClassification>>(CACHE_KEY);
    if (cached?.data) {
      for (const [key, value] of Object.entries(cached.data)) {
        this.classifications.set(key, {
          ...value,
          classifiedAt: new Date(value.classifiedAt),
        });
      }
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const data: Record<string, LifecycleClassification> = {};
    for (const [key, value] of this.classifications.entries()) {
      data[key] = value;
    }
    await setPersistentCache(CACHE_KEY, data);
  }

  async classifyCompany(
    company: string,
    signals: CompanySignal[],
    firmographics?: Firmographics
  ): Promise<LifecycleClassification> {
    await this.ensureLoaded();

    const candidates = this.evaluateStages(signals, firmographics);
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0]!;
    const runnerUp = candidates[1];

    // Confidence is the gap between the top two candidates, normalized
    const gap = best.score - (runnerUp?.score ?? 0);
    const totalWeight = best.score + (runnerUp?.score ?? 0);
    const confidence = totalWeight > 0
      ? Math.min(1, Math.max(0.1, gap / totalWeight + 0.3))
      : 0.1;

    const { implication, approach } = SALES_IMPLICATIONS[best.stage];

    const classification: LifecycleClassification = {
      company,
      stage: best.stage,
      confidence: Math.round(confidence * 100) / 100,
      indicators: best.indicators,
      salesImplication: implication,
      recommendedApproach: approach,
      classifiedAt: new Date(),
    };

    this.classifications.set(company.toLowerCase(), classification);
    await this.persist();

    return classification;
  }

  async getClassification(company: string): Promise<LifecycleClassification | undefined> {
    await this.ensureLoaded();
    return this.classifications.get(company.toLowerCase());
  }

  async listClassifications(): Promise<LifecycleClassification[]> {
    await this.ensureLoaded();
    return Array.from(this.classifications.values());
  }

  private evaluateStages(
    signals: CompanySignal[],
    firmographics?: Firmographics
  ): StageScores[] {
    const typeCounts = new Map<string, number>();
    for (const s of signals) {
      typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
    }

    const hasFunding = (typeCounts.get('funding_event') ?? 0) > 0;
    const hasHiringSurge = (typeCounts.get('hiring_surge') ?? 0) > 0;
    const hasExpansion = (typeCounts.get('expansion_signal') ?? 0) > 0;
    const hasLayoffs = signals.some(
      (s) => s.type === 'hiring_surge' && s.title.toLowerCase().includes('layoff')
    );
    const hasContraction = signals.some(
      (s) =>
        s.type === 'financial_trigger' &&
        (s.title.toLowerCase().includes('downsiz') ||
          s.title.toLowerCase().includes('restructur') ||
          s.title.toLowerCase().includes('layoff'))
    );
    const hasSecFilings = signals.some(
      (s) =>
        s.type === 'financial_trigger' &&
        (s.title.toLowerCase().includes('sec') ||
          s.title.toLowerCase().includes('ipo') ||
          s.title.toLowerCase().includes('s-1'))
    );
    const hasAcquisition = signals.some(
      (s) =>
        s.title.toLowerCase().includes('acqui') ||
        s.title.toLowerCase().includes('merger') ||
        s.title.toLowerCase().includes('takeover')
    );
    const hasPostAcq = signals.some(
      (s) =>
        s.title.toLowerCase().includes('integration') ||
        s.title.toLowerCase().includes('post-acquisition') ||
        s.title.toLowerCase().includes('merged')
    );
    const hasTechAdoption = (typeCounts.get('technology_adoption') ?? 0) > 0;
    const hasExecMovement = (typeCounts.get('executive_movement') ?? 0) > 0;
    const fundingSignals = signals.filter((s) => s.type === 'funding_event');
    const hasSmallFunding = fundingSignals.some((s) => {
      const amt = parseFundingAmount(s.fundingAmount);
      return amt !== null && amt < 5_000_000;
    });
    const hasLargeFunding = fundingSignals.some((s) => {
      const amt = parseFundingAmount(s.fundingAmount);
      return amt !== null && amt >= 50_000_000;
    });

    const stages: StageScores[] = [];

    // Pre-seed
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasSmallFunding) { score += 40; indicators.push('Small funding round detected'); }
      if (firmographics?.employeeCount !== undefined && firmographics.employeeCount < 20) {
        score += 30; indicators.push(`Small team (${firmographics.employeeCount} employees)`);
      }
      if (firmographics?.yearFounded !== undefined) {
        const age = new Date().getFullYear() - firmographics.yearFounded;
        if (age <= 2) { score += 20; indicators.push(`Recently founded (${firmographics.yearFounded})`); }
      }
      stages.push({ stage: 'pre_seed', score, indicators });
    }

    // Growth
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasFunding && !hasSmallFunding) { score += 35; indicators.push('Funding event detected'); }
      if (hasHiringSurge && !hasLayoffs) { score += 25; indicators.push('Active hiring surge'); }
      if (hasTechAdoption) { score += 15; indicators.push('New technology adoption signals'); }
      if (firmographics?.employeeCount !== undefined && firmographics.employeeCount >= 20 && firmographics.employeeCount < 200) {
        score += 15; indicators.push(`Mid-size team (${firmographics.employeeCount} employees)`);
      }
      stages.push({ stage: 'growth', score, indicators });
    }

    // Scale
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasHiringSurge && hasExpansion) { score += 35; indicators.push('Hiring + expansion signals co-occurring'); }
      if (hasLargeFunding) { score += 25; indicators.push('Large funding round (Series C+)'); }
      if (hasExecMovement) { score += 15; indicators.push('Executive movement detected'); }
      if (firmographics?.employeeCount !== undefined && firmographics.employeeCount >= 200 && firmographics.employeeCount < 2000) {
        score += 15; indicators.push(`Scale-stage headcount (${firmographics.employeeCount})`);
      }
      stages.push({ stage: 'scale', score, indicators });
    }

    // Mature
    {
      let score = 0;
      const indicators: string[] = [];
      if (firmographics?.employeeCount !== undefined && firmographics.employeeCount >= 2000) {
        score += 30; indicators.push(`Large organization (${firmographics.employeeCount}+ employees)`);
      }
      if (firmographics?.annualRevenue !== undefined && firmographics.annualRevenue > 100_000_000) {
        score += 25; indicators.push('Revenue exceeds $100M');
      }
      if (firmographics?.yearFounded !== undefined) {
        const age = new Date().getFullYear() - firmographics.yearFounded;
        if (age > 15) { score += 20; indicators.push(`Established company (founded ${firmographics.yearFounded})`); }
      }
      if (!hasFunding && !hasHiringSurge) { score += 10; indicators.push('No recent growth signals'); }
      stages.push({ stage: 'mature', score, indicators });
    }

    // Public
    {
      let score = 0;
      const indicators: string[] = [];
      if (firmographics?.isPublic) { score += 50; indicators.push('Publicly traded'); }
      if (hasSecFilings) { score += 30; indicators.push('SEC filing or IPO signals detected'); }
      if (firmographics?.annualRevenue !== undefined && firmographics.annualRevenue > 500_000_000) {
        score += 15; indicators.push('Revenue exceeds $500M');
      }
      stages.push({ stage: 'public', score, indicators });
    }

    // Contraction
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasLayoffs) { score += 35; indicators.push('Layoff signals detected'); }
      if (hasContraction) { score += 35; indicators.push('Restructuring or downsizing signals'); }
      if (!hasFunding && !hasExpansion && hasContraction) {
        score += 15; indicators.push('No growth signals alongside contraction');
      }
      stages.push({ stage: 'contraction', score, indicators });
    }

    // M&A Target
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasAcquisition && !hasPostAcq) { score += 50; indicators.push('Acquisition or merger signals (pre-close)'); }
      if (hasExecMovement && hasAcquisition) { score += 20; indicators.push('Executive changes alongside M&A activity'); }
      stages.push({ stage: 'ma_target', score, indicators });
    }

    // Post-Acquisition
    {
      let score = 0;
      const indicators: string[] = [];
      if (hasPostAcq) { score += 45; indicators.push('Post-acquisition integration signals'); }
      if (firmographics?.parentCompany) { score += 30; indicators.push(`Parent company: ${firmographics.parentCompany}`); }
      if (firmographics?.recentAcquisition) { score += 20; indicators.push('Recently acquired'); }
      stages.push({ stage: 'post_acquisition', score, indicators });
    }

    return stages;
  }
}

function parseFundingAmount(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '').toLowerCase();
  const match = cleaned.match(/^([\d.]+)(m|b|k)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]!);
  if (isNaN(num)) return null;
  const suffix = match[2];
  if (suffix === 'b') return num * 1_000_000_000;
  if (suffix === 'm') return num * 1_000_000;
  if (suffix === 'k') return num * 1_000;
  return num;
}

export { LifecycleClassifier };
export type { LifecycleStage, LifecycleClassification };
export const lifecycleClassifier = new LifecycleClassifier();
