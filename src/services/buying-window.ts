/**
 * Buying Window Predictor Service
 * Predicts when a company will make a purchasing decision based on
 * signal timing, leadership changes, funding velocity, and market cues.
 */

import type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import type { LifecycleStage } from './lifecycle-classifier';

type WindowRange = '0-30 days' | '30-60 days' | '60-90 days' | '90-180 days' | '6+ months';

interface WindowSignal {
  description: string;
  impact: 'accelerating' | 'neutral' | 'decelerating';
  weight: number;
}

interface BuyingWindowPrediction {
  company: string;
  window: WindowRange;
  confidence: number; // 0-1
  keyMilestone: string;
  optimalOutreachDate: Date;
  signals: WindowSignal[];
  predictedAt: Date;
}

const CACHE_KEY = 'buying-window-predictions';

const WINDOW_THRESHOLDS: { range: WindowRange; maxScore: number }[] = [
  { range: '0-30 days', maxScore: 100 },
  { range: '30-60 days', maxScore: 75 },
  { range: '60-90 days', maxScore: 55 },
  { range: '90-180 days', maxScore: 35 },
  { range: '6+ months', maxScore: 0 },
];

class BuyingWindowPredictor {
  private predictions: Map<string, BuyingWindowPrediction> = new Map();
  private initialized = false;

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    const cached = await getPersistentCache<Record<string, BuyingWindowPrediction>>(CACHE_KEY);
    if (cached?.data) {
      for (const [key, value] of Object.entries(cached.data)) {
        this.predictions.set(key, {
          ...value,
          optimalOutreachDate: new Date(value.optimalOutreachDate),
          predictedAt: new Date(value.predictedAt),
        });
      }
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const data: Record<string, BuyingWindowPrediction> = {};
    for (const [key, value] of this.predictions.entries()) {
      data[key] = value;
    }
    await setPersistentCache(CACHE_KEY, data);
  }

  async predictWindow(
    company: string,
    signals: CompanySignal[],
    lifecycle?: LifecycleStage
  ): Promise<BuyingWindowPrediction> {
    await this.ensureLoaded();

    const windowSignals: WindowSignal[] = [];
    let urgencyScore = 0;
    let keyMilestone = 'No specific milestone identified';

    // --- Job posting age analysis ---
    const jobPostings = signals.filter((s) => s.type === 'job_posting');
    if (jobPostings.length > 0) {
      const newestPosting = jobPostings.reduce((a, b) =>
        new Date(a.timestamp) > new Date(b.timestamp) ? a : b
      );
      const ageInDays = daysSince(newestPosting.timestamp);

      if (ageInDays <= 14) {
        urgencyScore += 20;
        windowSignals.push({
          description: `Recent job posting (${ageInDays}d ago) — early evaluation phase`,
          impact: 'accelerating',
          weight: 0.2,
        });
        keyMilestone = 'Active hiring indicates near-term tooling decisions';
      } else if (ageInDays <= 45) {
        urgencyScore += 12;
        windowSignals.push({
          description: `Job posting aging (${ageInDays}d) — mid-evaluation`,
          impact: 'neutral',
          weight: 0.12,
        });
      } else {
        urgencyScore += 3;
        windowSignals.push({
          description: `Stale job posting (${ageInDays}d) — role may be filled or paused`,
          impact: 'decelerating',
          weight: 0.05,
        });
      }
    }

    // --- Funding round timing ---
    const fundingSignals = signals.filter((s) => s.type === 'funding_event');
    if (fundingSignals.length > 0) {
      const latestFunding = fundingSignals.reduce((a, b) =>
        new Date(a.timestamp) > new Date(b.timestamp) ? a : b
      );
      const daysSinceFunding = daysSince(latestFunding.timestamp);

      if (daysSinceFunding >= 60 && daysSinceFunding <= 120) {
        urgencyScore += 25;
        windowSignals.push({
          description: `Funding closed ${daysSinceFunding}d ago — peak spending window`,
          impact: 'accelerating',
          weight: 0.25,
        });
        keyMilestone = `Post-funding spending window (day ${daysSinceFunding} of 120)`;
      } else if (daysSinceFunding < 60) {
        urgencyScore += 15;
        windowSignals.push({
          description: `Recent funding (${daysSinceFunding}d ago) — still onboarding capital`,
          impact: 'accelerating',
          weight: 0.15,
        });
        keyMilestone = `Funding close approaching spending window in ~${60 - daysSinceFunding}d`;
      } else if (daysSinceFunding <= 180) {
        urgencyScore += 8;
        windowSignals.push({
          description: `Funding round aging (${daysSinceFunding}d) — spending window narrowing`,
          impact: 'neutral',
          weight: 0.08,
        });
      } else {
        windowSignals.push({
          description: `Funding round old (${daysSinceFunding}d) — capital likely deployed`,
          impact: 'decelerating',
          weight: 0.03,
        });
      }
    }

    // --- Leadership change / new exec window ---
    const leadershipSignals = signals.filter(
      (s) => s.type === 'executive_movement' || s.type === 'leadership_activity'
    );
    if (leadershipSignals.length > 0) {
      const latest = leadershipSignals.reduce((a, b) =>
        new Date(a.timestamp) > new Date(b.timestamp) ? a : b
      );
      const daysSinceChange = daysSince(latest.timestamp);

      if (daysSinceChange <= 90) {
        urgencyScore += 20;
        windowSignals.push({
          description: `New executive (${daysSinceChange}d) — 90-day vendor review window active`,
          impact: 'accelerating',
          weight: 0.2,
        });
        if (urgencyScore > 30) {
          keyMilestone = `Executive onboarding vendor review (${90 - daysSinceChange}d remaining)`;
        }
      } else if (daysSinceChange <= 180) {
        urgencyScore += 8;
        windowSignals.push({
          description: `Leadership change ${daysSinceChange}d ago — initial review likely complete`,
          impact: 'neutral',
          weight: 0.08,
        });
      }
    }

    // --- Earnings call language ---
    const financialSignals = signals.filter((s) => s.type === 'financial_trigger');
    for (const s of financialSignals) {
      const lower = s.title.toLowerCase() + ' ' + (s.summary?.toLowerCase() ?? '');
      if (lower.includes('invest') || lower.includes('digital transformation') || lower.includes('moderniz')) {
        urgencyScore += 15;
        windowSignals.push({
          description: 'Earnings language signals investment intent',
          impact: 'accelerating',
          weight: 0.15,
        });
        break;
      }
      if (lower.includes('cost cut') || lower.includes('streamlin') || lower.includes('efficien')) {
        urgencyScore += 10;
        windowSignals.push({
          description: 'Earnings language signals cost-optimization focus',
          impact: 'accelerating',
          weight: 0.1,
        });
        break;
      }
    }

    // --- RFP / tender signals ---
    const rfpSignals = signals.filter((s) => s.type === 'tender_rfp');
    if (rfpSignals.length > 0) {
      const latestRfp = rfpSignals.reduce((a, b) =>
        new Date(a.timestamp) > new Date(b.timestamp) ? a : b
      );
      const ageInDays = daysSince(latestRfp.timestamp);

      if (ageInDays <= 30) {
        urgencyScore += 25;
        windowSignals.push({
          description: `Active RFP/tender (${ageInDays}d old) — decision imminent`,
          impact: 'accelerating',
          weight: 0.25,
        });
        keyMilestone = 'Active RFP — buying decision in progress';
      } else if (ageInDays <= 90) {
        urgencyScore += 12;
        windowSignals.push({
          description: `RFP in evaluation phase (${ageInDays}d)`,
          impact: 'neutral',
          weight: 0.12,
        });
      }
    }

    // --- Lifecycle stage modifier ---
    if (lifecycle) {
      const modifier = getLifecycleModifier(lifecycle);
      if (modifier.delta !== 0) {
        urgencyScore += modifier.delta;
        windowSignals.push({
          description: modifier.description,
          impact: modifier.delta > 0 ? 'accelerating' : 'decelerating',
          weight: Math.abs(modifier.delta) / 100,
        });
      }
    }

    // --- Expansion signals ---
    const expansionSignals = signals.filter((s) => s.type === 'expansion_signal');
    if (expansionSignals.length > 0) {
      urgencyScore += 10;
      windowSignals.push({
        description: `${expansionSignals.length} expansion signal(s) — new office/market entry`,
        impact: 'accelerating',
        weight: 0.1,
      });
    }

    // Clamp score
    urgencyScore = Math.max(0, Math.min(100, urgencyScore));

    // Determine window
    const window = scoreToWindow(urgencyScore);

    // Confidence based on signal density
    const signalDensity = Math.min(1, windowSignals.length / 6);
    const confidence = Math.round(Math.min(0.95, 0.3 + signalDensity * 0.6) * 100) / 100;

    // Calculate optimal outreach date
    const outreachOffsetDays = windowToOutreachOffset(window);
    const optimalOutreachDate = new Date();
    optimalOutreachDate.setDate(optimalOutreachDate.getDate() + outreachOffsetDays);

    const prediction: BuyingWindowPrediction = {
      company,
      window,
      confidence,
      keyMilestone,
      optimalOutreachDate,
      signals: windowSignals,
      predictedAt: new Date(),
    };

    this.predictions.set(company.toLowerCase(), prediction);
    await this.persist();

    return prediction;
  }

  async getPrediction(company: string): Promise<BuyingWindowPrediction | undefined> {
    await this.ensureLoaded();
    return this.predictions.get(company.toLowerCase());
  }

  async getRecentPredictions(limit = 20): Promise<BuyingWindowPrediction[]> {
    await this.ensureLoaded();
    return Array.from(this.predictions.values())
      .sort((a, b) => b.predictedAt.getTime() - a.predictedAt.getTime())
      .slice(0, limit);
  }

  async getCompaniesClosingSoon(days = 30): Promise<BuyingWindowPrediction[]> {
    await this.ensureLoaded();
    const closingWindows: WindowRange[] =
      days <= 30
        ? ['0-30 days']
        : days <= 60
          ? ['0-30 days', '30-60 days']
          : ['0-30 days', '30-60 days', '60-90 days'];

    return Array.from(this.predictions.values())
      .filter((p) => closingWindows.includes(p.window))
      .sort((a, b) => {
        const order: Record<WindowRange, number> = {
          '0-30 days': 0,
          '30-60 days': 1,
          '60-90 days': 2,
          '90-180 days': 3,
          '6+ months': 4,
        };
        return order[a.window] - order[b.window];
      });
  }
}

function daysSince(timestamp: Date | string): number {
  const then = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const diff = Date.now() - then.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function scoreToWindow(score: number): WindowRange {
  for (const { range, maxScore } of WINDOW_THRESHOLDS) {
    if (score >= maxScore) return range;
  }
  return '6+ months';
}

function windowToOutreachOffset(window: WindowRange): number {
  switch (window) {
    case '0-30 days': return 3;
    case '30-60 days': return 14;
    case '60-90 days': return 30;
    case '90-180 days': return 60;
    case '6+ months': return 120;
  }
}

function getLifecycleModifier(stage: LifecycleStage): { delta: number; description: string } {
  switch (stage) {
    case 'growth': return { delta: 10, description: 'Growth stage — faster buying cycles' };
    case 'scale': return { delta: 5, description: 'Scale stage — active vendor evaluation' };
    case 'contraction': return { delta: 8, description: 'Contraction — urgent cost-reduction needs' };
    case 'post_acquisition': return { delta: 5, description: 'Post-acquisition — integration buying' };
    case 'pre_seed': return { delta: -10, description: 'Pre-seed — no budget, long horizon' };
    case 'mature': return { delta: -5, description: 'Mature — slower procurement cycles' };
    case 'public': return { delta: -3, description: 'Public — structured procurement process' };
    case 'ma_target': return { delta: -15, description: 'M&A target — decisions likely frozen' };
  }
}

export { BuyingWindowPredictor };
export type { BuyingWindowPrediction, WindowSignal, WindowRange };
export const buyingWindowPredictor = new BuyingWindowPredictor();
