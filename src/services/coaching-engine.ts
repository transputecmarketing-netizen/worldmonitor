/**
 * Coaching Engine Service
 *
 * AI coaching for sales managers. Generates actionable insights about
 * unactioned signals, template diversity, account risk, performance
 * trends, and technique sharing across the team. Produces weekly
 * team digests with highlights and recommendations.
 *
 * Persists generated insights and digests via IndexedDB-backed persistent cache.
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type InsightType =
  | 'unactioned_signals'
  | 'template_diversity'
  | 'technique_share'
  | 'account_risk'
  | 'performance_trend';

export type InsightSeverity = 'critical' | 'suggestion' | 'positive';

export interface CoachingInsight {
  id: string;
  type: InsightType;
  targetRepId?: string;
  targetRepName?: string;
  message: string;
  severity: InsightSeverity;
  actionable: boolean;
  action?: string;
  generatedAt: Date;
}

export interface TeamDigest {
  period: string;
  topSignals: Array<{ signal: string; company: string }>;
  topOutreach: Array<{ template: string; replyRate: number }>;
  accountsAtRisk: Array<{ company: string; reason: string }>;
  teamInsight: string;
  repHighlights: Array<{ repName: string; highlight: string }>;
  generatedAt: Date;
}

/** Input shape for a sales rep's data passed to generateInsights. */
export interface RepData {
  repId: string;
  repName: string;
  assignedSignals: RepSignal[];
  outreachEvents: RepOutreachEvent[];
  deals: RepDeal[];
  templatesUsed: string[];
}

export interface RepSignal {
  signalId: string;
  company: string;
  type: string;
  strength: string;
  assignedAt: number;
  actedOn: boolean;
  actedAt?: number;
}

export interface RepOutreachEvent {
  templateId: string;
  templateName: string;
  status: string;
  sentAt: number;
  repliedAt?: number;
}

export interface RepDeal {
  dealId: string;
  company: string;
  stage: string;
  dealValue: number;
  lastActivityAt: number;
  healthScore?: number;
  daysInCurrentStage: number;
}

/** Input shape for signal data passed to generateInsights. */
export interface SignalInput {
  signalId: string;
  type: string;
  company: string;
  strength: string;
  timestamp: number;
}

/** Input shape for outreach data passed to generateInsights. */
export interface OutreachInput {
  templateId: string;
  templateName: string;
  sent: number;
  replied: number;
  replyRate: number;
}

// ── Serialization Types ──────────────────────────────────────────────────────

interface SerializedCoachingInsight extends Omit<CoachingInsight, 'generatedAt'> {
  generatedAt: string;
}

interface SerializedTeamDigest extends Omit<TeamDigest, 'generatedAt'> {
  generatedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const INSIGHTS_CACHE_KEY = 'coaching-engine:insights';
const DIGESTS_CACHE_KEY = 'coaching-engine:digests';

const UNACTIONED_THRESHOLD_DAYS = 3;
const STALE_DEAL_THRESHOLD_DAYS = 30;
const LOW_HEALTH_THRESHOLD = 40;
const MIN_TEMPLATE_DIVERSITY = 3;
const MAX_INSIGHTS_STORED = 200;
const MAX_DIGESTS_STORED = 52;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `ci_${ts}_${rand}`;
}

function daysSince(timestampMs: number): number {
  return (Date.now() - timestampMs) / 86_400_000;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPeriod(): string {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const fmt = (d: Date): string => d.toISOString().split('T')[0] ?? '';
  return `${fmt(weekAgo)} to ${fmt(now)}`;
}

function serializeInsight(insight: CoachingInsight): SerializedCoachingInsight {
  return { ...insight, generatedAt: insight.generatedAt.toISOString() };
}

function deserializeInsight(raw: SerializedCoachingInsight): CoachingInsight {
  return { ...raw, generatedAt: new Date(raw.generatedAt) };
}

function serializeDigest(digest: TeamDigest): SerializedTeamDigest {
  return { ...digest, generatedAt: digest.generatedAt.toISOString() };
}

function deserializeDigest(raw: SerializedTeamDigest): TeamDigest {
  return { ...raw, generatedAt: new Date(raw.generatedAt) };
}

// ── CoachingEngine Class ─────────────────────────────────────────────────────

class CoachingEngine {
  private insights: CoachingInsight[] = [];
  private digests: TeamDigest[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──────────────────────────────────────────────────────

  private ensureInit(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromCache().then(() => {
      this.initialized = true;
    }).catch(err => {
      console.warn('[coaching-engine] Failed to load from cache, starting fresh', err);
      this.initialized = true;
    });

    return this.initPromise;
  }

  private async loadFromCache(): Promise<void> {
    const [insightsEnvelope, digestsEnvelope] = await Promise.all([
      getPersistentCache<SerializedCoachingInsight[]>(INSIGHTS_CACHE_KEY),
      getPersistentCache<SerializedTeamDigest[]>(DIGESTS_CACHE_KEY),
    ]);

    if (insightsEnvelope?.data) {
      this.insights = insightsEnvelope.data.map(deserializeInsight);
    }

    if (digestsEnvelope?.data) {
      this.digests = digestsEnvelope.data.map(deserializeDigest);
    }
  }

  private async persistInsights(): Promise<void> {
    const serialized = this.insights.map(serializeInsight);
    await setPersistentCache(INSIGHTS_CACHE_KEY, serialized);
  }

  private async persistDigests(): Promise<void> {
    const serialized = this.digests.map(serializeDigest);
    await setPersistentCache(DIGESTS_CACHE_KEY, serialized);
  }

  // ── Insight Generation ──────────────────────────────────────────────────

  /** Generate coaching insights for a team based on reps, signals, and outreach data. */
  async generateInsights(
    reps: RepData[],
    signals: SignalInput[],
    outreachData: OutreachInput[],
  ): Promise<CoachingInsight[]> {
    await this.ensureInit();

    const generated: CoachingInsight[] = [];
    const now = new Date();

    // 1. Unactioned signals per rep
    for (const rep of reps) {
      const unactioned = rep.assignedSignals.filter(
        s => !s.actedOn && daysSince(s.assignedAt) > UNACTIONED_THRESHOLD_DAYS,
      );

      if (unactioned.length > 0) {
        const highStrength = unactioned.filter(s => s.strength === 'critical' || s.strength === 'high');
        const severity: InsightSeverity = highStrength.length > 0 ? 'critical' : 'suggestion';
        const companies = [...new Set(unactioned.map(s => s.company))];
        const companyList = companies.slice(0, 3).join(', ');
        const suffix = companies.length > 3 ? ` and ${companies.length - 3} more` : '';

        generated.push({
          id: generateId(),
          type: 'unactioned_signals',
          targetRepId: rep.repId,
          targetRepName: rep.repName,
          message: `${rep.repName} has ${unactioned.length} unactioned signal(s) older than ${UNACTIONED_THRESHOLD_DAYS} days for ${companyList}${suffix}.${highStrength.length > 0 ? ` ${highStrength.length} are high-priority.` : ''}`,
          severity,
          actionable: true,
          action: `Review and act on signals for ${companyList}${suffix}. Prioritize high-strength signals first.`,
          generatedAt: now,
        });
      }
    }

    // 2. Template diversity check
    for (const rep of reps) {
      const uniqueTemplates = new Set(rep.templatesUsed);
      if (rep.outreachEvents.length >= 10 && uniqueTemplates.size < MIN_TEMPLATE_DIVERSITY) {
        generated.push({
          id: generateId(),
          type: 'template_diversity',
          targetRepId: rep.repId,
          targetRepName: rep.repName,
          message: `${rep.repName} has used only ${uniqueTemplates.size} unique template(s) across ${rep.outreachEvents.length} outreach events. Low diversity may reduce effectiveness.`,
          severity: 'suggestion',
          actionable: true,
          action: `Encourage ${rep.repName} to experiment with different templates. Share top-performing templates from the team.`,
          generatedAt: now,
        });
      }
    }

    // 3. Technique sharing — identify top performers and suggest knowledge sharing
    const repPerformance: Array<{ rep: RepData; replyRate: number; totalSent: number }> = [];
    for (const rep of reps) {
      const totalSent = rep.outreachEvents.length;
      const totalReplied = rep.outreachEvents.filter(
        e => e.status === 'replied' || e.status === 'meeting_booked',
      ).length;
      const replyRate = safeRate(totalReplied, totalSent);
      repPerformance.push({ rep, replyRate, totalSent });
    }

    const activeReps = repPerformance.filter(r => r.totalSent >= 5);
    if (activeReps.length >= 2) {
      activeReps.sort((a, b) => b.replyRate - a.replyRate);
      const topPerformer = activeReps[0];
      const bottomPerformer = activeReps[activeReps.length - 1];

      if (topPerformer && bottomPerformer && topPerformer.replyRate - bottomPerformer.replyRate > 0.15) {
        generated.push({
          id: generateId(),
          type: 'technique_share',
          message: `${topPerformer.rep.repName} has a ${(topPerformer.replyRate * 100).toFixed(0)}% reply rate vs. ${bottomPerformer.rep.repName}'s ${(bottomPerformer.replyRate * 100).toFixed(0)}%. Consider scheduling a technique-sharing session.`,
          severity: 'suggestion',
          actionable: true,
          action: `Pair ${topPerformer.rep.repName} with ${bottomPerformer.rep.repName} for mentoring on outreach techniques.`,
          generatedAt: now,
        });
      }
    }

    // 4. Account risk detection
    for (const rep of reps) {
      for (const deal of rep.deals) {
        const reasons: string[] = [];

        if (deal.daysInCurrentStage > STALE_DEAL_THRESHOLD_DAYS) {
          reasons.push(`stalled for ${Math.round(deal.daysInCurrentStage)} days in ${deal.stage}`);
        }

        if (deal.healthScore !== undefined && deal.healthScore < LOW_HEALTH_THRESHOLD) {
          reasons.push(`health score dropped to ${deal.healthScore}`);
        }

        if (daysSince(deal.lastActivityAt) > 14) {
          reasons.push(`no activity in ${Math.round(daysSince(deal.lastActivityAt))} days`);
        }

        if (reasons.length > 0) {
          const severity: InsightSeverity = reasons.length >= 2 || deal.daysInCurrentStage > 45
            ? 'critical'
            : 'suggestion';

          generated.push({
            id: generateId(),
            type: 'account_risk',
            targetRepId: rep.repId,
            targetRepName: rep.repName,
            message: `${deal.company} (${rep.repName}) is at risk: ${reasons.join('; ')}. Deal value: $${deal.dealValue.toLocaleString()}.`,
            severity,
            actionable: true,
            action: `Intervene on ${deal.company}: schedule a check-in, reassess champion engagement, or consider executive sponsorship.`,
            generatedAt: now,
          });
        }
      }
    }

    // 5. Performance trends — identify reps with improving or declining metrics
    for (const perf of activeReps) {
      if (perf.replyRate > 0.4) {
        generated.push({
          id: generateId(),
          type: 'performance_trend',
          targetRepId: perf.rep.repId,
          targetRepName: perf.rep.repName,
          message: `${perf.rep.repName} is performing exceptionally with a ${(perf.replyRate * 100).toFixed(0)}% reply rate across ${perf.totalSent} outreach events.`,
          severity: 'positive',
          actionable: false,
          generatedAt: now,
        });
      } else if (perf.replyRate < 0.1 && perf.totalSent >= 10) {
        generated.push({
          id: generateId(),
          type: 'performance_trend',
          targetRepId: perf.rep.repId,
          targetRepName: perf.rep.repName,
          message: `${perf.rep.repName} has a ${(perf.replyRate * 100).toFixed(0)}% reply rate across ${perf.totalSent} outreach events. This is significantly below team average.`,
          severity: 'critical',
          actionable: true,
          action: `Review ${perf.rep.repName}'s messaging, targeting, and timing. Consider coaching session or template refresh.`,
          generatedAt: now,
        });
      }
    }

    // 6. Surface top-performing templates from outreach data for underperformers
    const topTemplates = outreachData
      .filter(o => o.sent >= 5)
      .sort((a, b) => b.replyRate - a.replyRate)
      .slice(0, 3);

    if (topTemplates.length > 0) {
      const underperformingReps = activeReps.filter(r => r.replyRate < 0.15 && r.totalSent >= 5);
      for (const rep of underperformingReps) {
        const templateNames = topTemplates.map(t => `"${t.templateName}"`).join(', ');
        generated.push({
          id: generateId(),
          type: 'technique_share',
          targetRepId: rep.rep.repId,
          targetRepName: rep.rep.repName,
          message: `Top-performing templates ${templateNames} have reply rates above ${(topTemplates[0]!.replyRate * 100).toFixed(0)}%. ${rep.rep.repName} may benefit from adopting these approaches.`,
          severity: 'suggestion',
          actionable: true,
          action: `Share templates ${templateNames} with ${rep.rep.repName} and review messaging alignment.`,
          generatedAt: now,
        });
      }
    }

    // 7. High-value unactioned signals across the team
    const recentHighSignals = signals.filter(
      s => (s.strength === 'critical' || s.strength === 'high') && daysSince(s.timestamp) < 7,
    );
    const totalAssigned = reps.flatMap(r => r.assignedSignals).length;
    const totalActed = reps.flatMap(r => r.assignedSignals).filter(s => s.actedOn).length;
    const teamActionRate = safeRate(totalActed, totalAssigned);

    if (totalAssigned > 0 && teamActionRate < 0.5) {
      generated.push({
        id: generateId(),
        type: 'unactioned_signals',
        message: `Team signal action rate is ${(teamActionRate * 100).toFixed(0)}% — ${totalAssigned - totalActed} of ${totalAssigned} assigned signals remain unactioned. ${recentHighSignals.length} high-priority signals detected this week.`,
        severity: teamActionRate < 0.3 ? 'critical' : 'suggestion',
        actionable: true,
        action: 'Review signal assignment distribution and follow up with reps on unactioned high-priority signals.',
        generatedAt: now,
      });
    }

    // Store and trim insights
    this.insights.push(...generated);
    if (this.insights.length > MAX_INSIGHTS_STORED) {
      this.insights = this.insights.slice(-MAX_INSIGHTS_STORED);
    }
    await this.persistInsights();

    return generated;
  }

  // ── Team Digest ─────────────────────────────────────────────────────────

  /** Generate a weekly team digest summarizing signals, outreach, and risk. */
  async generateTeamDigest(teamId: string): Promise<TeamDigest> {
    await this.ensureInit();

    const now = new Date();
    const period = formatPeriod();

    // Gather recent insights for the digest
    const weekAgoMs = Date.now() - 7 * 86_400_000;
    const recentInsights = this.insights.filter(i => i.generatedAt.getTime() >= weekAgoMs);

    // Top signals: extract from unactioned_signals and account_risk insights
    const signalInsights = recentInsights.filter(i => i.type === 'unactioned_signals' || i.type === 'account_risk');
    const topSignals: Array<{ signal: string; company: string }> = [];
    const seenCompanies = new Set<string>();
    for (const insight of signalInsights) {
      // Extract company name from the message
      const companyMatch = insight.message.match(/(?:for\s+|^)([A-Z][\w\s&.-]+?)(?:\s+is|\s+\(|,|\.|$)/);
      const company = companyMatch?.[1]?.trim() ?? 'Unknown';
      if (!seenCompanies.has(company)) {
        seenCompanies.add(company);
        topSignals.push({ signal: insight.message.substring(0, 100), company });
      }
      if (topSignals.length >= 5) break;
    }

    // Top outreach: from performance insights
    const topOutreach: Array<{ template: string; replyRate: number }> = [];
    const performanceInsights = recentInsights.filter(i => i.type === 'performance_trend' && i.severity === 'positive');
    for (const insight of performanceInsights) {
      const rateMatch = insight.message.match(/(\d+)% reply rate/);
      if (rateMatch?.[1]) {
        topOutreach.push({
          template: insight.targetRepName ? `${insight.targetRepName}'s approach` : 'Top performer approach',
          replyRate: Number(rateMatch[1]) / 100,
        });
      }
      if (topOutreach.length >= 3) break;
    }

    // Accounts at risk
    const riskInsights = recentInsights.filter(i => i.type === 'account_risk');
    const accountsAtRisk: Array<{ company: string; reason: string }> = [];
    for (const insight of riskInsights) {
      const companyMatch = insight.message.match(/^([^(]+)\s*\(/);
      const company = companyMatch?.[1]?.trim() ?? 'Unknown';
      accountsAtRisk.push({ company, reason: insight.message });
      if (accountsAtRisk.length >= 5) break;
    }

    // Team insight summary
    const criticalCount = recentInsights.filter(i => i.severity === 'critical').length;
    const positiveCount = recentInsights.filter(i => i.severity === 'positive').length;
    const suggestionCount = recentInsights.filter(i => i.severity === 'suggestion').length;

    let teamInsight: string;
    if (criticalCount > 3) {
      teamInsight = `Team ${teamId} needs attention: ${criticalCount} critical issues detected this week. Focus on unactioned signals and at-risk accounts.`;
    } else if (positiveCount > criticalCount) {
      teamInsight = `Team ${teamId} is performing well with ${positiveCount} positive highlights. ${suggestionCount} suggestions available for further optimization.`;
    } else {
      teamInsight = `Team ${teamId} has ${recentInsights.length} insights this week: ${criticalCount} critical, ${suggestionCount} suggestions, ${positiveCount} positive. Review critical items first.`;
    }

    // Rep highlights
    const repHighlights: Array<{ repName: string; highlight: string }> = [];
    const repNames = new Set<string>();
    for (const insight of recentInsights) {
      if (insight.targetRepName && !repNames.has(insight.targetRepName)) {
        repNames.add(insight.targetRepName);
        repHighlights.push({
          repName: insight.targetRepName,
          highlight: insight.severity === 'positive'
            ? insight.message
            : `Needs attention: ${insight.type.replace(/_/g, ' ')}`,
        });
      }
      if (repHighlights.length >= 5) break;
    }

    const digest: TeamDigest = {
      period,
      topSignals,
      topOutreach,
      accountsAtRisk,
      teamInsight,
      repHighlights,
      generatedAt: now,
    };

    this.digests.push(digest);
    if (this.digests.length > MAX_DIGESTS_STORED) {
      this.digests = this.digests.slice(-MAX_DIGESTS_STORED);
    }
    await this.persistDigests();

    return digest;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /** Get signals assigned to a rep that have not been acted on within the threshold. */
  async getUnactionedSignals(repId: string, thresholdDays?: number): Promise<RepSignal[]> {
    await this.ensureInit();

    const threshold = thresholdDays ?? UNACTIONED_THRESHOLD_DAYS;

    // We extract unactioned signal data from stored insights
    // This method is designed to be called with fresh rep data in generateInsights,
    // but can also return info from recently generated insights
    const repInsights = this.insights.filter(
      i => i.type === 'unactioned_signals' && i.targetRepId === repId,
    );

    // Return a summary representation since we do not store raw signal data
    const results: RepSignal[] = [];
    for (const insight of repInsights) {
      if (daysSince(insight.generatedAt.getTime()) <= threshold * 2) {
        results.push({
          signalId: insight.id,
          company: 'See insight details',
          type: 'unactioned',
          strength: insight.severity === 'critical' ? 'high' : 'medium',
          assignedAt: insight.generatedAt.getTime() - threshold * 86_400_000,
          actedOn: false,
        });
      }
    }

    return results;
  }

  /** Get accounts with decaying health or stalled deals for a rep. */
  async getAccountsAtRisk(repId: string): Promise<Array<{ company: string; reason: string; severity: InsightSeverity }>> {
    await this.ensureInit();

    const riskInsights = this.insights.filter(
      i => i.type === 'account_risk' && i.targetRepId === repId,
    );

    // Deduplicate by extracting company from message
    const seen = new Set<string>();
    const results: Array<{ company: string; reason: string; severity: InsightSeverity }> = [];

    for (const insight of riskInsights) {
      const companyMatch = insight.message.match(/^([^(]+)\s*\(/);
      const company = companyMatch?.[1]?.trim() ?? 'Unknown';

      if (!seen.has(company)) {
        seen.add(company);
        results.push({
          company,
          reason: insight.message,
          severity: insight.severity,
        });
      }
    }

    return results.sort((a, b) => {
      const severityOrder: Record<InsightSeverity, number> = { critical: 0, suggestion: 1, positive: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const coachingEngine = new CoachingEngine();
