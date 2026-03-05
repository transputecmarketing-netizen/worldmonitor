/**
 * Propensity-to-Buy Model Service
 * Scores companies on their likelihood to purchase based on a weighted
 * composite of commercial signals and firmographic indicators.
 * Distinct from Account Health — this measures buying readiness, not relationship quality.
 */

import type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

interface PropensityComponent {
  name: string;
  score: number; // 0-100
  weight: number;
  reasoning: string;
}

interface PropensityScore {
  company: string;
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: PropensityComponent[];
  matchedPatterns: string[];
  recommendation: string;
  scoredAt: Date;
}

interface Firmographics {
  employeeCount?: number;
  annualRevenue?: number;
  yearFounded?: number;
  isPublic?: boolean;
  industry?: string;
  techStack?: string[];
}

const CACHE_KEY = 'propensity-scores';

const COMPONENT_WEIGHTS = {
  funding_recency: 0.20,
  leadership_change: 0.15,
  tech_stack_change: 0.15,
  hiring_velocity: 0.15,
  expansion_signal: 0.10,
  competitive_pressure: 0.10,
  engagement_signal: 0.15,
} as const;

type ComponentName = keyof typeof COMPONENT_WEIGHTS;

const GRADE_THRESHOLDS: { grade: PropensityScore['grade']; min: number }[] = [
  { grade: 'A', min: 80 },
  { grade: 'B', min: 60 },
  { grade: 'C', min: 40 },
  { grade: 'D', min: 20 },
  { grade: 'F', min: 0 },
];

const RECOMMENDATIONS: Record<PropensityScore['grade'], string> = {
  A: 'Immediate outreach — strong buying signals across multiple dimensions. Prioritize for AE assignment.',
  B: 'Warm prospect — meaningful signals present. Schedule discovery call within 2 weeks.',
  C: 'Nurture candidate — some positive indicators but insufficient urgency. Add to drip campaign.',
  D: 'Monitor only — weak signals, not ready for active engagement. Re-score in 30 days.',
  F: 'Deprioritize — no meaningful buying signals detected. Archive and revisit quarterly.',
};

class PropensityModel {
  private scores: Map<string, PropensityScore> = new Map();
  private initialized = false;

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    const cached = await getPersistentCache<Record<string, PropensityScore>>(CACHE_KEY);
    if (cached?.data) {
      for (const [key, value] of Object.entries(cached.data)) {
        this.scores.set(key, {
          ...value,
          scoredAt: new Date(value.scoredAt),
        });
      }
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const data: Record<string, PropensityScore> = {};
    for (const [key, value] of this.scores.entries()) {
      data[key] = value;
    }
    await setPersistentCache(CACHE_KEY, data);
  }

  async scoreCompany(
    company: string,
    signals: CompanySignal[],
    firmographics?: Firmographics
  ): Promise<PropensityScore> {
    await this.ensureLoaded();

    const components: PropensityComponent[] = [];
    const matchedPatterns: string[] = [];

    // --- Funding Recency (20%) ---
    const fundingComponent = this.scoreFundingRecency(signals);
    components.push(fundingComponent);
    if (fundingComponent.score >= 50) matchedPatterns.push('Recent funding activity');

    // --- Leadership Change (15%) ---
    const leadershipComponent = this.scoreLeadershipChange(signals);
    components.push(leadershipComponent);
    if (leadershipComponent.score >= 50) matchedPatterns.push('Leadership transition');

    // --- Tech Stack Change (15%) ---
    const techComponent = this.scoreTechStackChange(signals, firmographics);
    components.push(techComponent);
    if (techComponent.score >= 50) matchedPatterns.push('Technology stack evolution');

    // --- Hiring Velocity (15%) ---
    const hiringComponent = this.scoreHiringVelocity(signals);
    components.push(hiringComponent);
    if (hiringComponent.score >= 50) matchedPatterns.push('Aggressive hiring');

    // --- Expansion Signal (10%) ---
    const expansionComponent = this.scoreExpansionSignal(signals, firmographics);
    components.push(expansionComponent);
    if (expansionComponent.score >= 50) matchedPatterns.push('Market or geographic expansion');

    // --- Competitive Pressure (10%) ---
    const competitiveComponent = this.scoreCompetitivePressure(signals);
    components.push(competitiveComponent);
    if (competitiveComponent.score >= 50) matchedPatterns.push('Competitive pressure indicators');

    // --- Engagement Signal (15%) ---
    const engagementComponent = this.scoreEngagementSignal(signals);
    components.push(engagementComponent);
    if (engagementComponent.score >= 50) matchedPatterns.push('Active vendor evaluation');

    // Weighted composite
    const compositeScore = Math.round(
      components.reduce((sum, c) => sum + c.score * c.weight, 0)
    );
    const clampedScore = Math.max(0, Math.min(100, compositeScore));
    const grade = this.scoreToGrade(clampedScore);

    const result: PropensityScore = {
      company,
      score: clampedScore,
      grade,
      components,
      matchedPatterns,
      recommendation: RECOMMENDATIONS[grade],
      scoredAt: new Date(),
    };

    this.scores.set(company.toLowerCase(), result);
    await this.persist();

    return result;
  }

  async getScore(company: string): Promise<PropensityScore | undefined> {
    await this.ensureLoaded();
    return this.scores.get(company.toLowerCase());
  }

  async getTopProspects(limit = 20): Promise<PropensityScore[]> {
    await this.ensureLoaded();
    return Array.from(this.scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async compareCompanies(companies: string[]): Promise<PropensityScore[]> {
    await this.ensureLoaded();
    const results: PropensityScore[] = [];
    for (const name of companies) {
      const score = this.scores.get(name.toLowerCase());
      if (score) results.push(score);
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // --- Component scorers ---

  private scoreFundingRecency(signals: CompanySignal[]): PropensityComponent {
    const funding = signals.filter((s) => s.type === 'funding_event');
    if (funding.length === 0) return this.component('funding_recency', 10, 'No funding signals detected');

    const latest = funding.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
    const age = daysSince(latest.timestamp);
    let score = age <= 30 ? 95 : age <= 90 ? 80 : age <= 180 ? 55 : 20;
    let reasoning = age <= 30
      ? `Very recent funding (${age}d ago) — capital deployment phase`
      : age <= 90 ? `Recent funding (${age}d ago) — active spending window`
      : age <= 180 ? `Funding ${age}d ago — spending window narrowing`
      : `Funding ${age}d ago — capital likely deployed`;

    if (latest.fundingAmount) {
      const amt = parseFundingAmount(latest.fundingAmount);
      if (amt !== null && amt >= 50_000_000) {
        score = Math.min(100, score + 10);
        reasoning += '; large round amplifies signal';
      }
    }
    return this.component('funding_recency', score, reasoning);
  }

  private scoreLeadershipChange(signals: CompanySignal[]): PropensityComponent {
    const leadership = signals.filter((s) => s.type === 'executive_movement' || s.type === 'leadership_activity');
    if (leadership.length === 0) return this.component('leadership_change', 10, 'No leadership change signals');

    const latest = leadership.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
    const age = daysSince(latest.timestamp);
    const isCLevel = leadership.some((s) => {
      const t = (s.jobTitle ?? s.title).toLowerCase();
      return t.includes('cto') || t.includes('cio') || t.includes('vp') || t.includes('chief') || t.includes('head of');
    });
    let score = age <= 60 ? 85 : age <= 120 ? 65 : age <= 180 ? 40 : 15;
    if (isCLevel) score = Math.min(100, score + 15);
    const reasoning = isCLevel ? `Senior leadership change ${age}d ago — high vendor review likelihood` : `Leadership activity ${age}d ago`;
    return this.component('leadership_change', score, reasoning);
  }

  private scoreTechStackChange(
    signals: CompanySignal[],
    firmographics?: Firmographics
  ): PropensityComponent {
    const techSignals = signals.filter((s) => s.type === 'technology_adoption');
    if (techSignals.length === 0 && !firmographics?.techStack?.length) {
      return this.component('tech_stack_change', 10, 'No technology change signals');
    }

    let score = Math.min(90, 30 + techSignals.length * 20);
    const parts: string[] = [];

    if (techSignals.length > 0) {
      parts.push(`${techSignals.length} tech adoption signal(s)`);
    }
    if (firmographics?.techStack && firmographics.techStack.length > 5) {
      score = Math.min(100, score + 10);
      parts.push('diverse tech stack indicates openness to tooling');
    }

    // Recency boost
    if (techSignals.length > 0) {
      const latest = techSignals.reduce((a, b) =>
        new Date(a.timestamp) > new Date(b.timestamp) ? a : b
      );
      if (daysSince(latest.timestamp) <= 30) {
        score = Math.min(100, score + 10);
        parts.push('very recent adoption activity');
      }
    }

    return this.component('tech_stack_change', score, parts.join('; ') || 'Tech signals present');
  }

  private scoreHiringVelocity(signals: CompanySignal[]): PropensityComponent {
    const hiring = signals.filter((s) => s.type === 'hiring_surge');
    const jobPostings = signals.filter((s) => s.type === 'job_posting');
    const combined = hiring.length + jobPostings.length;

    if (combined === 0) {
      return this.component('hiring_velocity', 10, 'No hiring signals detected');
    }

    const isLayoff = [...hiring, ...jobPostings].some(
      (s) => s.title.toLowerCase().includes('layoff') || s.title.toLowerCase().includes('reduction')
    );
    if (isLayoff) {
      return this.component('hiring_velocity', 5, 'Layoff signals — negative hiring velocity');
    }

    let score = Math.min(90, 25 + combined * 15);

    // Strength boost
    const highStrength = [...hiring, ...jobPostings].filter(
      (s) => s.strength === 'critical' || s.strength === 'high'
    );
    if (highStrength.length > 0) {
      score = Math.min(100, score + 10);
    }

    return this.component(
      'hiring_velocity',
      score,
      `${combined} hiring signal(s) — team building indicates tool procurement`
    );
  }

  private scoreExpansionSignal(
    signals: CompanySignal[],
    firmographics?: Firmographics
  ): PropensityComponent {
    const expansion = signals.filter((s) => s.type === 'expansion_signal');
    if (expansion.length === 0) {
      return this.component('expansion_signal', 10, 'No expansion signals');
    }

    let score = Math.min(85, 30 + expansion.length * 20);

    if (firmographics?.employeeCount !== undefined && firmographics.employeeCount > 500) {
      score = Math.min(100, score + 10);
    }

    return this.component(
      'expansion_signal',
      score,
      `${expansion.length} expansion signal(s) — new markets/offices create procurement needs`
    );
  }

  private scoreCompetitivePressure(signals: CompanySignal[]): PropensityComponent {
    const keywords = ['competitor', 'market share', 'competitive', 'disruption', 'losing', 'threat'];
    const hits = signals.filter((s) => {
      const text = (s.title + ' ' + (s.summary ?? '')).toLowerCase();
      return keywords.some((kw) => text.includes(kw));
    });
    if (hits.length === 0) return this.component('competitive_pressure', 15, 'No competitive pressure signals detected');
    return this.component('competitive_pressure', Math.min(85, 35 + hits.length * 20), `${hits.length} competitive pressure indicator(s) — urgency to modernize`);
  }

  private scoreEngagementSignal(signals: CompanySignal[]): PropensityComponent {
    const rfp = signals.filter((s) => s.type === 'tender_rfp');
    const pressReleases = signals.filter((s) => s.type === 'press_release');
    const highStrengthAny = signals.filter(
      (s) => s.strength === 'critical' || s.strength === 'high'
    );

    if (rfp.length === 0 && highStrengthAny.length === 0) {
      return this.component('engagement_signal', 10, 'No active engagement signals');
    }

    let score = 20;
    const parts: string[] = [];

    if (rfp.length > 0) {
      score += 40;
      parts.push(`${rfp.length} active RFP/tender(s)`);
    }
    if (highStrengthAny.length >= 3) {
      score += 20;
      parts.push(`${highStrengthAny.length} high-strength signals`);
    }
    if (pressReleases.length > 0) {
      score += 10;
      parts.push('press activity');
    }

    return this.component(
      'engagement_signal',
      Math.min(95, score),
      parts.join('; ') || 'Engagement signals present'
    );
  }

  // --- Helpers ---

  private component(name: ComponentName, score: number, reasoning: string): PropensityComponent {
    return {
      name,
      score: Math.max(0, Math.min(100, score)),
      weight: COMPONENT_WEIGHTS[name],
      reasoning,
    };
  }

  private scoreToGrade(score: number): PropensityScore['grade'] {
    for (const { grade, min } of GRADE_THRESHOLDS) {
      if (score >= min) return grade;
    }
    return 'F';
  }
}

function daysSince(timestamp: Date | string): number {
  const then = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const diff = Date.now() - then.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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

export { PropensityModel };
export type { PropensityScore, PropensityComponent };
export const propensityModel = new PropensityModel();
