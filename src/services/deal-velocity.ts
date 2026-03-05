/**
 * Deal Velocity Predictor Service
 *
 * Predicts deal momentum based on signal patterns. Classifies deals as
 * accelerating, steady, decelerating, or stalled by analyzing the mix
 * of positive and negative signals. Estimates days to close based on
 * historical stage durations and current signal velocity.
 *
 * Persists assessments via IndexedDB-backed persistent cache.
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type VelocityStatus = 'accelerating' | 'steady' | 'decelerating' | 'stalled';

export interface VelocitySignal {
  description: string;
  impact: number; // -10 to +10
  source: string;
  timestamp: Date;
}

export interface DealVelocity {
  dealId: string;
  company: string;
  status: VelocityStatus;
  score: number; // -100 to +100 (negative = decelerating)
  accelerators: VelocitySignal[];
  decelerators: VelocitySignal[];
  prediction: string;
  daysToClose: number | null;
  assessedAt: Date;
}

interface StallRiskResult {
  daysInStage: number;
  stallProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

interface SerializedVelocitySignal {
  description: string;
  impact: number;
  source: string;
  timestamp: string;
}

interface SerializedDealVelocity {
  dealId: string;
  company: string;
  status: VelocityStatus;
  score: number;
  accelerators: SerializedVelocitySignal[];
  decelerators: SerializedVelocitySignal[];
  prediction: string;
  daysToClose: number | null;
  assessedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'deal-velocity:assessments';

/** Signal pattern keywords mapped to their default impact scores. */
const ACCELERATION_PATTERNS: ReadonlyArray<{ pattern: string; impact: number; label: string }> = [
  { pattern: 'champion promoted', impact: 8, label: 'Champion promoted to decision-making role' },
  { pattern: 'budget approved', impact: 9, label: 'Budget approved for initiative' },
  { pattern: 'competitor lost', impact: 7, label: 'Competitor lost a key customer' },
  { pattern: 'regulatory deadline', impact: 8, label: 'Regulatory compliance deadline approaching' },
  { pattern: 'new funding', impact: 7, label: 'Company received new funding' },
  { pattern: 'expansion', impact: 6, label: 'Company expanding operations' },
  { pattern: 'rfi', impact: 5, label: 'RFI/RFP issued for relevant solution' },
  { pattern: 'tech evaluation', impact: 6, label: 'Active technology evaluation underway' },
  { pattern: 'executive sponsor', impact: 8, label: 'Executive sponsor identified' },
  { pattern: 'pain point', impact: 5, label: 'Critical pain point articulated publicly' },
  { pattern: 'positive earnings', impact: 4, label: 'Strong earnings report released' },
  { pattern: 'strategic initiative', impact: 6, label: 'New strategic initiative announced' },
] as const;

const DECELERATION_PATTERNS: ReadonlyArray<{ pattern: string; impact: number; label: string }> = [
  { pattern: 'stakeholder left', impact: -8, label: 'Key stakeholder left the company' },
  { pattern: 'hiring freeze', impact: -7, label: 'Hiring freeze announced' },
  { pattern: 'earnings miss', impact: -6, label: 'Company missed earnings expectations' },
  { pattern: 'merger', impact: -7, label: 'M&A rumor creating uncertainty' },
  { pattern: 'acquisition', impact: -7, label: 'Acquisition activity creating uncertainty' },
  { pattern: 'competitor free', impact: -5, label: 'Competitor launched free tier' },
  { pattern: 'layoff', impact: -8, label: 'Layoffs announced at target company' },
  { pattern: 'restructuring', impact: -6, label: 'Organizational restructuring underway' },
  { pattern: 'budget cut', impact: -9, label: 'Budget cuts announced' },
  { pattern: 'leadership change', impact: -5, label: 'Senior leadership change' },
  { pattern: 'security breach', impact: -4, label: 'Security incident shifting priorities' },
  { pattern: 'regulatory fine', impact: -5, label: 'Regulatory fine or investigation' },
] as const;

/** Average days per stage for close-time estimation. */
const STAGE_DURATION_BENCHMARKS: Record<string, number> = {
  prospecting: 14,
  qualification: 21,
  discovery: 28,
  proposal: 14,
  negotiation: 21,
  closed_won: 0,
  closed_lost: 0,
};

/** Stage order for remaining-stages calculation. */
const STAGE_ORDER: Record<string, number> = {
  prospecting: 0,
  qualification: 1,
  discovery: 2,
  proposal: 3,
  negotiation: 4,
  closed_won: 5,
  closed_lost: 6,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(score: number): number {
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function classifyVelocity(score: number, daysInStage?: number): VelocityStatus {
  // If the deal has been in its current stage for too long, it is stalled
  if (daysInStage !== undefined && daysInStage > 45 && score <= 10) {
    return 'stalled';
  }
  if (score >= 25) return 'accelerating';
  if (score >= -15) return 'steady';
  if (score >= -50) return 'decelerating';
  return 'stalled';
}

function generatePrediction(status: VelocityStatus, score: number, daysToClose: number | null): string {
  switch (status) {
    case 'accelerating':
      if (daysToClose !== null) {
        return `Strong momentum — deal is trending toward close in approximately ${daysToClose} days. Multiple positive signals detected.`;
      }
      return 'Strong momentum with multiple positive signals. Deal is progressing well.';

    case 'steady':
      if (daysToClose !== null) {
        return `Deal is progressing at a normal pace. Estimated ${daysToClose} days to close. No major red flags detected.`;
      }
      return 'Deal is progressing at a normal pace. Continue nurturing with consistent engagement.';

    case 'decelerating':
      return `Warning: deal momentum is declining (velocity score: ${score}). Review recent negative signals and consider re-engagement strategy.`;

    case 'stalled':
      return `Critical: deal appears stalled (velocity score: ${score}). Immediate intervention recommended — consider executive outreach or value reassessment.`;
  }
}

function serializeSignal(signal: VelocitySignal): SerializedVelocitySignal {
  return {
    ...signal,
    timestamp: signal.timestamp.toISOString(),
  };
}

function deserializeSignal(raw: SerializedVelocitySignal): VelocitySignal {
  return {
    ...raw,
    timestamp: new Date(raw.timestamp),
  };
}

function serializeVelocity(v: DealVelocity): SerializedDealVelocity {
  return {
    ...v,
    accelerators: v.accelerators.map(serializeSignal),
    decelerators: v.decelerators.map(serializeSignal),
    assessedAt: v.assessedAt.toISOString(),
  };
}

function deserializeVelocity(raw: SerializedDealVelocity): DealVelocity {
  return {
    ...raw,
    accelerators: raw.accelerators.map(deserializeSignal),
    decelerators: raw.decelerators.map(deserializeSignal),
    assessedAt: new Date(raw.assessedAt),
  };
}

function matchSignalPatterns(
  signals: VelocitySignal[],
  patterns: ReadonlyArray<{ pattern: string; impact: number; label: string }>,
): VelocitySignal[] {
  const matched: VelocitySignal[] = [];

  for (const signal of signals) {
    const descLower = signal.description.toLowerCase();
    for (const p of patterns) {
      if (descLower.includes(p.pattern)) {
        matched.push({
          description: p.label,
          impact: signal.impact !== 0 ? signal.impact : p.impact,
          source: signal.source,
          timestamp: signal.timestamp,
        });
        break; // Each signal matches at most one pattern
      }
    }
  }

  return matched;
}

// ── DealVelocityPredictor Class ──────────────────────────────────────────────

class DealVelocityPredictor {
  private assessments: Map<string, DealVelocity> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──────────────────────────────────────────────────────

  private ensureInit(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromCache().then(() => {
      this.initialized = true;
    }).catch(err => {
      console.warn('[deal-velocity] Failed to load from cache, starting fresh', err);
      this.initialized = true;
    });

    return this.initPromise;
  }

  private async loadFromCache(): Promise<void> {
    const envelope = await getPersistentCache<SerializedDealVelocity[]>(CACHE_KEY);
    if (!envelope?.data) return;

    this.assessments.clear();
    for (const raw of envelope.data) {
      const velocity = deserializeVelocity(raw);
      this.assessments.set(velocity.dealId, velocity);
    }
  }

  private async persist(): Promise<void> {
    const serialized = Array.from(this.assessments.values()).map(serializeVelocity);
    await setPersistentCache(CACHE_KEY, serialized);
  }

  // ── Core Operations ─────────────────────────────────────────────────────

  /** Calculate deal momentum based on signal patterns. */
  async assessVelocity(
    dealId: string,
    company: string,
    signals: VelocitySignal[],
    currentStage: string,
  ): Promise<DealVelocity> {
    await this.ensureInit();

    // Classify signals into accelerators and decelerators
    const accelerators = matchSignalPatterns(signals, ACCELERATION_PATTERNS);
    const decelerators = matchSignalPatterns(signals, DECELERATION_PATTERNS);

    // Also include signals that were pre-classified with positive/negative impact
    for (const signal of signals) {
      const descLower = signal.description.toLowerCase();
      const alreadyMatched =
        ACCELERATION_PATTERNS.some(p => descLower.includes(p.pattern)) ||
        DECELERATION_PATTERNS.some(p => descLower.includes(p.pattern));

      if (!alreadyMatched) {
        if (signal.impact > 0) {
          accelerators.push(signal);
        } else if (signal.impact < 0) {
          decelerators.push(signal);
        }
      }
    }

    // Calculate raw velocity score
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // Weight recent signals more heavily using time decay
    let positiveScore = 0;
    for (const sig of accelerators) {
      const ageMs = now - sig.timestamp.getTime();
      const recencyMultiplier = ageMs < thirtyDaysMs ? 1.0 - (ageMs / thirtyDaysMs) * 0.5 : 0.3;
      positiveScore += Math.abs(sig.impact) * recencyMultiplier;
    }

    let negativeScore = 0;
    for (const sig of decelerators) {
      const ageMs = now - sig.timestamp.getTime();
      const recencyMultiplier = ageMs < thirtyDaysMs ? 1.0 - (ageMs / thirtyDaysMs) * 0.5 : 0.3;
      negativeScore += Math.abs(sig.impact) * recencyMultiplier;
    }

    // Normalize to -100..+100 range
    const maxPossible = Math.max(positiveScore + negativeScore, 1);
    const rawScore = ((positiveScore - negativeScore) / maxPossible) * 100;
    const score = clampScore(rawScore);

    // Estimate days in current stage from the most recent signal timestamps
    const existingAssessment = this.assessments.get(dealId);
    const previousAssessedAt = existingAssessment?.assessedAt.getTime() ?? now;
    const approximateDaysInStage = (now - previousAssessedAt) / 86_400_000;

    const status = classifyVelocity(score, approximateDaysInStage > 7 ? approximateDaysInStage : undefined);
    const daysToClose = this.predictDaysToClose(signals, currentStage);
    const prediction = generatePrediction(status, score, daysToClose);

    const velocity: DealVelocity = {
      dealId,
      company,
      status,
      score,
      accelerators,
      decelerators,
      prediction,
      daysToClose,
      assessedAt: new Date(),
    };

    this.assessments.set(dealId, velocity);
    await this.persist();

    return velocity;
  }

  /** Get cached velocity assessment for a deal. */
  async getVelocity(dealId: string): Promise<DealVelocity | null> {
    await this.ensureInit();
    return this.assessments.get(dealId) ?? null;
  }

  /** Calculate probability of deal stalling based on time in stage. */
  getStallRisk(daysInStage: number): StallRiskResult {
    // Stall probability follows a logistic curve:
    // - Under 14 days: low risk
    // - 14-30 days: medium risk
    // - 30-45 days: high risk
    // - Over 45 days: critical risk
    const midpoint = 30;
    const steepness = 0.1;
    const stallProbability = Math.min(
      0.95,
      1 / (1 + Math.exp(-steepness * (daysInStage - midpoint))),
    );

    let riskLevel: StallRiskResult['riskLevel'];
    let recommendation: string;

    if (stallProbability < 0.25) {
      riskLevel = 'low';
      recommendation = 'Deal is progressing normally. Continue standard follow-up cadence.';
    } else if (stallProbability < 0.5) {
      riskLevel = 'medium';
      recommendation = 'Deal is approaching typical stage duration. Schedule a check-in and confirm next steps.';
    } else if (stallProbability < 0.75) {
      riskLevel = 'high';
      recommendation = 'Deal has exceeded expected stage duration. Consider escalation, champion re-engagement, or value restatement.';
    } else {
      riskLevel = 'critical';
      recommendation = 'Deal is likely stalled. Recommend executive intervention, competitive repositioning, or pipeline requalification.';
    }

    return {
      daysInStage,
      stallProbability: Math.round(stallProbability * 1000) / 1000,
      riskLevel,
      recommendation,
    };
  }

  /** Estimate closing timeline based on signals and current stage. */
  predictDaysToClose(signals: VelocitySignal[], currentStage: string): number | null {
    const currentOrder = STAGE_ORDER[currentStage];
    if (currentOrder === undefined || currentStage === 'closed_won' || currentStage === 'closed_lost') {
      return null;
    }

    // Sum remaining stage durations
    let remainingDays = 0;
    const stages = Object.entries(STAGE_ORDER)
      .filter(([stage, order]) => order >= currentOrder && stage !== 'closed_won' && stage !== 'closed_lost')
      .sort(([, a], [, b]) => a - b);

    for (const [stage] of stages) {
      remainingDays += STAGE_DURATION_BENCHMARKS[stage] ?? 14;
    }

    // Adjust based on signal velocity
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const recentSignals = signals.filter(s => (now - s.timestamp.getTime()) < thirtyDaysMs);

    let netImpact = 0;
    for (const signal of recentSignals) {
      netImpact += signal.impact;
    }

    // Positive signals reduce time, negative signals increase time
    // Each net impact point adjusts by ~2% of remaining days
    const adjustmentFactor = 1 - (netImpact * 0.02);
    const clampedFactor = Math.max(0.3, Math.min(2.0, adjustmentFactor));
    const adjustedDays = Math.round(remainingDays * clampedFactor);

    return Math.max(1, adjustedDays);
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const dealVelocityPredictor = new DealVelocityPredictor();
