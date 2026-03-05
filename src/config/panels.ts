import type { PanelConfig } from '@/types';

// SalesIntel panels — single product, no variants
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  dashboard: { name: 'Dashboard', enabled: true, priority: 1 },
  targets: { name: 'My Targets', enabled: true, priority: 1 },
  'signal-alerts': { name: 'Signal Alerts', enabled: true, priority: 1 },
  pipeline: { name: 'Pipeline', enabled: true, priority: 1 },
  prospects: { name: 'Prospects', enabled: true, priority: 1 },
  campaigns: { name: 'Campaigns', enabled: true, priority: 1 },
  analytics: { name: 'Analytics', enabled: true, priority: 1 },
  compete: { name: 'Compete', enabled: true, priority: 2 },
  briefing: { name: 'Morning Briefing', enabled: true, priority: 1 },
  territory: { name: 'Territory', enabled: true, priority: 1 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  intel: { name: 'Signal Feed', enabled: true, priority: 1 },
  settings: { name: 'Settings', enabled: true, priority: 2 },
};

// SalesIntel has no map layers — company/account views instead
export const DEFAULT_MAP_LAYERS = {} as Record<string, boolean>;
export const MOBILE_DEFAULT_MAP_LAYERS = {} as Record<string, boolean>;

// Panel categories for settings UI
export const PANEL_CATEGORY_MAP: Record<string, string> = {
  dashboard: 'Core',
  targets: 'Core',
  'signal-alerts': 'Intelligence',
  pipeline: 'Core',
  prospects: 'Outreach',
  campaigns: 'Outreach',
  analytics: 'Revenue',
  compete: 'Intelligence',
  briefing: 'Intelligence',
  territory: 'Core',
  insights: 'Intelligence',
  intel: 'Intelligence',
  settings: 'System',
};

// Source-to-panel mapping for data freshness
export const LAYER_TO_SOURCE: Record<string, string> = {
  rss: 'rss',
  crunchbase: 'crunchbase',
  linkedin: 'linkedin',
  sec_edgar: 'sec_edgar',
  clearbit: 'clearbit',
};
