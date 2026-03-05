/**
 * Feedback Loop Service
 *
 * Reinforcement learning loop that makes SalesIntel smarter over time.
 * Records user interactions as feedback events, maintains learned weights
 * for signal types, source reliability, and template performance, and
 * runs weekly analysis cycles to generate insights and adjust scoring.
 *
 * Persists all data via IndexedDB-backed persistent cache.
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type FeedbackType =
  | 'signal_useful'
  | 'signal_dismissed'
  | 'outreach_replied'
  | 'outreach_ignored'
  | 'deal_won'
  | 'deal_lost'
  | 'company_watchlisted'
  | 'intel_viewed'
  | 'not_relevant';

export interface FeedbackEvent {
  id: string;
  type: FeedbackType;
  entityType: 'signal' | 'company' | 'outreach' | 'deal';
  entityId: string;
  metadata: Record<string, string>;
  timestamp: number;
}

export interface LearnedWeights {
  signalTypeWeights: Record<string, number>;
  sourceReliability: Record<string, number>;
  templatePerformance: Record<string, number>;
  bestOutreachTiming: { dayOfWeek: number; hourOfDay: number };
  updatedAt: number;
}

export interface WeightAdjustment {
  factor: string;
  oldWeight: number;
  newWeight: number;
  reason: string;
}

export interface WeeklyInsight {
  period: string;
  insights: string[];
  weightAdjustments: WeightAdjustment[];
  generatedAt: number;
}

interface SignalTypePerformance {
  signalType: string;
  useful: number;
  dismissed: number;
  total: number;
  usefulRate: number;
  currentWeight: number;
}

interface RecommendedAdjustment {
  factor: string;
  currentWeight: number;
  recommendedWeight: number;
  confidence: number;
  reason: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EVENTS_CACHE_KEY = 'feedback-loop:events';
const WEIGHTS_CACHE_KEY = 'feedback-loop:weights';
const INSIGHTS_CACHE_KEY = 'feedback-loop:insights';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_WEIGHT = 1.0;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 3.0;
const LEARNING_RATE = 0.15;
const MIN_SAMPLE_SIZE = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `fb_${ts}_${rand}`;
}

function clampWeight(weight: number): number {
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(weight * 1000) / 1000));
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPeriod(startMs: number, endMs: number): string {
  const start = new Date(startMs).toISOString().split('T')[0] ?? '';
  const end = new Date(endMs).toISOString().split('T')[0] ?? '';
  return `${start} to ${end}`;
}

// ── FeedbackLoop Class ───────────────────────────────────────────────────────

class FeedbackLoop {
  private events: Map<string, FeedbackEvent> = new Map();
  private weights: LearnedWeights = {
    signalTypeWeights: {},
    sourceReliability: {},
    templatePerformance: {},
    bestOutreachTiming: { dayOfWeek: 2, hourOfDay: 10 },
    updatedAt: Date.now(),
  };
  private insights: WeeklyInsight[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──────────────────────────────────────────────────────

  private ensureInit(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromCache().then(() => {
      this.initialized = true;
    }).catch(err => {
      console.warn('[feedback-loop] Failed to load from cache, starting fresh', err);
      this.initialized = true;
    });

    return this.initPromise;
  }

  private async loadFromCache(): Promise<void> {
    const [eventsEnvelope, weightsEnvelope, insightsEnvelope] = await Promise.all([
      getPersistentCache<FeedbackEvent[]>(EVENTS_CACHE_KEY),
      getPersistentCache<LearnedWeights>(WEIGHTS_CACHE_KEY),
      getPersistentCache<WeeklyInsight[]>(INSIGHTS_CACHE_KEY),
    ]);

    if (eventsEnvelope?.data) {
      this.events.clear();
      for (const event of eventsEnvelope.data) {
        this.events.set(event.id, event);
      }
    }

    if (weightsEnvelope?.data) {
      this.weights = weightsEnvelope.data;
    }

    if (insightsEnvelope?.data) {
      this.insights = insightsEnvelope.data;
    }
  }

  private async persistEvents(): Promise<void> {
    await setPersistentCache(EVENTS_CACHE_KEY, Array.from(this.events.values()));
  }

  private async persistWeights(): Promise<void> {
    await setPersistentCache(WEIGHTS_CACHE_KEY, this.weights);
  }

  private async persistInsights(): Promise<void> {
    await setPersistentCache(INSIGHTS_CACHE_KEY, this.insights);
  }

  // ── Core Operations ─────────────────────────────────────────────────────

  /** Record a user interaction as feedback. */
  async recordFeedback(event: Omit<FeedbackEvent, 'id'>): Promise<FeedbackEvent> {
    await this.ensureInit();

    const id = generateId();
    const full: FeedbackEvent = { ...event, id };
    this.events.set(id, full);
    await this.persistEvents();
    return full;
  }

  /** Get current learned weights. */
  async getLearnedWeights(): Promise<LearnedWeights> {
    await this.ensureInit();
    return { ...this.weights };
  }

  // ── Weekly Analysis ─────────────────────────────────────────────────────

  /** Analyze last 7 days of feedback, generate insights, and adjust weights. */
  async runWeeklyAnalysis(): Promise<WeeklyInsight> {
    await this.ensureInit();

    const now = Date.now();
    const weekStart = now - SEVEN_DAYS_MS;
    const recentEvents = Array.from(this.events.values())
      .filter(e => e.timestamp >= weekStart);

    const insightMessages: string[] = [];
    const adjustments: WeightAdjustment[] = [];

    // Analyze signal type performance
    const signalPerf = this.computeSignalTypePerformance(recentEvents);
    for (const perf of signalPerf) {
      if (perf.total < MIN_SAMPLE_SIZE) continue;

      const currentWeight = this.weights.signalTypeWeights[perf.signalType] ?? DEFAULT_WEIGHT;
      let newWeight = currentWeight;

      if (perf.usefulRate > 0.7) {
        newWeight = currentWeight + LEARNING_RATE * (perf.usefulRate - 0.5);
        insightMessages.push(
          `Signal type "${perf.signalType}" has a ${(perf.usefulRate * 100).toFixed(0)}% useful rate — boosting weight.`,
        );
      } else if (perf.usefulRate < 0.3) {
        newWeight = currentWeight - LEARNING_RATE * (0.5 - perf.usefulRate);
        insightMessages.push(
          `Signal type "${perf.signalType}" has a ${(perf.usefulRate * 100).toFixed(0)}% useful rate — reducing weight.`,
        );
      }

      newWeight = clampWeight(newWeight);
      if (newWeight !== currentWeight) {
        adjustments.push({
          factor: `signal:${perf.signalType}`,
          oldWeight: currentWeight,
          newWeight,
          reason: `Useful rate ${(perf.usefulRate * 100).toFixed(0)}% over ${perf.total} events`,
        });
        this.weights.signalTypeWeights[perf.signalType] = newWeight;
      }
    }

    // Analyze source reliability
    const sourceMap = new Map<string, { positive: number; negative: number }>();
    for (const event of recentEvents) {
      const source = event.metadata['source'];
      if (!source) continue;
      const entry = sourceMap.get(source) ?? { positive: 0, negative: 0 };
      if (event.type === 'signal_useful' || event.type === 'outreach_replied' || event.type === 'deal_won') {
        entry.positive++;
      } else if (event.type === 'signal_dismissed' || event.type === 'not_relevant') {
        entry.negative++;
      }
      sourceMap.set(source, entry);
    }

    for (const [source, data] of sourceMap) {
      const total = data.positive + data.negative;
      if (total < MIN_SAMPLE_SIZE) continue;

      const reliabilityRate = safeRate(data.positive, total);
      const currentWeight = this.weights.sourceReliability[source] ?? DEFAULT_WEIGHT;
      let newWeight = currentWeight + LEARNING_RATE * (reliabilityRate - 0.5);
      newWeight = clampWeight(newWeight);

      if (newWeight !== currentWeight) {
        adjustments.push({
          factor: `source:${source}`,
          oldWeight: currentWeight,
          newWeight,
          reason: `Reliability ${(reliabilityRate * 100).toFixed(0)}% over ${total} events`,
        });
        this.weights.sourceReliability[source] = newWeight;
        insightMessages.push(
          `Source "${source}" reliability: ${(reliabilityRate * 100).toFixed(0)}% — weight adjusted to ${newWeight.toFixed(2)}.`,
        );
      }
    }

    // Analyze template performance
    const templateMap = new Map<string, { replied: number; ignored: number }>();
    for (const event of recentEvents) {
      if (event.entityType !== 'outreach') continue;
      const templateId = event.metadata['templateId'];
      if (!templateId) continue;
      const entry = templateMap.get(templateId) ?? { replied: 0, ignored: 0 };
      if (event.type === 'outreach_replied') entry.replied++;
      else if (event.type === 'outreach_ignored') entry.ignored++;
      templateMap.set(templateId, entry);
    }

    for (const [templateId, data] of templateMap) {
      const total = data.replied + data.ignored;
      if (total < MIN_SAMPLE_SIZE) continue;

      const replyRate = safeRate(data.replied, total);
      const currentWeight = this.weights.templatePerformance[templateId] ?? DEFAULT_WEIGHT;
      let newWeight = currentWeight + LEARNING_RATE * (replyRate - 0.3);
      newWeight = clampWeight(newWeight);

      if (newWeight !== currentWeight) {
        adjustments.push({
          factor: `template:${templateId}`,
          oldWeight: currentWeight,
          newWeight,
          reason: `Reply rate ${(replyRate * 100).toFixed(0)}% over ${total} outreach events`,
        });
        this.weights.templatePerformance[templateId] = newWeight;
      }
    }

    // Analyze best outreach timing
    const timingMap = new Map<string, { sent: number; replied: number }>();
    for (const event of recentEvents) {
      if (event.type !== 'outreach_replied' && event.type !== 'outreach_ignored') continue;
      const sentAtStr = event.metadata['sentAt'];
      if (!sentAtStr) continue;
      const sentDate = new Date(Number(sentAtStr));
      if (isNaN(sentDate.getTime())) continue;
      const key = `${sentDate.getDay()}:${sentDate.getHours()}`;
      const entry = timingMap.get(key) ?? { sent: 0, replied: 0 };
      entry.sent++;
      if (event.type === 'outreach_replied') entry.replied++;
      timingMap.set(key, entry);
    }

    let bestTimingKey = '';
    let bestTimingRate = 0;
    for (const [key, data] of timingMap) {
      if (data.sent < 3) continue;
      const rate = safeRate(data.replied, data.sent);
      if (rate > bestTimingRate) {
        bestTimingRate = rate;
        bestTimingKey = key;
      }
    }

    if (bestTimingKey) {
      const [dayStr, hourStr] = bestTimingKey.split(':');
      const day = Number(dayStr);
      const hour = Number(hourStr);
      if (!isNaN(day) && !isNaN(hour)) {
        const oldTiming = { ...this.weights.bestOutreachTiming };
        this.weights.bestOutreachTiming = { dayOfWeek: day, hourOfDay: hour };
        if (oldTiming.dayOfWeek !== day || oldTiming.hourOfDay !== hour) {
          insightMessages.push(
            `Best outreach timing shifted to day ${day} at ${hour}:00 (${(bestTimingRate * 100).toFixed(0)}% reply rate).`,
          );
        }
      }
    }

    // Summary insights
    const totalEvents = recentEvents.length;
    const usefulSignals = recentEvents.filter(e => e.type === 'signal_useful').length;
    const dismissedSignals = recentEvents.filter(e => e.type === 'signal_dismissed').length;
    const dealsWon = recentEvents.filter(e => e.type === 'deal_won').length;
    const dealsLost = recentEvents.filter(e => e.type === 'deal_lost').length;

    if (totalEvents > 0) {
      insightMessages.unshift(
        `Weekly summary: ${totalEvents} feedback events — ${usefulSignals} signals marked useful, ${dismissedSignals} dismissed, ${dealsWon} deals won, ${dealsLost} deals lost.`,
      );
    }

    if (adjustments.length === 0) {
      insightMessages.push('No weight adjustments needed this week — model is stable.');
    } else {
      insightMessages.push(`Applied ${adjustments.length} weight adjustment(s) this cycle.`);
    }

    this.weights.updatedAt = now;

    const insight: WeeklyInsight = {
      period: formatPeriod(weekStart, now),
      insights: insightMessages,
      weightAdjustments: adjustments,
      generatedAt: now,
    };

    this.insights.push(insight);

    // Keep only last 52 weeks of insights
    if (this.insights.length > 52) {
      this.insights = this.insights.slice(-52);
    }

    await Promise.all([
      this.persistWeights(),
      this.persistInsights(),
    ]);

    return insight;
  }

  /** Get past weekly insights. */
  async getWeeklyInsights(limit?: number): Promise<WeeklyInsight[]> {
    await this.ensureInit();

    const sorted = [...this.insights].sort((a, b) => b.generatedAt - a.generatedAt);
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  // ── Signal Type Performance ─────────────────────────────────────────────

  /** How each signal type performs (useful vs dismissed ratio). */
  async getSignalTypePerformance(): Promise<SignalTypePerformance[]> {
    await this.ensureInit();

    const signalEvents = Array.from(this.events.values())
      .filter(e => e.entityType === 'signal' && (e.type === 'signal_useful' || e.type === 'signal_dismissed'));

    return this.computeSignalTypePerformance(signalEvents);
  }

  private computeSignalTypePerformance(events: FeedbackEvent[]): SignalTypePerformance[] {
    const typeMap = new Map<string, { useful: number; dismissed: number }>();

    for (const event of events) {
      if (event.type !== 'signal_useful' && event.type !== 'signal_dismissed') continue;
      const signalType = event.metadata['signalType'] ?? 'unknown';
      const entry = typeMap.get(signalType) ?? { useful: 0, dismissed: 0 };
      if (event.type === 'signal_useful') entry.useful++;
      else entry.dismissed++;
      typeMap.set(signalType, entry);
    }

    const results: SignalTypePerformance[] = [];
    for (const [signalType, data] of typeMap) {
      const total = data.useful + data.dismissed;
      results.push({
        signalType,
        useful: data.useful,
        dismissed: data.dismissed,
        total,
        usefulRate: safeRate(data.useful, total),
        currentWeight: this.weights.signalTypeWeights[signalType] ?? DEFAULT_WEIGHT,
      });
    }

    return results.sort((a, b) => b.usefulRate - a.usefulRate);
  }

  // ── Recommended Adjustments ─────────────────────────────────────────────

  /** Suggest weight changes based on recent feedback without applying them. */
  async getRecommendedAdjustments(): Promise<RecommendedAdjustment[]> {
    await this.ensureInit();

    const now = Date.now();
    const recentEvents = Array.from(this.events.values())
      .filter(e => e.timestamp >= now - SEVEN_DAYS_MS);

    const recommendations: RecommendedAdjustment[] = [];

    // Signal type recommendations
    const signalPerf = this.computeSignalTypePerformance(recentEvents);
    for (const perf of signalPerf) {
      if (perf.total < MIN_SAMPLE_SIZE) continue;

      const currentWeight = this.weights.signalTypeWeights[perf.signalType] ?? DEFAULT_WEIGHT;
      let recommendedWeight: number;

      if (perf.usefulRate > 0.7) {
        recommendedWeight = clampWeight(currentWeight + LEARNING_RATE * (perf.usefulRate - 0.5));
      } else if (perf.usefulRate < 0.3) {
        recommendedWeight = clampWeight(currentWeight - LEARNING_RATE * (0.5 - perf.usefulRate));
      } else {
        continue;
      }

      if (recommendedWeight === currentWeight) continue;

      const confidence = Math.min(1.0, perf.total / 20);
      recommendations.push({
        factor: `signal:${perf.signalType}`,
        currentWeight,
        recommendedWeight,
        confidence,
        reason: `Useful rate ${(perf.usefulRate * 100).toFixed(0)}% across ${perf.total} events (confidence: ${(confidence * 100).toFixed(0)}%)`,
      });
    }

    // Source reliability recommendations
    const sourceMap = new Map<string, { positive: number; negative: number }>();
    for (const event of recentEvents) {
      const source = event.metadata['source'];
      if (!source) continue;
      const entry = sourceMap.get(source) ?? { positive: 0, negative: 0 };
      if (event.type === 'signal_useful' || event.type === 'outreach_replied' || event.type === 'deal_won') {
        entry.positive++;
      } else if (event.type === 'signal_dismissed' || event.type === 'not_relevant') {
        entry.negative++;
      }
      sourceMap.set(source, entry);
    }

    for (const [source, data] of sourceMap) {
      const total = data.positive + data.negative;
      if (total < MIN_SAMPLE_SIZE) continue;

      const reliabilityRate = safeRate(data.positive, total);
      const currentWeight = this.weights.sourceReliability[source] ?? DEFAULT_WEIGHT;
      const recommendedWeight = clampWeight(currentWeight + LEARNING_RATE * (reliabilityRate - 0.5));

      if (recommendedWeight === currentWeight) continue;

      const confidence = Math.min(1.0, total / 20);
      recommendations.push({
        factor: `source:${source}`,
        currentWeight,
        recommendedWeight,
        confidence,
        reason: `Reliability ${(reliabilityRate * 100).toFixed(0)}% across ${total} events (confidence: ${(confidence * 100).toFixed(0)}%)`,
      });
    }

    return recommendations.sort((a, b) => b.confidence - a.confidence);
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const feedbackLoop = new FeedbackLoop();
