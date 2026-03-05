/**
 * Continuous Monitoring Agent — Runs lightweight daily/hourly monitoring sweeps
 * for every company on the user's watchlist.
 * Uses differential checking: only surfaces new signals since last check.
 */

import type { CompanySignal, SignalType } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ── Types ────────────────────────────────────────────────────────────────────

interface MonitorConfig {
  company: string;
  domain?: string;
  sources: MonitorSource[];
  alertThreshold: number; // 0-100, only alert if signal score exceeds this
  enabled: boolean;
}

type MonitorSource = 'news' | 'jobs' | 'github' | 'sec' | 'social';

interface MonitorSchedule {
  news: number;      // ms — every 10 minutes
  jobs: number;      // ms — every 6 hours
  github: number;    // ms — every 6 hours
  sec: number;       // ms — every 24 hours
  social: number;    // ms — every 7 days
}

interface MonitorCheckpoint {
  company: string;
  source: MonitorSource;
  lastCheckedAt: number;
  lastSignalAt: number;
  signalCount: number;
}

interface MonitorAlert {
  id: string;
  company: string;
  signal: CompanySignal;
  detectedAt: Date;
  acknowledged: boolean;
}

interface MonitorStatus {
  company: string;
  isActive: boolean;
  lastFullCheck: number;
  nextScheduledCheck: number;
  checkpoints: MonitorCheckpoint[];
  alertCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'monitor-agent:state';

const DEFAULT_SCHEDULE: MonitorSchedule = {
  news: 10 * 60 * 1000,        // 10 minutes
  jobs: 6 * 60 * 60 * 1000,    // 6 hours
  github: 6 * 60 * 60 * 1000,  // 6 hours
  sec: 24 * 60 * 60 * 1000,    // 24 hours
  social: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function generateId(): string {
  return `mon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function classifySignalType(title: string): SignalType {
  const lower = title.toLowerCase();
  if (/\b(hired|joins|appointed|new\s+(ceo|cto|cfo|cio|vp))\b/.test(lower)) return 'executive_movement';
  if (/\b(raised|funding|series\s+[a-e]|investment|round)\b/.test(lower)) return 'funding_event';
  if (/\b(hiring|open\s+positions|job|recruit)\b/.test(lower)) return 'hiring_surge';
  if (/\b(expansion|new\s+office|entering|launch)\b/.test(lower)) return 'expansion_signal';
  if (/\b(migrat|adopt|implement|stack|infrastructure)\b/.test(lower)) return 'technology_adoption';
  if (/\b(acqui|merger|ipo|earnings|revenue)\b/.test(lower)) return 'financial_trigger';
  if (/\b(tender|rfp|rfq|procurement)\b/.test(lower)) return 'tender_rfp';
  return 'press_release';
}

function scoreStrength(signal: { points?: number; comments?: number; recencyDays: number }): CompanySignal['strength'] {
  let score = 0;
  if ((signal.points ?? 0) > 100) score += 3;
  else if ((signal.points ?? 0) > 20) score += 2;
  else score += 1;
  if (signal.recencyDays <= 3) score += 3;
  else if (signal.recencyDays <= 7) score += 2;
  if (score >= 6) return 'critical';
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

// ── Monitor Agent ────────────────────────────────────────────────────────────

class MonitorAgent {
  private configs: Map<string, MonitorConfig> = new Map();
  private checkpoints: Map<string, MonitorCheckpoint> = new Map();
  private alerts: MonitorAlert[] = [];
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private alertCallbacks: Array<(alert: MonitorAlert) => void> = [];
  private loaded = false;

  // ── Configuration ──────────────────────────────────────────────────────

  async addToWatchlist(company: string, domain?: string, sources?: MonitorSource[]): Promise<void> {
    await this.ensureLoaded();
    const config: MonitorConfig = {
      company,
      domain,
      sources: sources ?? ['news', 'jobs', 'github'],
      alertThreshold: 50,
      enabled: true,
    };
    this.configs.set(company.toLowerCase(), config);
    await this.save();
  }

  async removeFromWatchlist(company: string): Promise<void> {
    await this.ensureLoaded();
    const key = company.toLowerCase();
    this.configs.delete(key);
    // Clear intervals
    const intervalKey = `monitor:${key}`;
    const interval = this.intervals.get(intervalKey);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(intervalKey);
    }
    await this.save();
  }

  async getWatchlist(): Promise<MonitorConfig[]> {
    await this.ensureLoaded();
    return Array.from(this.configs.values());
  }

  // ── Monitoring ─────────────────────────────────────────────────────────

  async runCheck(company: string, source?: MonitorSource): Promise<CompanySignal[]> {
    await this.ensureLoaded();
    const config = this.configs.get(company.toLowerCase());
    if (!config || !config.enabled) return [];

    const sources = source ? [source] : config.sources;
    const newSignals: CompanySignal[] = [];

    for (const src of sources) {
      const checkpointKey = `${company.toLowerCase()}:${src}`;
      const checkpoint = this.checkpoints.get(checkpointKey);
      const lastChecked = checkpoint?.lastCheckedAt ?? 0;

      const signals = await this.fetchSource(config.company, config.domain, src);

      // Filter to only new signals since last check
      const fresh = signals.filter(s => s.timestamp.getTime() > lastChecked);
      newSignals.push(...fresh);

      // Update checkpoint
      this.checkpoints.set(checkpointKey, {
        company: config.company,
        source: src,
        lastCheckedAt: Date.now(),
        lastSignalAt: fresh.length > 0 ? Math.max(...fresh.map(s => s.timestamp.getTime())) : (checkpoint?.lastSignalAt ?? 0),
        signalCount: (checkpoint?.signalCount ?? 0) + fresh.length,
      });
    }

    // Generate alerts for high-scoring signals
    for (const signal of newSignals) {
      if (signal.signalScore >= config.alertThreshold) {
        const alert: MonitorAlert = {
          id: generateId(),
          company: config.company,
          signal,
          detectedAt: new Date(),
          acknowledged: false,
        };
        this.alerts.push(alert);
        for (const cb of this.alertCallbacks) cb(alert);
      }
    }

    await this.save();
    return newSignals;
  }

  async runFullSweep(): Promise<Map<string, CompanySignal[]>> {
    await this.ensureLoaded();
    const results = new Map<string, CompanySignal[]>();

    for (const config of this.configs.values()) {
      if (!config.enabled) continue;
      const signals = await this.runCheck(config.company);
      if (signals.length > 0) {
        results.set(config.company, signals);
      }
    }

    return results;
  }

  startPeriodicMonitoring(): void {
    for (const config of this.configs.values()) {
      if (!config.enabled) continue;
      const key = `monitor:${config.company.toLowerCase()}`;
      if (this.intervals.has(key)) continue;

      // Use the shortest schedule interval for periodic checks
      const interval = setInterval(() => {
        void this.runCheck(config.company, 'news');
      }, DEFAULT_SCHEDULE.news);

      this.intervals.set(key, interval);
    }
  }

  stopPeriodicMonitoring(): void {
    for (const [key, interval] of this.intervals) {
      clearInterval(interval);
      this.intervals.delete(key);
    }
  }

  // ── Alerts ─────────────────────────────────────────────────────────────

  onAlert(callback: (alert: MonitorAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  getAlerts(acknowledged?: boolean): MonitorAlert[] {
    if (acknowledged === undefined) return [...this.alerts];
    return this.alerts.filter(a => a.acknowledged === acknowledged);
  }

  acknowledgeAlert(id: string): void {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) alert.acknowledged = true;
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  // ── Status ─────────────────────────────────────────────────────────────

  async getMonitorStatus(company: string): Promise<MonitorStatus | null> {
    await this.ensureLoaded();
    const config = this.configs.get(company.toLowerCase());
    if (!config) return null;

    const companyKey = company.toLowerCase();
    const checkpoints = Array.from(this.checkpoints.values())
      .filter(c => c.company.toLowerCase() === companyKey);

    const lastCheck = checkpoints.length > 0
      ? Math.max(...checkpoints.map(c => c.lastCheckedAt))
      : 0;

    return {
      company: config.company,
      isActive: config.enabled,
      lastFullCheck: lastCheck,
      nextScheduledCheck: lastCheck + DEFAULT_SCHEDULE.news,
      checkpoints,
      alertCount: this.alerts.filter(a => a.company.toLowerCase() === companyKey && !a.acknowledged).length,
    };
  }

  // ── Source Fetching ────────────────────────────────────────────────────

  private async fetchSource(company: string, domain: string | undefined, source: MonitorSource): Promise<CompanySignal[]> {
    switch (source) {
      case 'news': return this.fetchNewsSignals(company);
      case 'jobs': return this.fetchJobSignals(company);
      case 'github': return this.fetchGitHubSignals(domain ?? company.toLowerCase().replace(/\s+/g, ''));
      case 'sec': return this.fetchSECSignals(company);
      case 'social': return [];
      default: return [];
    }
  }

  private async fetchNewsSignals(company: string): Promise<CompanySignal[]> {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(company)}&tags=story&hitsPerPage=10&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - 7 * 86400}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return [];
      const data = await res.json() as { hits?: Array<{ title: string; url: string; created_at: string; points: number; num_comments: number }> };
      const now = Date.now();

      return (data.hits ?? []).map(h => {
        const recencyDays = (now - new Date(h.created_at).getTime()) / (24 * 60 * 60 * 1000);
        return {
          type: classifySignalType(h.title),
          company,
          strength: scoreStrength({ points: h.points, comments: h.num_comments, recencyDays }),
          title: h.title,
          summary: `${h.points} points, ${h.num_comments} comments on Hacker News`,
          timestamp: new Date(h.created_at),
          source: 'Hacker News',
          sourceTier: 2,
          signalScore: Math.min(100, (h.points ?? 0) / 3 + (h.num_comments ?? 0) / 2),
        };
      });
    } catch {
      return [];
    }
  }

  private async fetchJobSignals(company: string): Promise<CompanySignal[]> {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(company)}+hiring&tags=comment&hitsPerPage=5&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - 30 * 86400}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return [];
      const data = await res.json() as { hits?: Array<{ created_at: string; comment_text?: string }> };
      const hits = (data.hits ?? []).filter(h => (h.comment_text ?? '').toLowerCase().includes('hiring'));
      if (hits.length === 0) return [];

      return [{
        type: 'hiring_surge' as SignalType,
        company,
        strength: hits.length >= 3 ? 'high' : 'medium',
        title: `${company} hiring activity detected (${hits.length} mentions)`,
        timestamp: new Date(hits[0]!.created_at),
        source: 'HN Hiring Threads',
        sourceTier: 3,
        signalScore: Math.min(100, hits.length * 20),
      }];
    } catch {
      return [];
    }
  }

  private async fetchGitHubSignals(orgName: string): Promise<CompanySignal[]> {
    try {
      const res = await fetch(
        `https://api.github.com/orgs/${encodeURIComponent(orgName)}/repos?sort=created&per_page=5`,
        {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SalesIntel/1.0' },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!res.ok) return [];
      const repos = await res.json() as Array<{ full_name: string; description: string; created_at: string; stargazers_count: number }>;
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      return repos
        .filter(r => new Date(r.created_at).getTime() > thirtyDaysAgo)
        .map(r => ({
          type: 'technology_adoption' as SignalType,
          company: orgName,
          strength: (r.stargazers_count > 50 ? 'high' : 'medium') as CompanySignal['strength'],
          title: `New repository: ${r.full_name} — ${r.description ?? 'No description'}`,
          timestamp: new Date(r.created_at),
          source: 'GitHub',
          sourceTier: 2,
          signalScore: Math.min(100, r.stargazers_count + 30),
        }));
    } catch {
      return [];
    }
  }

  private async fetchSECSignals(company: string): Promise<CompanySignal[]> {
    try {
      const res = await fetch(
        `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(company)}&forms=10-K,10-Q,8-K&from=0&size=3`,
        {
          headers: { 'User-Agent': 'SalesIntel research@salesintel.app', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) return [];
      const data = await res.json() as { hits?: { hits?: Array<{ _source?: { form_type?: string; file_date?: string; display_names?: string[] } }> } };
      const hits = data.hits?.hits ?? [];
      if (hits.length === 0) return [];

      return hits.map(h => ({
        type: 'financial_trigger' as SignalType,
        company,
        strength: 'medium' as CompanySignal['strength'],
        title: `SEC Filing: ${h._source?.form_type ?? 'Unknown'} — ${h._source?.display_names?.[0] ?? company}`,
        timestamp: new Date(h._source?.file_date ?? Date.now()),
        source: 'SEC EDGAR',
        sourceTier: 1,
        signalScore: 60,
      }));
    } catch {
      return [];
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const cached = await getPersistentCache<{
        configs: Array<[string, MonitorConfig]>;
        checkpoints: Array<[string, MonitorCheckpoint]>;
      }>(CACHE_KEY);
      if (cached?.data) {
        this.configs = new Map(cached.data.configs);
        this.checkpoints = new Map(cached.data.checkpoints);
      }
    } catch {
      // Start fresh
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await setPersistentCache(CACHE_KEY, {
      configs: Array.from(this.configs.entries()),
      checkpoints: Array.from(this.checkpoints.entries()),
    });
  }
}

export const monitorAgent = new MonitorAgent();
