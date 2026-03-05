/**
 * Outreach Tracker Service
 *
 * Tracks what happens after outreach is sent — opens, clicks, replies,
 * meetings booked — and provides analytics on outreach performance
 * broken down by signal type, day of week, template, and time of day.
 *
 * Persists all data via IndexedDB-backed persistent cache.
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ── Interfaces ───────────────────────────────────────────────────────────────

export type OutreachType = 'email' | 'linkedin' | 'call' | 'meeting';

export type OutreachStatus =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'meeting_booked';

export interface OutreachEvent {
  id: string;
  contactEmail: string;
  contactName: string;
  company: string;
  outreachType: OutreachType;
  status: OutreachStatus;
  signalId?: string;
  sequenceId?: string;
  stepNumber?: number;
  sentAt: number;
  engagedAt?: number;
  metadata: Record<string, string>;
}

export interface OutreachAnalytics {
  totalSent: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  meetingRate: number;
  bySignalType: Record<string, { sent: number; replied: number; replyRate: number }>;
  byDayOfWeek: Record<string, { sent: number; replied: number }>;
  byTemplate: Record<string, { sent: number; replied: number; replyRate: number }>;
  bestTimeOfDay: string;
  bestDayOfWeek: string;
  avgResponseTime: number;
}

interface SignalROI {
  signalType: string;
  totalOutreach: number;
  replies: number;
  replyRate: number;
  meetingsBooked: number;
  meetingRate: number;
}

interface TemplatePerformance {
  templateId: string;
  sent: number;
  opened: number;
  replied: number;
  meetingsBooked: number;
  openRate: number;
  replyRate: number;
  meetingRate: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'outreach-tracker:events';

const DAY_NAMES: readonly string[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const HOUR_LABELS: readonly string[] = Array.from({ length: 24 }, (_, i) => {
  const hour = i % 12 || 12;
  const suffix = i < 12 ? 'AM' : 'PM';
  return `${hour}:00 ${suffix}`;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `outreach_${ts}_${rand}`;
}

function isEngaged(status: OutreachStatus): boolean {
  return status === 'opened' || status === 'clicked' || status === 'replied' || status === 'meeting_booked';
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

// ── OutreachTracker Class ────────────────────────────────────────────────────

class OutreachTracker {
  private events: Map<string, OutreachEvent> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──────────────────────────────────────────────────────

  private ensureInit(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromCache().then(() => {
      this.initialized = true;
    }).catch(err => {
      console.warn('[outreach-tracker] Failed to load from cache, starting fresh', err);
      this.initialized = true;
    });

    return this.initPromise;
  }

  private async loadFromCache(): Promise<void> {
    const envelope = await getPersistentCache<OutreachEvent[]>(CACHE_KEY);
    if (!envelope?.data) return;

    this.events.clear();
    for (const event of envelope.data) {
      this.events.set(event.id, event);
    }
  }

  private async persist(): Promise<void> {
    const serialized = Array.from(this.events.values());
    await setPersistentCache(CACHE_KEY, serialized);
  }

  // ── Core Operations ─────────────────────────────────────────────────────

  /** Record a new outreach event. */
  async trackOutreach(event: Omit<OutreachEvent, 'id'>): Promise<OutreachEvent> {
    await this.ensureInit();

    const id = generateId();
    const full: OutreachEvent = { ...event, id };
    this.events.set(id, full);
    await this.persist();
    return full;
  }

  /** Update the status of an existing outreach event. */
  async updateStatus(id: string, status: OutreachStatus, engagedAt?: number): Promise<OutreachEvent> {
    await this.ensureInit();

    const event = this.events.get(id);
    if (!event) {
      throw new Error(`[outreach-tracker] Outreach event not found: ${id}`);
    }

    event.status = status;
    if (engagedAt !== undefined) {
      event.engagedAt = engagedAt;
    } else if (isEngaged(status) && !event.engagedAt) {
      event.engagedAt = Date.now();
    }

    await this.persist();
    return event;
  }

  /** Get all outreach events for a specific company. */
  async getOutreachForCompany(company: string): Promise<OutreachEvent[]> {
    await this.ensureInit();

    const normalized = company.trim().toLowerCase();
    return Array.from(this.events.values())
      .filter(e => e.company.toLowerCase() === normalized)
      .sort((a, b) => b.sentAt - a.sentAt);
  }

  /** Get all outreach events for a specific contact email. */
  async getOutreachForContact(email: string): Promise<OutreachEvent[]> {
    await this.ensureInit();

    const normalized = email.trim().toLowerCase();
    return Array.from(this.events.values())
      .filter(e => e.contactEmail.toLowerCase() === normalized)
      .sort((a, b) => b.sentAt - a.sentAt);
  }

  // ── Analytics ───────────────────────────────────────────────────────────

  /** Full analytics across all outreach within the given time window. */
  async getAnalytics(days?: number): Promise<OutreachAnalytics> {
    await this.ensureInit();

    const cutoff = days !== undefined ? Date.now() - days * 86_400_000 : 0;
    const filtered = Array.from(this.events.values())
      .filter(e => e.sentAt >= cutoff);

    const totalSent = filtered.length;
    if (totalSent === 0) {
      return {
        totalSent: 0, openRate: 0, clickRate: 0, replyRate: 0, meetingRate: 0,
        bySignalType: {}, byDayOfWeek: {}, byTemplate: {},
        bestTimeOfDay: 'N/A', bestDayOfWeek: 'N/A', avgResponseTime: 0,
      };
    }

    // Global counts
    let opened = 0;
    let clicked = 0;
    let replied = 0;
    let meetingsBooked = 0;

    // By signal type
    const signalMap = new Map<string, { sent: number; replied: number }>();
    // By day of week
    const dowMap = new Map<string, { sent: number; replied: number }>();
    // By template
    const templateMap = new Map<string, { sent: number; replied: number }>();
    // By hour of day (for best time calculation)
    const hourReplies = new Map<number, { sent: number; replied: number }>();
    // Response times
    const responseTimes: number[] = [];

    for (const event of filtered) {
      // Global status counts
      if (event.status === 'opened' || event.status === 'clicked' || event.status === 'replied' || event.status === 'meeting_booked') opened++;
      if (event.status === 'clicked' || event.status === 'replied' || event.status === 'meeting_booked') clicked++;
      if (event.status === 'replied' || event.status === 'meeting_booked') replied++;
      if (event.status === 'meeting_booked') meetingsBooked++;

      // Signal type breakdown
      const signalType = event.metadata['signalType'] ?? 'unknown';
      const signalEntry = signalMap.get(signalType) ?? { sent: 0, replied: 0 };
      signalEntry.sent++;
      if (event.status === 'replied' || event.status === 'meeting_booked') signalEntry.replied++;
      signalMap.set(signalType, signalEntry);

      // Day of week breakdown
      const sentDate = new Date(event.sentAt);
      const dayName = DAY_NAMES[sentDate.getDay()] ?? 'Unknown';
      const dowEntry = dowMap.get(dayName) ?? { sent: 0, replied: 0 };
      dowEntry.sent++;
      if (event.status === 'replied' || event.status === 'meeting_booked') dowEntry.replied++;
      dowMap.set(dayName, dowEntry);

      // Template breakdown
      const templateId = event.metadata['templateId'];
      if (templateId) {
        const tplEntry = templateMap.get(templateId) ?? { sent: 0, replied: 0 };
        tplEntry.sent++;
        if (event.status === 'replied' || event.status === 'meeting_booked') tplEntry.replied++;
        templateMap.set(templateId, tplEntry);
      }

      // Hour of day breakdown
      const hour = sentDate.getHours();
      const hourEntry = hourReplies.get(hour) ?? { sent: 0, replied: 0 };
      hourEntry.sent++;
      if (event.status === 'replied' || event.status === 'meeting_booked') hourEntry.replied++;
      hourReplies.set(hour, hourEntry);

      // Response time
      if (event.engagedAt && event.sentAt) {
        const responseHours = (event.engagedAt - event.sentAt) / 3_600_000;
        if (responseHours > 0) {
          responseTimes.push(responseHours);
        }
      }
    }

    // Build signal type analytics
    const bySignalType: Record<string, { sent: number; replied: number; replyRate: number }> = {};
    for (const [type, data] of signalMap) {
      bySignalType[type] = { ...data, replyRate: safeRate(data.replied, data.sent) };
    }

    // Build day of week analytics
    const byDayOfWeek: Record<string, { sent: number; replied: number }> = {};
    for (const [day, data] of dowMap) {
      byDayOfWeek[day] = data;
    }

    // Build template analytics
    const byTemplate: Record<string, { sent: number; replied: number; replyRate: number }> = {};
    for (const [tpl, data] of templateMap) {
      byTemplate[tpl] = { ...data, replyRate: safeRate(data.replied, data.sent) };
    }

    // Best time of day
    let bestHour = 0;
    let bestHourRate = 0;
    for (const [hour, data] of hourReplies) {
      const rate = safeRate(data.replied, data.sent);
      if (rate > bestHourRate || (rate === bestHourRate && data.sent > (hourReplies.get(bestHour)?.sent ?? 0))) {
        bestHour = hour;
        bestHourRate = rate;
      }
    }

    // Best day of week
    let bestDay = 'N/A';
    let bestDayRate = 0;
    for (const [day, data] of dowMap) {
      const rate = safeRate(data.replied, data.sent);
      if (rate > bestDayRate || (rate === bestDayRate && data.sent > (dowMap.get(bestDay)?.sent ?? 0))) {
        bestDay = day;
        bestDayRate = rate;
      }
    }

    // Average response time
    const avgResponseTime = responseTimes.length > 0
      ? Math.round((responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length) * 10) / 10
      : 0;

    return {
      totalSent,
      openRate: safeRate(opened, totalSent),
      clickRate: safeRate(clicked, totalSent),
      replyRate: safeRate(replied, totalSent),
      meetingRate: safeRate(meetingsBooked, totalSent),
      bySignalType,
      byDayOfWeek,
      byTemplate,
      bestTimeOfDay: HOUR_LABELS[bestHour] ?? `${bestHour}:00`,
      bestDayOfWeek: bestDay,
      avgResponseTime,
    };
  }

  /** Which signal types lead to the highest reply rates. */
  async getSignalROI(): Promise<SignalROI[]> {
    await this.ensureInit();

    const signalMap = new Map<string, { total: number; replies: number; meetings: number }>();

    for (const event of this.events.values()) {
      const signalType = event.metadata['signalType'];
      if (!signalType) continue;

      const entry = signalMap.get(signalType) ?? { total: 0, replies: 0, meetings: 0 };
      entry.total++;
      if (event.status === 'replied' || event.status === 'meeting_booked') entry.replies++;
      if (event.status === 'meeting_booked') entry.meetings++;
      signalMap.set(signalType, entry);
    }

    const results: SignalROI[] = [];
    for (const [signalType, data] of signalMap) {
      results.push({
        signalType,
        totalOutreach: data.total,
        replies: data.replies,
        replyRate: safeRate(data.replies, data.total),
        meetingsBooked: data.meetings,
        meetingRate: safeRate(data.meetings, data.total),
      });
    }

    return results.sort((a, b) => b.replyRate - a.replyRate);
  }

  /** Get the best performing templates by reply rate. */
  async getTopPerformingTemplates(limit?: number): Promise<TemplatePerformance[]> {
    await this.ensureInit();

    const templateMap = new Map<string, { sent: number; opened: number; replied: number; meetings: number }>();

    for (const event of this.events.values()) {
      const templateId = event.metadata['templateId'];
      if (!templateId) continue;

      const entry = templateMap.get(templateId) ?? { sent: 0, opened: 0, replied: 0, meetings: 0 };
      entry.sent++;
      if (event.status === 'opened' || event.status === 'clicked' || event.status === 'replied' || event.status === 'meeting_booked') {
        entry.opened++;
      }
      if (event.status === 'replied' || event.status === 'meeting_booked') entry.replied++;
      if (event.status === 'meeting_booked') entry.meetings++;
      templateMap.set(templateId, entry);
    }

    const results: TemplatePerformance[] = [];
    for (const [templateId, data] of templateMap) {
      results.push({
        templateId,
        sent: data.sent,
        opened: data.opened,
        replied: data.replied,
        meetingsBooked: data.meetings,
        openRate: safeRate(data.opened, data.sent),
        replyRate: safeRate(data.replied, data.sent),
        meetingRate: safeRate(data.meetings, data.sent),
      });
    }

    const sorted = results.sort((a, b) => b.replyRate - a.replyRate);
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const outreachTracker = new OutreachTracker();
