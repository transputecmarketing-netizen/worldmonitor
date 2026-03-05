/**
 * Unified Integration Hub — Slack, Teams, Email, Calendar, Webhooks
 *
 * Provides a single surface for configuring and dispatching notifications
 * across messaging platforms. Supports Slack Block Kit, Teams Adaptive Cards,
 * and generic webhook payloads for signal alerts, daily briefings, and
 * meeting preparation briefs.
 *
 * Persistence is handled via the persistent-cache layer (IndexedDB / Tauri / localStorage).
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ---------------------------------------------------------------------------
// Cache Keys
// ---------------------------------------------------------------------------

const CACHE_KEY_INTEGRATIONS = 'integration-hub:integrations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntegrationType = 'slack' | 'teams' | 'gmail' | 'outlook' | 'calendar' | 'webhook';

export interface IntegrationConfig {
  type: IntegrationType;
  enabled: boolean;
  webhookUrl?: string;
  apiKey?: string;
  channelId?: string;
  settings: Record<string, string>;
}

export interface IntegrationMessage {
  integration: IntegrationType;
  type: 'signal_alert' | 'deal_update' | 'daily_briefing' | 'meeting_prep' | 'custom';
  title: string;
  body: string;
  actionUrl?: string;
  metadata: Record<string, string>;
}

export interface IntegrationSendResult {
  integration: IntegrationType;
  success: boolean;
  statusCode?: number;
  error?: string;
  timestamp: number;
}

interface SignalInput {
  type: string;
  company: string;
  title: string;
  summary: string;
  strength: string;
  source?: string;
  url?: string;
  intentScore?: number;
}

interface BriefingInput {
  date: string;
  accountsMonitored: number;
  newSignals: number;
  hotAccounts: Array<{ name: string; score: number; topSignal: string }>;
  upcomingMeetings: number;
  pipelineValue?: number;
  topInsight?: string;
}

interface MeetingPrepInput {
  company: string;
  domain?: string;
  contactName?: string;
  contactTitle?: string;
  meetingTime?: string;
  accountHealthScore?: number;
  recentSignals: Array<{ type: string; title: string; date: string }>;
  competitiveNotes?: string;
  talkingPoints: string[];
}

// ---------------------------------------------------------------------------
// Slack Block Kit Structures
// ---------------------------------------------------------------------------

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string; style?: string }>;
  fields?: Array<{ type: string; text: string }>;
  accessory?: { type: string; text: { type: string; text: string }; url?: string };
}

interface SlackPayload {
  text: string;
  blocks: SlackBlock[];
}

// ---------------------------------------------------------------------------
// Teams Adaptive Card Structures
// ---------------------------------------------------------------------------

interface TeamsAdaptiveCard {
  type: string;
  attachments: Array<{
    contentType: string;
    content: {
      type: string;
      version: string;
      body: Array<{
        type: string;
        text?: string;
        size?: string;
        weight?: string;
        wrap?: boolean;
        columns?: Array<{
          type: string;
          width: string;
          items: Array<{ type: string; text: string; size?: string; weight?: string; wrap?: boolean }>;
        }>;
        facts?: Array<{ title: string; value: string }>;
      }>;
      actions?: Array<{ type: string; title: string; url: string }>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// IntegrationHub Class
// ---------------------------------------------------------------------------

class IntegrationHub {
  private integrations: Map<IntegrationType, IntegrationConfig> = new Map();
  private initialized = false;

  // ── Initialization ──────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      const cached = await getPersistentCache<Array<[IntegrationType, IntegrationConfig]>>(CACHE_KEY_INTEGRATIONS);
      if (cached) {
        this.integrations = new Map(cached.data);
      }
    } catch (err) {
      console.warn('[integration-hub] Failed to load persisted integrations', err);
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    try {
      await setPersistentCache(CACHE_KEY_INTEGRATIONS, Array.from(this.integrations.entries()));
    } catch (err) {
      console.warn('[integration-hub] Failed to persist integrations', err);
    }
  }

  // ── Configuration ───────────────────────────────────────────────────────

  async configureIntegration(config: IntegrationConfig): Promise<void> {
    await this.ensureInitialized();
    this.integrations.set(config.type, config);
    await this.persist();
  }

  async getIntegrations(): Promise<IntegrationConfig[]> {
    await this.ensureInitialized();
    return Array.from(this.integrations.values());
  }

  // ── Send Alert ──────────────────────────────────────────────────────────

  async sendAlert(message: IntegrationMessage): Promise<IntegrationSendResult[]> {
    await this.ensureInitialized();
    const results: IntegrationSendResult[] = [];

    for (const [type, config] of this.integrations) {
      if (!config.enabled) continue;

      // If message targets a specific integration, only send to that one
      if (message.integration !== type && message.integration !== 'webhook') continue;

      try {
        let result: IntegrationSendResult;

        switch (type) {
          case 'slack':
            result = config.webhookUrl
              ? await this.sendSlackMessage(config.webhookUrl, message)
              : { integration: type, success: false, error: 'No webhook URL configured', timestamp: Date.now() };
            break;

          case 'teams':
            result = config.webhookUrl
              ? await this.sendTeamsMessage(config.webhookUrl, message)
              : { integration: type, success: false, error: 'No webhook URL configured', timestamp: Date.now() };
            break;

          case 'webhook':
            result = config.webhookUrl
              ? await this.sendGenericWebhook(config.webhookUrl, message)
              : { integration: type, success: false, error: 'No webhook URL configured', timestamp: Date.now() };
            break;

          default:
            result = {
              integration: type,
              success: false,
              error: `Direct send not supported for ${type}; use webhook integration instead`,
              timestamp: Date.now(),
            };
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          integration: type,
          success: false,
          error: msg,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }

  // ── Slack ───────────────────────────────────────────────────────────────

  async sendSlackMessage(webhookUrl: string, message: IntegrationMessage): Promise<IntegrationSendResult> {
    const payload = this.buildSlackPayload(message);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      return {
        integration: 'slack',
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `Slack webhook returned ${response.status}`,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        integration: 'slack',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }

  // ── Teams ───────────────────────────────────────────────────────────────

  async sendTeamsMessage(webhookUrl: string, message: IntegrationMessage): Promise<IntegrationSendResult> {
    const payload = this.buildTeamsPayload(message);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      return {
        integration: 'teams',
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `Teams webhook returned ${response.status}`,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        integration: 'teams',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }

  // ── Formatting: Signal Alert ────────────────────────────────────────────

  formatSignalAlert(signal: SignalInput): IntegrationMessage {
    const strengthEmoji: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };

    const emoji = strengthEmoji[signal.strength] ?? '⚪';

    return {
      integration: 'slack',
      type: 'signal_alert',
      title: `${emoji} ${signal.type.replace(/_/g, ' ').toUpperCase()} — ${signal.company}`,
      body: [
        `**${signal.title}**`,
        '',
        signal.summary,
        '',
        `Source: ${signal.source ?? 'Unknown'}`,
        signal.intentScore !== undefined ? `Intent Score: ${signal.intentScore}/100` : '',
        `Strength: ${signal.strength}`,
      ].filter(Boolean).join('\n'),
      actionUrl: signal.url,
      metadata: {
        signalType: signal.type,
        company: signal.company,
        strength: signal.strength,
        ...(signal.intentScore !== undefined ? { intentScore: String(signal.intentScore) } : {}),
      },
    };
  }

  // ── Formatting: Daily Briefing ──────────────────────────────────────────

  formatDailyBriefing(briefingData: BriefingInput): IntegrationMessage {
    const hotAccountLines = briefingData.hotAccounts
      .slice(0, 5)
      .map((a) => `  - ${a.name} (Score: ${a.score}) — ${a.topSignal}`)
      .join('\n');

    const body = [
      `📅 **Daily Intelligence Briefing — ${briefingData.date}**`,
      '',
      `📊 Accounts Monitored: ${briefingData.accountsMonitored}`,
      `🔔 New Signals: ${briefingData.newSignals}`,
      `📆 Upcoming Meetings: ${briefingData.upcomingMeetings}`,
      briefingData.pipelineValue !== undefined
        ? `💰 Pipeline Value: $${briefingData.pipelineValue.toLocaleString()}`
        : '',
      '',
      '🔥 **Hot Accounts:**',
      hotAccountLines || '  No hot accounts today.',
      '',
      briefingData.topInsight
        ? `💡 **Top Insight:** ${briefingData.topInsight}`
        : '',
    ].filter(Boolean).join('\n');

    return {
      integration: 'slack',
      type: 'daily_briefing',
      title: `Daily Briefing — ${briefingData.date}`,
      body,
      metadata: {
        date: briefingData.date,
        signalCount: String(briefingData.newSignals),
        accountCount: String(briefingData.accountsMonitored),
      },
    };
  }

  // ── Formatting: Meeting Prep ────────────────────────────────────────────

  formatMeetingPrep(company: string, intel: MeetingPrepInput): IntegrationMessage {
    const signalLines = intel.recentSignals
      .slice(0, 5)
      .map((s) => `  - [${s.date}] ${s.type}: ${s.title}`)
      .join('\n');

    const talkingPointLines = intel.talkingPoints
      .map((tp, i) => `  ${i + 1}. ${tp}`)
      .join('\n');

    const body = [
      `🤝 **Pre-Meeting Brief: ${company}**`,
      intel.meetingTime ? `📅 Meeting: ${intel.meetingTime}` : '',
      intel.contactName ? `👤 Contact: ${intel.contactName}${intel.contactTitle ? ` (${intel.contactTitle})` : ''}` : '',
      intel.domain ? `🌐 ${intel.domain}` : '',
      intel.accountHealthScore !== undefined ? `📊 Account Health: ${intel.accountHealthScore}/100` : '',
      '',
      '📡 **Recent Signals:**',
      signalLines || '  No recent signals.',
      '',
      '💬 **Talking Points:**',
      talkingPointLines || '  No talking points prepared.',
      '',
      intel.competitiveNotes ? `⚔️ **Competitive Notes:** ${intel.competitiveNotes}` : '',
    ].filter(Boolean).join('\n');

    return {
      integration: 'slack',
      type: 'meeting_prep',
      title: `Meeting Prep — ${company}`,
      body,
      actionUrl: intel.domain ? `https://${intel.domain}` : undefined,
      metadata: {
        company,
        ...(intel.contactName ? { contact: intel.contactName } : {}),
        ...(intel.meetingTime ? { meetingTime: intel.meetingTime } : {}),
        ...(intel.accountHealthScore !== undefined ? { healthScore: String(intel.accountHealthScore) } : {}),
      },
    };
  }

  // ── Test Integration ────────────────────────────────────────────────────

  async testIntegration(type: IntegrationType): Promise<IntegrationSendResult> {
    await this.ensureInitialized();

    const config = this.integrations.get(type);
    if (!config) {
      return {
        integration: type,
        success: false,
        error: `Integration "${type}" is not configured`,
        timestamp: Date.now(),
      };
    }

    if (!config.enabled) {
      return {
        integration: type,
        success: false,
        error: `Integration "${type}" is disabled`,
        timestamp: Date.now(),
      };
    }

    const testMessage: IntegrationMessage = {
      integration: type,
      type: 'custom',
      title: 'Integration Test',
      body: 'This is a test message from WorldMonitor. If you see this, your integration is working correctly.',
      metadata: {
        source: 'integration-hub',
        testTimestamp: new Date().toISOString(),
      },
    };

    switch (type) {
      case 'slack':
        return config.webhookUrl
          ? this.sendSlackMessage(config.webhookUrl, testMessage)
          : { integration: type, success: false, error: 'No webhook URL configured for Slack', timestamp: Date.now() };

      case 'teams':
        return config.webhookUrl
          ? this.sendTeamsMessage(config.webhookUrl, testMessage)
          : { integration: type, success: false, error: 'No webhook URL configured for Teams', timestamp: Date.now() };

      case 'webhook':
        return config.webhookUrl
          ? this.sendGenericWebhook(config.webhookUrl, testMessage)
          : { integration: type, success: false, error: 'No webhook URL configured', timestamp: Date.now() };

      default:
        return {
          integration: type,
          success: false,
          error: `Test not supported for integration type "${type}"`,
          timestamp: Date.now(),
        };
    }
  }

  // ── Private: Slack Block Kit Builder ────────────────────────────────────

  private buildSlackPayload(message: IntegrationMessage): SlackPayload {
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: message.title, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: message.body.replace(/\*\*/g, '*') },
      },
    ];

    // Add metadata fields
    const metaFields = Object.entries(message.metadata)
      .slice(0, 10)
      .map(([key, value]) => ({
        type: 'mrkdwn' as const,
        text: `*${key}:* ${value}`,
      }));

    if (metaFields.length > 0) {
      blocks.push({
        type: 'section',
        fields: metaFields,
      });
    }

    // Add action button if URL provided
    if (message.actionUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Details' },
            url: message.actionUrl,
            style: 'primary',
          },
        ],
      });
    }

    // Divider at the end
    blocks.push({ type: 'divider' });

    return {
      text: message.title,
      blocks,
    };
  }

  // ── Private: Teams Adaptive Card Builder ────────────────────────────────

  private buildTeamsPayload(message: IntegrationMessage): TeamsAdaptiveCard {
    const body: TeamsAdaptiveCard['attachments'][0]['content']['body'] = [
      {
        type: 'TextBlock',
        text: message.title,
        size: 'Large',
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: message.body,
        wrap: true,
      },
    ];

    // Add metadata as fact set
    const facts = Object.entries(message.metadata).map(([key, value]) => ({
      title: key,
      value,
    }));

    if (facts.length > 0) {
      body.push({
        type: 'FactSet',
        facts,
      });
    }

    const actions: Array<{ type: string; title: string; url: string }> = [];
    if (message.actionUrl) {
      actions.push({
        type: 'Action.OpenUrl',
        title: 'View Details',
        url: message.actionUrl,
      });
    }

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body,
            ...(actions.length > 0 ? { actions } : {}),
          },
        },
      ],
    };
  }

  // ── Private: Generic Webhook ────────────────────────────────────────────

  private async sendGenericWebhook(webhookUrl: string, message: IntegrationMessage): Promise<IntegrationSendResult> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: message.type,
          title: message.title,
          body: message.body,
          actionUrl: message.actionUrl,
          metadata: message.metadata,
          sentAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });

      return {
        integration: 'webhook',
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `Webhook returned ${response.status}`,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        integration: 'webhook',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

export const integrationHub = new IntegrationHub();
