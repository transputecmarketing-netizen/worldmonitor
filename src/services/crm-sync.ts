/**
 * Bi-Directional CRM Sync Service
 *
 * Provides push/pull synchronization with Salesforce and HubSpot CRMs,
 * including account data, contacts, activities, and deal stages.
 * Supports CSV and JSON export for offline workflows.
 *
 * Persistence is handled via the persistent-cache layer (IndexedDB / Tauri / localStorage).
 */

import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ---------------------------------------------------------------------------
// Cache Keys
// ---------------------------------------------------------------------------

const CACHE_KEY_CONFIG = 'crm-sync:config';
const CACHE_KEY_SYNC_HISTORY = 'crm-sync:history';
const CACHE_KEY_ACCOUNTS = 'crm-sync:accounts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CRMProvider = 'salesforce' | 'hubspot' | 'none';

export interface CRMConfig {
  provider: CRMProvider;
  apiKey?: string;
  instanceUrl?: string;
  syncEnabled: boolean;
  syncInterval: number; // minutes
  lastSyncAt?: number;
  fieldMapping: Record<string, string>;
}

export interface CRMSyncResult {
  provider: CRMProvider;
  direction: 'push' | 'pull';
  timestamp: number;
  accountsUpdated: number;
  contactsCreated: number;
  activitiesLogged: number;
  errors: string[];
  duration: number;
}

export interface CRMAccount {
  externalId: string;
  name: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  accountHealthScore?: number;
  propensityScore?: number;
  lifecycleStage?: string;
  buyingWindow?: string;
  lastSignalDate?: string;
  signalCount?: number;
}

export interface CRMActivity {
  type: 'signal_detected' | 'outreach_sent' | 'intel_generated' | 'score_changed';
  subject: string;
  description: string;
  accountId: string;
  contactId?: string;
  timestamp: string;
}

export interface CRMContact {
  externalId?: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  phone?: string;
  accountId: string;
  linkedInUrl?: string;
}

interface CRMDealStage {
  dealId: string;
  dealName: string;
  stage: string;
  amount?: number;
  closeDate?: string;
  accountId: string;
  lastModified: string;
}

// ---------------------------------------------------------------------------
// Salesforce Object Formats
// ---------------------------------------------------------------------------

interface SalesforceAccountPayload {
  Name: string;
  Website?: string;
  Industry?: string;
  NumberOfEmployees?: number;
  Description?: string;
  Account_Health_Score__c?: number;
  Propensity_Score__c?: number;
  Lifecycle_Stage__c?: string;
  Buying_Window__c?: string;
  Last_Signal_Date__c?: string;
  Signal_Count__c?: number;
  [key: string]: string | number | undefined;
}

interface SalesforceTaskPayload {
  Subject: string;
  Description: string;
  WhatId: string;
  WhoId?: string;
  ActivityDate: string;
  Status: string;
  Type: string;
}

interface SalesforceContactPayload {
  FirstName: string;
  LastName: string;
  Email: string;
  Title?: string;
  Phone?: string;
  AccountId: string;
  LinkedIn_URL__c?: string;
}

// ---------------------------------------------------------------------------
// HubSpot Object Formats
// ---------------------------------------------------------------------------

interface HubSpotAccountPayload {
  properties: {
    name: string;
    domain?: string;
    industry?: string;
    numberofemployees?: number;
    description?: string;
    account_health_score?: number;
    propensity_score?: number;
    lifecyclestage?: string;
    buying_window?: string;
    last_signal_date?: string;
    signal_count?: number;
    [key: string]: string | number | undefined;
  };
}

interface HubSpotContactPayload {
  properties: {
    firstname: string;
    lastname: string;
    email: string;
    jobtitle?: string;
    phone?: string;
    linkedin_url?: string;
    hs_lead_status?: string;
  };
}

interface HubSpotEngagementPayload {
  engagement: {
    type: string;
    timestamp: number;
  };
  metadata: {
    subject: string;
    body: string;
  };
  associations: {
    companyIds: string[];
    contactIds: string[];
  };
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CRMConfig = {
  provider: 'none',
  syncEnabled: false,
  syncInterval: 60,
  fieldMapping: {
    name: 'name',
    domain: 'domain',
    industry: 'industry',
    employeeCount: 'employeeCount',
    accountHealthScore: 'accountHealthScore',
    propensityScore: 'propensityScore',
    lifecycleStage: 'lifecycleStage',
    buyingWindow: 'buyingWindow',
  },
};

const MAX_SYNC_HISTORY = 100;

// ---------------------------------------------------------------------------
// CRMSync Class
// ---------------------------------------------------------------------------

class CRMSync {
  private config: CRMConfig = { ...DEFAULT_CONFIG };
  private syncHistory: CRMSyncResult[] = [];
  private initialized = false;

  // ── Initialization ──────────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      const cached = await getPersistentCache<CRMConfig>(CACHE_KEY_CONFIG);
      if (cached) {
        this.config = cached.data;
      }
      const history = await getPersistentCache<CRMSyncResult[]>(CACHE_KEY_SYNC_HISTORY);
      if (history) {
        this.syncHistory = history.data;
      }
    } catch (err) {
      console.warn('[crm-sync] Failed to load persisted state', err);
    }
    this.initialized = true;
  }

  private async persist(): Promise<void> {
    try {
      await setPersistentCache(CACHE_KEY_CONFIG, this.config);
      await setPersistentCache(CACHE_KEY_SYNC_HISTORY, this.syncHistory);
    } catch (err) {
      console.warn('[crm-sync] Failed to persist state', err);
    }
  }

  // ── Configuration ───────────────────────────────────────────────────────

  async configure(config: Partial<CRMConfig>): Promise<CRMConfig> {
    await this.ensureInitialized();
    this.config = { ...this.config, ...config };
    await this.persist();
    return this.config;
  }

  async getConfig(): Promise<CRMConfig> {
    await this.ensureInitialized();
    return { ...this.config };
  }

  // ── Push Operations ─────────────────────────────────────────────────────

  async pushAccounts(accounts: CRMAccount[]): Promise<CRMSyncResult> {
    await this.ensureInitialized();
    const start = Date.now();
    const errors: string[] = [];

    if (this.config.provider === 'none') {
      return this.buildResult('push', 0, 0, 0, ['No CRM provider configured'], start);
    }

    if (!this.config.apiKey) {
      return this.buildResult('push', 0, 0, 0, [`No API key configured for ${this.config.provider}`], start);
    }

    let updated = 0;

    for (const account of accounts) {
      try {
        if (this.config.provider === 'salesforce') {
          await this.pushToSalesforce('/services/data/v58.0/sobjects/Account/', this.formatForSalesforce(account));
        } else {
          await this.pushToHubSpot('/crm/v3/objects/companies', this.formatForHubSpot(account));
        }
        updated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to push account "${account.name}": ${msg}`);
      }
    }

    const result = this.buildResult('push', updated, 0, 0, errors, start);
    await this.recordSyncResult(result);
    return result;
  }

  async pushActivities(activities: CRMActivity[]): Promise<CRMSyncResult> {
    await this.ensureInitialized();
    const start = Date.now();
    const errors: string[] = [];

    if (this.config.provider === 'none') {
      return this.buildResult('push', 0, 0, 0, ['No CRM provider configured'], start);
    }

    if (!this.config.apiKey) {
      return this.buildResult('push', 0, 0, 0, [`No API key configured for ${this.config.provider}`], start);
    }

    let logged = 0;

    for (const activity of activities) {
      try {
        if (this.config.provider === 'salesforce') {
          const payload: SalesforceTaskPayload = {
            Subject: activity.subject,
            Description: activity.description,
            WhatId: activity.accountId,
            WhoId: activity.contactId,
            ActivityDate: activity.timestamp.split('T')[0] ?? '',
            Status: 'Completed',
            Type: this.mapActivityTypeToSalesforce(activity.type),
          };
          await this.pushToSalesforce('/services/data/v58.0/sobjects/Task/', payload);
        } else {
          const payload: HubSpotEngagementPayload = {
            engagement: {
              type: 'NOTE',
              timestamp: new Date(activity.timestamp).getTime(),
            },
            metadata: {
              subject: activity.subject,
              body: activity.description,
            },
            associations: {
              companyIds: [activity.accountId],
              contactIds: activity.contactId ? [activity.contactId] : [],
            },
          };
          await this.pushToHubSpot('/engagements/v1/engagements', payload);
        }
        logged++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to log activity "${activity.subject}": ${msg}`);
      }
    }

    const result = this.buildResult('push', 0, 0, logged, errors, start);
    await this.recordSyncResult(result);
    return result;
  }

  async pushContacts(contacts: CRMContact[]): Promise<CRMSyncResult> {
    await this.ensureInitialized();
    const start = Date.now();
    const errors: string[] = [];

    if (this.config.provider === 'none') {
      return this.buildResult('push', 0, 0, 0, ['No CRM provider configured'], start);
    }

    if (!this.config.apiKey) {
      return this.buildResult('push', 0, 0, 0, [`No API key configured for ${this.config.provider}`], start);
    }

    let created = 0;

    for (const contact of contacts) {
      try {
        if (this.config.provider === 'salesforce') {
          const payload: SalesforceContactPayload = {
            FirstName: contact.firstName,
            LastName: contact.lastName,
            Email: contact.email,
            Title: contact.title,
            Phone: contact.phone,
            AccountId: contact.accountId,
            LinkedIn_URL__c: contact.linkedInUrl,
          };
          await this.pushToSalesforce('/services/data/v58.0/sobjects/Contact/', payload);
        } else {
          const payload: HubSpotContactPayload = {
            properties: {
              firstname: contact.firstName,
              lastname: contact.lastName,
              email: contact.email,
              jobtitle: contact.title,
              phone: contact.phone,
              linkedin_url: contact.linkedInUrl,
              hs_lead_status: 'NEW',
            },
          };
          await this.pushToHubSpot('/crm/v3/objects/contacts', payload);
        }
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create contact "${contact.firstName} ${contact.lastName}": ${msg}`);
      }
    }

    const result = this.buildResult('push', 0, created, 0, errors, start);
    await this.recordSyncResult(result);
    return result;
  }

  // ── Pull Operations ─────────────────────────────────────────────────────

  async pullAccounts(): Promise<CRMAccount[]> {
    await this.ensureInitialized();

    if (this.config.provider === 'none' || !this.config.apiKey) {
      return [];
    }

    const start = Date.now();
    const errors: string[] = [];

    try {
      let rawAccounts: Record<string, unknown>[];

      if (this.config.provider === 'salesforce') {
        const query = encodeURIComponent(
          'SELECT Id, Name, Website, Industry, NumberOfEmployees, Account_Health_Score__c, '
          + 'Propensity_Score__c, Lifecycle_Stage__c, Buying_Window__c, Last_Signal_Date__c, '
          + 'Signal_Count__c FROM Account ORDER BY LastModifiedDate DESC LIMIT 200'
        );
        const response = await this.fetchFromSalesforce(`/services/data/v58.0/query/?q=${query}`);
        rawAccounts = (response as { records: Record<string, unknown>[] }).records ?? [];
      } else {
        const response = await this.fetchFromHubSpot(
          '/crm/v3/objects/companies?limit=200&properties=name,domain,industry,numberofemployees,'
          + 'account_health_score,propensity_score,lifecyclestage,buying_window,'
          + 'last_signal_date,signal_count'
        );
        rawAccounts = (response as { results: Record<string, unknown>[] }).results ?? [];
      }

      const accounts = rawAccounts.map((raw) => this.normalizeAccount(raw));

      // Cache pulled accounts locally
      await setPersistentCache(CACHE_KEY_ACCOUNTS, accounts);

      const result = this.buildResult('pull', accounts.length, 0, 0, errors, start);
      await this.recordSyncResult(result);

      return accounts;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Pull accounts failed: ${msg}`);
      const result = this.buildResult('pull', 0, 0, 0, errors, start);
      await this.recordSyncResult(result);
      return [];
    }
  }

  async pullDealStages(): Promise<CRMDealStage[]> {
    await this.ensureInitialized();

    if (this.config.provider === 'none' || !this.config.apiKey) {
      return [];
    }

    try {
      if (this.config.provider === 'salesforce') {
        const query = encodeURIComponent(
          'SELECT Id, Name, StageName, Amount, CloseDate, AccountId, LastModifiedDate '
          + 'FROM Opportunity ORDER BY LastModifiedDate DESC LIMIT 200'
        );
        const response = await this.fetchFromSalesforce(`/services/data/v58.0/query/?q=${query}`);
        const records = (response as { records: Record<string, unknown>[] }).records ?? [];

        return records.map((r) => ({
          dealId: String(r.Id ?? ''),
          dealName: String(r.Name ?? ''),
          stage: String(r.StageName ?? ''),
          amount: typeof r.Amount === 'number' ? r.Amount : undefined,
          closeDate: typeof r.CloseDate === 'string' ? r.CloseDate : undefined,
          accountId: String(r.AccountId ?? ''),
          lastModified: String(r.LastModifiedDate ?? ''),
        }));
      } else {
        const response = await this.fetchFromHubSpot(
          '/crm/v3/objects/deals?limit=200&properties=dealname,dealstage,amount,closedate,'
          + 'hs_lastmodifieddate'
        );
        const results = (response as { results: Record<string, unknown>[] }).results ?? [];

        return results.map((r) => {
          const props = (r.properties ?? {}) as Record<string, unknown>;
          return {
            dealId: String(r.id ?? ''),
            dealName: String(props.dealname ?? ''),
            stage: String(props.dealstage ?? ''),
            amount: typeof props.amount === 'number' ? props.amount : undefined,
            closeDate: typeof props.closedate === 'string' ? props.closedate : undefined,
            accountId: String(props.hs_object_id ?? ''),
            lastModified: String(props.hs_lastmodifieddate ?? ''),
          };
        });
      }
    } catch (err) {
      console.warn('[crm-sync] Pull deal stages failed', err);
      return [];
    }
  }

  // ── Full Sync ───────────────────────────────────────────────────────────

  async syncAll(): Promise<{ push: CRMSyncResult; pull: CRMSyncResult }> {
    await this.ensureInitialized();

    // Pull first to get latest data
    const pullStart = Date.now();
    const pulledAccounts = await this.pullAccounts();
    const pullResult = this.syncHistory[this.syncHistory.length - 1] ?? this.buildResult('pull', 0, 0, 0, [], pullStart);

    // Push local accounts that might have updates
    const cachedAccounts = await getPersistentCache<CRMAccount[]>(CACHE_KEY_ACCOUNTS);
    const localAccounts = cachedAccounts?.data ?? [];
    const pushResult = localAccounts.length > 0
      ? await this.pushAccounts(localAccounts)
      : this.buildResult('push', 0, 0, 0, [], Date.now());

    // Update last sync timestamp
    this.config.lastSyncAt = Date.now();
    await this.persist();

    // Cache the combined pulled accounts
    if (pulledAccounts.length > 0) {
      await setPersistentCache(CACHE_KEY_ACCOUNTS, pulledAccounts);
    }

    return { push: pushResult, pull: pullResult };
  }

  // ── Sync History ────────────────────────────────────────────────────────

  async getSyncHistory(limit = 20): Promise<CRMSyncResult[]> {
    await this.ensureInitialized();
    return this.syncHistory.slice(-limit);
  }

  // ── Data Formatting ─────────────────────────────────────────────────────

  formatForSalesforce(account: CRMAccount): SalesforceAccountPayload {
    const payload: SalesforceAccountPayload = {
      Name: account.name,
    };

    if (account.domain) payload.Website = account.domain;
    if (account.industry) payload.Industry = account.industry;
    if (account.employeeCount !== undefined) payload.NumberOfEmployees = account.employeeCount;
    if (account.accountHealthScore !== undefined) payload.Account_Health_Score__c = account.accountHealthScore;
    if (account.propensityScore !== undefined) payload.Propensity_Score__c = account.propensityScore;
    if (account.lifecycleStage) payload.Lifecycle_Stage__c = account.lifecycleStage;
    if (account.buyingWindow) payload.Buying_Window__c = account.buyingWindow;
    if (account.lastSignalDate) payload.Last_Signal_Date__c = account.lastSignalDate;
    if (account.signalCount !== undefined) payload.Signal_Count__c = account.signalCount;

    // Apply custom field mapping
    for (const [localField, sfField] of Object.entries(this.config.fieldMapping)) {
      const value = account[localField as keyof CRMAccount];
      if (value !== undefined && sfField !== localField) {
        payload[sfField] = value as string | number;
      }
    }

    return payload;
  }

  formatForHubSpot(account: CRMAccount): HubSpotAccountPayload {
    const properties: HubSpotAccountPayload['properties'] = {
      name: account.name,
    };

    if (account.domain) properties.domain = account.domain;
    if (account.industry) properties.industry = account.industry;
    if (account.employeeCount !== undefined) properties.numberofemployees = account.employeeCount;
    if (account.accountHealthScore !== undefined) properties.account_health_score = account.accountHealthScore;
    if (account.propensityScore !== undefined) properties.propensity_score = account.propensityScore;
    if (account.lifecycleStage) properties.lifecyclestage = account.lifecycleStage;
    if (account.buyingWindow) properties.buying_window = account.buyingWindow;
    if (account.lastSignalDate) properties.last_signal_date = account.lastSignalDate;
    if (account.signalCount !== undefined) properties.signal_count = account.signalCount;

    // Apply custom field mapping
    for (const [localField, hsField] of Object.entries(this.config.fieldMapping)) {
      const value = account[localField as keyof CRMAccount];
      if (value !== undefined && hsField !== localField) {
        properties[hsField] = value as string | number;
      }
    }

    return { properties };
  }

  // ── Export Functions ────────────────────────────────────────────────────

  exportToCSV(accounts: CRMAccount[]): string {
    if (accounts.length === 0) return '';

    const headers: (keyof CRMAccount)[] = [
      'externalId', 'name', 'domain', 'industry', 'employeeCount',
      'accountHealthScore', 'propensityScore', 'lifecycleStage',
      'buyingWindow', 'lastSignalDate', 'signalCount',
    ];

    const escapeCSV = (value: string | number | undefined): string => {
      if (value === undefined || value === null) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [
      headers.join(','),
      ...accounts.map((account) =>
        headers.map((h) => escapeCSV(account[h])).join(',')
      ),
    ];

    return rows.join('\n');
  }

  exportToJSON(accounts: CRMAccount[]): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      provider: this.config.provider,
      accountCount: accounts.length,
      accounts,
    }, null, 2);
  }

  // ── Private: API Communication ──────────────────────────────────────────

  private async pushToSalesforce(path: string, payload: unknown): Promise<void> {
    const baseUrl = this.config.instanceUrl ?? 'https://login.salesforce.com';
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`Salesforce API ${response.status}: ${errorBody}`);
    }
  }

  private async fetchFromSalesforce(path: string): Promise<unknown> {
    const baseUrl = this.config.instanceUrl ?? 'https://login.salesforce.com';
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`Salesforce API ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  private async pushToHubSpot(path: string, payload: unknown): Promise<void> {
    const response = await fetch(`https://api.hubapi.com${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`HubSpot API ${response.status}: ${errorBody}`);
    }
  }

  private async fetchFromHubSpot(path: string): Promise<unknown> {
    const response = await fetch(`https://api.hubapi.com${path}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`HubSpot API ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  // ── Private: Helpers ────────────────────────────────────────────────────

  private buildResult(
    direction: 'push' | 'pull',
    accountsUpdated: number,
    contactsCreated: number,
    activitiesLogged: number,
    errors: string[],
    startTime: number,
  ): CRMSyncResult {
    return {
      provider: this.config.provider,
      direction,
      timestamp: Date.now(),
      accountsUpdated,
      contactsCreated,
      activitiesLogged,
      errors,
      duration: Date.now() - startTime,
    };
  }

  private async recordSyncResult(result: CRMSyncResult): Promise<void> {
    this.syncHistory.push(result);
    if (this.syncHistory.length > MAX_SYNC_HISTORY) {
      this.syncHistory = this.syncHistory.slice(-MAX_SYNC_HISTORY);
    }
    await this.persist();
  }

  private normalizeAccount(raw: Record<string, unknown>): CRMAccount {
    if (this.config.provider === 'salesforce') {
      return {
        externalId: String(raw.Id ?? ''),
        name: String(raw.Name ?? ''),
        domain: typeof raw.Website === 'string' ? raw.Website : undefined,
        industry: typeof raw.Industry === 'string' ? raw.Industry : undefined,
        employeeCount: typeof raw.NumberOfEmployees === 'number' ? raw.NumberOfEmployees : undefined,
        accountHealthScore: typeof raw.Account_Health_Score__c === 'number' ? raw.Account_Health_Score__c : undefined,
        propensityScore: typeof raw.Propensity_Score__c === 'number' ? raw.Propensity_Score__c : undefined,
        lifecycleStage: typeof raw.Lifecycle_Stage__c === 'string' ? raw.Lifecycle_Stage__c : undefined,
        buyingWindow: typeof raw.Buying_Window__c === 'string' ? raw.Buying_Window__c : undefined,
        lastSignalDate: typeof raw.Last_Signal_Date__c === 'string' ? raw.Last_Signal_Date__c : undefined,
        signalCount: typeof raw.Signal_Count__c === 'number' ? raw.Signal_Count__c : undefined,
      };
    }

    // HubSpot
    const props = (raw.properties ?? {}) as Record<string, unknown>;
    return {
      externalId: String(raw.id ?? ''),
      name: String(props.name ?? ''),
      domain: typeof props.domain === 'string' ? props.domain : undefined,
      industry: typeof props.industry === 'string' ? props.industry : undefined,
      employeeCount: typeof props.numberofemployees === 'number' ? props.numberofemployees : undefined,
      accountHealthScore: typeof props.account_health_score === 'number' ? props.account_health_score : undefined,
      propensityScore: typeof props.propensity_score === 'number' ? props.propensity_score : undefined,
      lifecycleStage: typeof props.lifecyclestage === 'string' ? props.lifecyclestage : undefined,
      buyingWindow: typeof props.buying_window === 'string' ? props.buying_window : undefined,
      lastSignalDate: typeof props.last_signal_date === 'string' ? props.last_signal_date : undefined,
      signalCount: typeof props.signal_count === 'number' ? props.signal_count : undefined,
    };
  }

  private mapActivityTypeToSalesforce(type: CRMActivity['type']): string {
    switch (type) {
      case 'signal_detected': return 'Signal Detection';
      case 'outreach_sent': return 'Outreach';
      case 'intel_generated': return 'Intelligence Report';
      case 'score_changed': return 'Score Update';
      default: return 'Other';
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

export const crmSync = new CRMSync();
