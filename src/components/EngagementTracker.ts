/**
 * Engagement Tracker — Email sequence timeline, touch history, and response tracking
 * Vanilla TypeScript DOM component.
 */

const STYLE_ID = 'salesintel-engagement-styles';

export interface SequenceOverview {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  totalEnrolled: number;
  active: number;
  replied: number;
  openRate: number;
  replyRate: number;
  steps: number;
}

export interface TouchEvent {
  id: string;
  type: 'email_sent' | 'email_opened' | 'email_clicked' | 'email_replied' | 'email_bounced' | 'call' | 'meeting' | 'note' | 'signal';
  contact: string;
  company: string;
  description: string;
  timestamp: Date;
  sequenceName?: string;
  stepNumber?: number;
}

const STYLES = `
  .si-engagement {
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #e2e8f0;
    padding: 24px;
  }

  .si-engagement-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
  }

  .si-engagement-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  /* ---- Sequence Cards Grid ---- */

  .si-sequences-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }

  .si-sequence-card {
    background: #0f172a;
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .si-sequence-card:hover {
    border-color: #334155;
    transform: translateY(-1px);
  }

  .si-sequence-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .si-sequence-name {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .si-sequence-status {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 100px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .si-sequence-status--active {
    background: rgba(16, 185, 129, 0.12);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.2);
  }

  .si-sequence-status--paused {
    background: rgba(234, 179, 8, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(234, 179, 8, 0.2);
  }

  .si-sequence-status--draft {
    background: rgba(107, 114, 128, 0.12);
    color: #9ca3af;
    border: 1px solid rgba(107, 114, 128, 0.2);
  }

  .si-sequence-status--completed {
    background: rgba(59, 130, 246, 0.12);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.2);
  }

  .si-sequence-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .si-sequence-stat {
    text-align: center;
  }

  .si-sequence-stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #e2e8f0;
  }

  .si-sequence-stat-label {
    font-size: 10px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .si-sequence-rates {
    display: flex;
    gap: 16px;
    padding-top: 12px;
    border-top: 1px solid #1E293B;
  }

  .si-sequence-rate {
    font-size: 12px;
    color: #94a3b8;
  }

  .si-sequence-rate strong {
    color: #e2e8f0;
  }

  /* ---- Step Funnel ---- */

  .si-funnel {
    margin-bottom: 32px;
  }

  .si-funnel-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 16px;
  }

  .si-funnel-steps {
    display: flex;
    gap: 2px;
    align-items: flex-end;
    height: 120px;
  }

  .si-funnel-step {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .si-funnel-bar {
    width: 100%;
    max-width: 60px;
    border-radius: 4px 4px 0 0;
    transition: height 0.5s ease;
  }

  .si-funnel-label {
    font-size: 10px;
    color: #64748b;
    text-align: center;
  }

  .si-funnel-value {
    font-size: 11px;
    font-weight: 600;
    color: #e2e8f0;
  }

  /* ---- Activity Timeline ---- */

  .si-timeline {
    margin-bottom: 24px;
  }

  .si-timeline-title {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 16px;
  }

  .si-timeline-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
  }

  .si-timeline-list::before {
    content: '';
    position: absolute;
    left: 15px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: #1E293B;
  }

  .si-timeline-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 8px 0;
    position: relative;
  }

  .si-timeline-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 4px;
    position: relative;
    z-index: 1;
    border: 2px solid #0A0F1C;
    box-sizing: content-box;
  }

  .si-timeline-content {
    flex: 1;
    min-width: 0;
  }

  .si-timeline-desc {
    font-size: 13px;
    color: #e2e8f0;
    margin-bottom: 2px;
  }

  .si-timeline-meta {
    font-size: 11px;
    color: #64748b;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .si-timeline-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
  }

  /* ---- Empty State ---- */

  .si-engagement-empty {
    text-align: center;
    padding: 48px 24px;
    color: #475569;
  }

  .si-engagement-empty h3 {
    font-size: 16px;
    color: #94a3b8;
    margin-bottom: 8px;
  }

  .si-engagement-empty p {
    font-size: 13px;
    max-width: 400px;
    margin: 0 auto;
  }

  /* ---- Responsive ---- */

  @media (max-width: 768px) {
    .si-engagement {
      padding: 16px;
    }

    .si-sequences-grid {
      grid-template-columns: 1fr;
    }
  }
`;

const TOUCH_COLORS: Record<TouchEvent['type'], string> = {
  email_sent: '#3b82f6',
  email_opened: '#10b981',
  email_clicked: '#8b5cf6',
  email_replied: '#f59e0b',
  email_bounced: '#ef4444',
  call: '#06b6d4',
  meeting: '#ec4899',
  note: '#6b7280',
  signal: '#f97316',
};

const TOUCH_LABELS: Record<TouchEvent['type'], string> = {
  email_sent: 'Sent',
  email_opened: 'Opened',
  email_clicked: 'Clicked',
  email_replied: 'Replied',
  email_bounced: 'Bounced',
  call: 'Call',
  meeting: 'Meeting',
  note: 'Note',
  signal: 'Signal',
};

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Sequences and touches loaded dynamically from email-sequences service
const INITIAL_SEQUENCES: SequenceOverview[] = [];
const INITIAL_TOUCHES: TouchEvent[] = [];

export class EngagementTracker {
  private root: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private sequences: SequenceOverview[] = INITIAL_SEQUENCES;
  private touches: TouchEvent[] = INITIAL_TOUCHES;
  private onSequenceClick: ((id: string) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'si-engagement';
    this.injectStyles();
    this.buildUI();
  }

  public onSequenceSelect(callback: (id: string) => void): void {
    this.onSequenceClick = callback;
  }

  public setSequences(sequences: SequenceOverview[]): void {
    this.sequences = sequences;
    this.buildUI();
  }

  public setTouches(touches: TouchEvent[]): void {
    this.touches = touches;
    this.buildUI();
  }

  public render(container: HTMLElement): void {
    container.appendChild(this.root);
  }

  public destroy(): void {
    this.root.remove();
    if (this.styleElement?.parentNode) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    this.styleElement = document.createElement('style');
    this.styleElement.id = STYLE_ID;
    this.styleElement.textContent = STYLES;
    document.head.appendChild(this.styleElement);
  }

  private buildUI(): void {
    this.root.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'si-engagement-header';
    header.innerHTML = `
      <h1 class="si-engagement-title">Engagement Tracker</h1>
    `;
    this.root.appendChild(header);

    // Sequence Cards
    this.root.appendChild(this.buildSequenceGrid());

    // Engagement Funnel
    this.root.appendChild(this.buildFunnel());

    // Activity Timeline
    this.root.appendChild(this.buildTimeline());
  }

  private buildSequenceGrid(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'si-sequences-grid';

    for (const seq of this.sequences) {
      const card = document.createElement('div');
      card.className = 'si-sequence-card';
      card.addEventListener('click', () => this.onSequenceClick?.(seq.id));

      card.innerHTML = `
        <div class="si-sequence-card-header">
          <span class="si-sequence-name">${seq.name}</span>
          <span class="si-sequence-status si-sequence-status--${seq.status}">${seq.status}</span>
        </div>
        <div class="si-sequence-stats">
          <div class="si-sequence-stat">
            <div class="si-sequence-stat-value">${seq.totalEnrolled}</div>
            <div class="si-sequence-stat-label">Enrolled</div>
          </div>
          <div class="si-sequence-stat">
            <div class="si-sequence-stat-value">${seq.active}</div>
            <div class="si-sequence-stat-label">Active</div>
          </div>
          <div class="si-sequence-stat">
            <div class="si-sequence-stat-value">${seq.replied}</div>
            <div class="si-sequence-stat-label">Replied</div>
          </div>
        </div>
        <div class="si-sequence-rates">
          <span class="si-sequence-rate">Open: <strong>${seq.openRate}%</strong></span>
          <span class="si-sequence-rate">Reply: <strong>${seq.replyRate}%</strong></span>
          <span class="si-sequence-rate">Steps: <strong>${seq.steps}</strong></span>
        </div>
      `;

      grid.appendChild(card);
    }

    return grid;
  }

  private buildFunnel(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-funnel';

    const title = document.createElement('div');
    title.className = 'si-funnel-title';
    title.textContent = 'Engagement Funnel';
    section.appendChild(title);

    // Aggregate across all active sequences
    const totalSent = this.sequences.reduce((s, seq) => s + seq.totalEnrolled, 0);
    const totalOpened = Math.round(this.sequences.reduce((s, seq) => s + (seq.totalEnrolled * seq.openRate / 100), 0));
    const totalClicked = Math.round(totalOpened * 0.35);
    const totalReplied = this.sequences.reduce((s, seq) => s + seq.replied, 0);
    const totalMeetings = Math.round(totalReplied * 0.4);

    const funnelData = [
      { label: 'Sent', value: totalSent, color: '#3b82f6' },
      { label: 'Opened', value: totalOpened, color: '#10b981' },
      { label: 'Clicked', value: totalClicked, color: '#8b5cf6' },
      { label: 'Replied', value: totalReplied, color: '#f59e0b' },
      { label: 'Meetings', value: totalMeetings, color: '#ec4899' },
    ];

    const maxValue = Math.max(...funnelData.map(d => d.value), 1);

    const steps = document.createElement('div');
    steps.className = 'si-funnel-steps';

    for (const data of funnelData) {
      const step = document.createElement('div');
      step.className = 'si-funnel-step';

      const height = Math.max(8, (data.value / maxValue) * 100);

      step.innerHTML = `
        <div class="si-funnel-value">${data.value}</div>
        <div class="si-funnel-bar" style="height:${height}px;background:${data.color}"></div>
        <div class="si-funnel-label">${data.label}</div>
      `;
      steps.appendChild(step);
    }

    section.appendChild(steps);
    return section;
  }

  private buildTimeline(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'si-timeline';

    const title = document.createElement('div');
    title.className = 'si-timeline-title';
    title.textContent = 'Recent Activity';
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'si-timeline-list';

    for (const touch of this.touches) {
      const item = document.createElement('div');
      item.className = 'si-timeline-item';

      const color = TOUCH_COLORS[touch.type];
      void TOUCH_LABELS[touch.type];

      item.innerHTML = `
        <div class="si-timeline-dot" style="background:${color}"></div>
        <div class="si-timeline-content">
          <div class="si-timeline-desc">${touch.description}</div>
          <div class="si-timeline-meta">
            <span>${touch.contact} at ${touch.company}</span>
            <span>${formatTimeAgo(touch.timestamp)}</span>
            ${touch.sequenceName ? `<span class="si-timeline-badge" style="background:rgba(59,130,246,0.1);color:#60a5fa">${touch.sequenceName} · Step ${touch.stepNumber}</span>` : ''}
          </div>
        </div>
      `;

      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }
}
