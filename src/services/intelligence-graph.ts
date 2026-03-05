/**
 * Intelligence Graph Service
 *
 * Client-side knowledge graph that maps relationships between entities
 * extracted from commercial signals. Supports graph traversal, warm-intro
 * path finding, ecosystem mapping, and displacement opportunity detection.
 *
 * Persists to IndexedDB via the shared persistent-cache layer with
 * debounced auto-save after every mutation.
 */

import type { CompanySignal } from './signal-aggregator';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = 'company' | 'person' | 'technology' | 'event' | 'industry' | 'investor';

export type RelationshipType =
  | 'employs'
  | 'employed_by'
  | 'invested_in'
  | 'portfolio_of'
  | 'competes_with'
  | 'partners_with'
  | 'uses_technology'
  | 'previously_at'
  | 'board_member_of'
  | 'acquired'
  | 'triggered_by';

export interface GraphEntity {
  id: string;
  type: EntityType;
  name: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
  weight: number; // 0-1 strength
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface GraphStats {
  nodeCountByType: Record<EntityType, number>;
  edgeCountByRelationship: Record<RelationshipType, number>;
  totalNodes: number;
  totalEdges: number;
  mostConnectedEntities: Array<{ entity: GraphEntity; edgeCount: number }>;
}

export interface CompanyEcosystem {
  company: GraphEntity;
  employees: GraphEntity[];
  technologies: GraphEntity[];
  investors: GraphEntity[];
  competitors: GraphEntity[];
  partners: GraphEntity[];
  events: GraphEntity[];
}

interface SerializedGraphState {
  entities: Array<[string, GraphEntity]>;
  edges: Array<[string, GraphEdge]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = 'intelligence-graph-v1';
const DEBOUNCE_MS = 2_000;

const ALL_ENTITY_TYPES: readonly EntityType[] = [
  'company', 'person', 'technology', 'event', 'industry', 'investor',
] as const;

const ALL_RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'employs', 'employed_by', 'invested_in', 'portfolio_of',
  'competes_with', 'partners_with', 'uses_technology', 'previously_at',
  'board_member_of', 'acquired', 'triggered_by',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic entity ID from type + normalized name. */
function generateEntityId(type: EntityType, name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  return `${type}:${normalized}`;
}

/** Deterministic edge ID from source, target, and relationship type. */
function generateEdgeId(sourceId: string, targetId: string, relationship: RelationshipType): string {
  return `edge:${sourceId}--${relationship}--${targetId}`;
}

/** Simple title-case helper for display names derived from signal text. */
function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Signal Parsing Utilities
// ---------------------------------------------------------------------------

/**
 * Known technology keywords used to extract technology entities from free text.
 * Kept intentionally broad for a sales-intelligence context.
 */
const TECHNOLOGY_KEYWORDS: ReadonlySet<string> = new Set([
  'kubernetes', 'docker', 'aws', 'azure', 'gcp', 'snowflake', 'databricks',
  'salesforce', 'hubspot', 'slack', 'jira', 'confluence', 'notion',
  'datadog', 'splunk', 'elasticsearch', 'kafka', 'redis', 'postgresql',
  'mongodb', 'terraform', 'ansible', 'jenkins', 'github', 'gitlab',
  'react', 'angular', 'vue', 'next.js', 'vercel', 'supabase',
  'stripe', 'twilio', 'segment', 'amplitude', 'mixpanel', 'looker',
  'tableau', 'power bi', 'sap', 'oracle', 'workday', 'servicenow',
  'zendesk', 'intercom', 'pagerduty', 'okta', 'auth0', 'cloudflare',
  'fastly', 'akamai', 'figma', 'linear', 'asana', 'monday.com',
]);

interface ParsedSignalEntities {
  companies: string[];
  people: string[];
  technologies: string[];
}

function parseSignalText(signal: CompanySignal): ParsedSignalEntities {
  const companies: string[] = [];
  const people: string[] = [];
  const technologies: string[] = [];

  // The signal's own company is always an entity
  if (signal.company) {
    companies.push(signal.company.trim());
  }

  // People from the signal's people field
  if (signal.people) {
    for (const person of signal.people) {
      const trimmed = person.trim();
      if (trimmed.length > 0) {
        people.push(trimmed);
      }
    }
  }

  // Combine text fields for scanning
  const text = [signal.title, signal.summary ?? ''].join(' ').toLowerCase();

  // Technology extraction
  for (const tech of TECHNOLOGY_KEYWORDS) {
    if (text.includes(tech.toLowerCase())) {
      technologies.push(titleCase(tech));
    }
  }

  // Extract company names from common signal patterns
  const acquiredMatch = text.match(/(?:acquires?|acquired|acquisition of)\s+([A-Z][A-Za-z0-9\s&.]+)/i);
  if (acquiredMatch?.[1]) {
    const name = acquiredMatch[1].trim().replace(/\s+(for|in|to|at).*$/i, '');
    if (name.length > 1 && name.toLowerCase() !== signal.company.toLowerCase()) {
      companies.push(name);
    }
  }

  const partnerMatch = text.match(/(?:partners? with|partnership with|partnering with)\s+([A-Z][A-Za-z0-9\s&.]+)/i);
  if (partnerMatch?.[1]) {
    const name = partnerMatch[1].trim().replace(/\s+(for|in|to|at).*$/i, '');
    if (name.length > 1 && name.toLowerCase() !== signal.company.toLowerCase()) {
      companies.push(name);
    }
  }

  const investorMatch = text.match(/(?:led by|from|backed by)\s+([A-Z][A-Za-z0-9\s&.]+)/i);
  if (investorMatch?.[1] && signal.type === 'funding_event') {
    const name = investorMatch[1].trim().replace(/\s+(for|in|to|at|and).*$/i, '');
    if (name.length > 1) {
      companies.push(name);
    }
  }

  return { companies, people, technologies };
}

// ---------------------------------------------------------------------------
// IntelligenceGraph
// ---------------------------------------------------------------------------

class IntelligenceGraph {
  private entities: Map<string, GraphEntity> = new Map();
  private edges: Map<string, GraphEdge> = new Map();

  /** Adjacency index: entityId -> Set<edgeId> */
  private adjacency: Map<string, Set<string>> = new Map();

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ── Initialization ──────────────────────────────────────────────────────

  /** Ensure the graph state has been loaded from persistence. */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadFromPersistence();
    await this.initPromise;
    this.initialized = true;
  }

  private async loadFromPersistence(): Promise<void> {
    try {
      const envelope = await getPersistentCache<SerializedGraphState>(CACHE_KEY);
      if (!envelope?.data) return;

      const { entities, edges } = envelope.data;
      this.entities = new Map(entities);
      this.edges = new Map(edges);
      this.rebuildAdjacency();
    } catch (err) {
      console.warn('[intelligence-graph] Failed to load persisted state:', err);
    }
  }

  private rebuildAdjacency(): void {
    this.adjacency.clear();
    for (const edge of this.edges.values()) {
      this.indexEdge(edge);
    }
  }

  private indexEdge(edge: GraphEdge): void {
    if (!this.adjacency.has(edge.sourceId)) {
      this.adjacency.set(edge.sourceId, new Set());
    }
    this.adjacency.get(edge.sourceId)!.add(edge.id);

    if (!this.adjacency.has(edge.targetId)) {
      this.adjacency.set(edge.targetId, new Set());
    }
    this.adjacency.get(edge.targetId)!.add(edge.id);
  }

  private unindexEdge(edge: GraphEdge): void {
    this.adjacency.get(edge.sourceId)?.delete(edge.id);
    this.adjacency.get(edge.targetId)?.delete(edge.id);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist().catch(err =>
        console.warn('[intelligence-graph] Persist failed:', err),
      );
    }, DEBOUNCE_MS);
  }

  private async persist(): Promise<void> {
    const state: SerializedGraphState = {
      entities: Array.from(this.entities.entries()),
      edges: Array.from(this.edges.entries()),
    };
    await setPersistentCache(CACHE_KEY, state);
  }

  /** Force an immediate save (useful before page unload). */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
  }

  // ── Core Operations ─────────────────────────────────────────────────────

  /**
   * Add or merge an entity node. If an entity with the same ID already
   * exists, its attributes are shallow-merged and updatedAt is refreshed.
   */
  addEntity(entity: Omit<GraphEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): GraphEntity {
    const now = Date.now();
    const id = entity.id ?? generateEntityId(entity.type, entity.name);

    const existing = this.entities.get(id);
    if (existing) {
      const merged: GraphEntity = {
        ...existing,
        attributes: { ...existing.attributes, ...entity.attributes },
        updatedAt: now,
      };
      // Update name if a better (non-lowered) version arrives
      if (entity.name && entity.name !== existing.name) {
        merged.name = entity.name;
      }
      this.entities.set(id, merged);
      this.scheduleSave();
      return merged;
    }

    const newEntity: GraphEntity = {
      id,
      type: entity.type,
      name: entity.name,
      attributes: { ...entity.attributes },
      createdAt: now,
      updatedAt: now,
    };
    this.entities.set(id, newEntity);
    this.scheduleSave();
    return newEntity;
  }

  /**
   * Add a relationship edge. If an edge with the same deterministic ID
   * already exists it is updated (weight, metadata refreshed).
   */
  addEdge(
    edge: Omit<GraphEdge, 'id' | 'createdAt'> & { id?: string },
  ): GraphEdge {
    const now = Date.now();
    const id = edge.id ?? generateEdgeId(edge.sourceId, edge.targetId, edge.relationship);

    const existing = this.edges.get(id);
    if (existing) {
      const updated: GraphEdge = {
        ...existing,
        weight: Math.max(existing.weight, edge.weight),
        metadata: { ...existing.metadata, ...edge.metadata },
        createdAt: existing.createdAt,
      };
      this.edges.set(id, updated);
      this.scheduleSave();
      return updated;
    }

    const newEdge: GraphEdge = {
      id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relationship: edge.relationship,
      weight: Math.max(0, Math.min(1, edge.weight)),
      metadata: { ...edge.metadata },
      createdAt: now,
    };
    this.edges.set(id, newEdge);
    this.indexEdge(newEdge);
    this.scheduleSave();
    return newEdge;
  }

  /** Retrieve an entity by ID. */
  getEntity(id: string): GraphEntity | undefined {
    return this.entities.get(id);
  }

  /** Search entities by type and optional name substring match. */
  findEntities(type: EntityType, query?: string): GraphEntity[] {
    const results: GraphEntity[] = [];
    const lowerQuery = query?.toLowerCase();

    for (const entity of this.entities.values()) {
      if (entity.type !== type) continue;
      if (lowerQuery && !entity.name.toLowerCase().includes(lowerQuery)) continue;
      results.push(entity);
    }

    return results;
  }

  /**
   * Get all edges connected to an entity (as source or target),
   * optionally filtered by relationship type.
   */
  getEdges(entityId: string, relationship?: RelationshipType): GraphEdge[] {
    const edgeIds = this.adjacency.get(entityId);
    if (!edgeIds) return [];

    const results: GraphEdge[] = [];
    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      if (relationship && edge.relationship !== relationship) continue;
      results.push(edge);
    }

    return results;
  }

  /**
   * BFS traversal to find all entities connected within N hops.
   * Returns entities (excluding the start node) with their hop distance.
   */
  getConnectedEntities(
    entityId: string,
    depth = 2,
  ): Array<{ entity: GraphEntity; distance: number }> {
    const visited = new Map<string, number>(); // entityId -> distance
    visited.set(entityId, 0);

    const queue: Array<{ id: string; dist: number }> = [{ id: entityId, dist: 0 }];
    const results: Array<{ entity: GraphEntity; distance: number }> = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.dist >= depth) continue;

      const edgeIds = this.adjacency.get(current.id);
      if (!edgeIds) continue;

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const neighborId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
        if (visited.has(neighborId)) continue;

        const nextDist = current.dist + 1;
        visited.set(neighborId, nextDist);

        const neighbor = this.entities.get(neighborId);
        if (neighbor) {
          results.push({ entity: neighbor, distance: nextDist });
          queue.push({ id: neighborId, dist: nextDist });
        }
      }
    }

    return results;
  }

  /** Remove an entity and all of its connected edges. */
  removeEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;

    // Remove all connected edges first
    const edgeIds = this.adjacency.get(id);
    if (edgeIds) {
      for (const edgeId of Array.from(edgeIds)) {
        this.removeEdge(edgeId);
      }
    }

    this.entities.delete(id);
    this.adjacency.delete(id);
    this.scheduleSave();
    return true;
  }

  /** Remove a single edge. */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    this.unindexEdge(edge);
    this.edges.delete(id);
    this.scheduleSave();
    return true;
  }

  // ── Graph Queries ───────────────────────────────────────────────────────

  /**
   * Find the shortest path of "previously_at" relationships between two
   * companies. Returns the chain of people who bridge the gap, or null
   * if no path exists.
   */
  findWarmIntroPath(
    fromCompanyId: string,
    toCompanyId: string,
  ): Array<{ entity: GraphEntity; relationship: RelationshipType }> | null {
    // BFS from fromCompany, only traversing employs/employed_by/previously_at edges
    const TRAVERSABLE: ReadonlySet<RelationshipType> = new Set([
      'employs', 'employed_by', 'previously_at',
    ]);

    const visited = new Set<string>([fromCompanyId]);
    const parent = new Map<string, { entityId: string; relationship: RelationshipType }>();

    const queue: string[] = [fromCompanyId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (currentId === toCompanyId) {
        // Reconstruct path
        const path: Array<{ entity: GraphEntity; relationship: RelationshipType }> = [];
        let cursor = toCompanyId;
        while (parent.has(cursor)) {
          const p = parent.get(cursor)!;
          const entity = this.entities.get(cursor);
          if (entity) {
            path.unshift({ entity, relationship: p.relationship });
          }
          cursor = p.entityId;
        }
        return path;
      }

      const edgeIds = this.adjacency.get(currentId);
      if (!edgeIds) continue;

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        if (!TRAVERSABLE.has(edge.relationship)) continue;

        const neighborId = edge.sourceId === currentId ? edge.targetId : edge.sourceId;
        if (visited.has(neighborId)) continue;

        visited.add(neighborId);
        parent.set(neighborId, { entityId: currentId, relationship: edge.relationship });
        queue.push(neighborId);
      }
    }

    return null;
  }

  /** Find entities connected to both entityA and entityB. */
  findSharedConnections(entityAId: string, entityBId: string): GraphEntity[] {
    const neighborsA = this.getNeighborIds(entityAId);
    const neighborsB = this.getNeighborIds(entityBId);

    const shared: GraphEntity[] = [];
    for (const id of neighborsA) {
      if (id === entityAId || id === entityBId) continue;
      if (neighborsB.has(id)) {
        const entity = this.entities.get(id);
        if (entity) shared.push(entity);
      }
    }

    return shared;
  }

  /** Get direct competitors via 'competes_with' edges. */
  findCompetitors(companyId: string): GraphEntity[] {
    return this.getEdges(companyId, 'competes_with')
      .map(edge => {
        const otherId = edge.sourceId === companyId ? edge.targetId : edge.sourceId;
        return this.entities.get(otherId);
      })
      .filter((e): e is GraphEntity => e !== undefined);
  }

  /** Find companies that share an investor with the given company. */
  findPortfolioSiblings(companyId: string): GraphEntity[] {
    // Step 1: find investors of this company
    const investorEdges = this.getEdges(companyId, 'portfolio_of');
    const investedInEdges = this.getEdges(companyId, 'invested_in');

    const investorIds = new Set<string>();
    for (const edge of investorEdges) {
      const investorId = edge.sourceId === companyId ? edge.targetId : edge.sourceId;
      investorIds.add(investorId);
    }
    for (const edge of investedInEdges) {
      const investorId = edge.sourceId === companyId ? edge.targetId : edge.sourceId;
      investorIds.add(investorId);
    }

    // Step 2: find other companies in those investors' portfolios
    const siblings = new Map<string, GraphEntity>();
    for (const investorId of investorIds) {
      const portfolioEdges = [
        ...this.getEdges(investorId, 'invested_in'),
        ...this.getEdges(investorId, 'portfolio_of'),
      ];
      for (const edge of portfolioEdges) {
        const siblingId = edge.sourceId === investorId ? edge.targetId : edge.sourceId;
        if (siblingId === companyId) continue;
        const sibling = this.entities.get(siblingId);
        if (sibling && sibling.type === 'company') {
          siblings.set(siblingId, sibling);
        }
      }
    }

    return Array.from(siblings.values());
  }

  /**
   * Find companies using a competitor's technology where we might displace.
   * Returns companies connected to the competitor via 'uses_technology' edges
   * on technologies the competitor is associated with.
   */
  findDisplacementOpportunities(competitorId: string): GraphEntity[] {
    // Find technologies the competitor is associated with
    const techEdges = this.getEdges(competitorId, 'uses_technology');
    const techIds = new Set<string>();
    for (const edge of techEdges) {
      const techId = edge.sourceId === competitorId ? edge.targetId : edge.sourceId;
      techIds.add(techId);
    }

    // Also check if the competitor IS a technology (e.g., "Salesforce" is both company and tech)
    const competitorEntity = this.entities.get(competitorId);
    if (competitorEntity) {
      // Find all companies that use the competitor as a technology
      const userEdges = this.getEdges(competitorId, 'uses_technology');
      const directUsers = new Map<string, GraphEntity>();

      for (const edge of userEdges) {
        const userId = edge.sourceId === competitorId ? edge.targetId : edge.sourceId;
        if (userId === competitorId) continue;
        const user = this.entities.get(userId);
        if (user && user.type === 'company') {
          directUsers.set(userId, user);
        }
      }

      // Also find companies using the same technologies
      for (const techId of techIds) {
        const usersOfTech = this.getEdges(techId, 'uses_technology');
        for (const edge of usersOfTech) {
          const userId = edge.sourceId === techId ? edge.targetId : edge.sourceId;
          if (userId === competitorId) continue;
          const user = this.entities.get(userId);
          if (user && user.type === 'company') {
            directUsers.set(userId, user);
          }
        }
      }

      return Array.from(directUsers.values());
    }

    return [];
  }

  /** All entities reachable in exactly 2 hops (not 1). */
  getSecondDegreeConnections(entityId: string): GraphEntity[] {
    const firstDegree = this.getNeighborIds(entityId);
    const secondDegree = new Map<string, GraphEntity>();

    for (const firstId of firstDegree) {
      const neighbors = this.getNeighborIds(firstId);
      for (const secondId of neighbors) {
        if (secondId === entityId || firstDegree.has(secondId)) continue;
        const entity = this.entities.get(secondId);
        if (entity) {
          secondDegree.set(secondId, entity);
        }
      }
    }

    return Array.from(secondDegree.values());
  }

  /** Build the full ecosystem view around a company. */
  buildCompanyEcosystem(companyId: string): CompanyEcosystem | null {
    const company = this.entities.get(companyId);
    if (!company) return null;

    const employees: GraphEntity[] = [];
    const technologies: GraphEntity[] = [];
    const investors: GraphEntity[] = [];
    const competitors: GraphEntity[] = [];
    const partners: GraphEntity[] = [];
    const events: GraphEntity[] = [];

    const edgeIds = this.adjacency.get(companyId);
    if (!edgeIds) {
      return { company, employees, technologies, investors, competitors, partners, events };
    }

    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;

      const otherId = edge.sourceId === companyId ? edge.targetId : edge.sourceId;
      const other = this.entities.get(otherId);
      if (!other) continue;

      switch (edge.relationship) {
        case 'employs':
        case 'employed_by':
          if (other.type === 'person') employees.push(other);
          break;
        case 'uses_technology':
          if (other.type === 'technology') technologies.push(other);
          break;
        case 'invested_in':
        case 'portfolio_of':
          if (other.type === 'investor' || other.type === 'company') investors.push(other);
          break;
        case 'competes_with':
          competitors.push(other);
          break;
        case 'partners_with':
          partners.push(other);
          break;
        case 'triggered_by':
          if (other.type === 'event') events.push(other);
          break;
        case 'previously_at':
          if (other.type === 'person') employees.push(other);
          break;
        case 'board_member_of':
          if (other.type === 'person') employees.push(other);
          break;
        case 'acquired':
          if (other.type === 'company') partners.push(other);
          break;
      }
    }

    return { company, employees, technologies, investors, competitors, partners, events };
  }

  // ── Signal Integration ──────────────────────────────────────────────────

  /**
   * Extract entities from a CompanySignal and add nodes + edges.
   * Parses company names, people, and technology keywords from
   * signal title/summary fields.
   */
  ingestSignal(signal: CompanySignal): void {
    const parsed = parseSignalText(signal);

    // Primary company entity
    const primaryCompany = this.addEntity({
      type: 'company',
      name: signal.company,
      attributes: {
        domain: signal.companyDomain,
        lastSignalType: signal.type,
        lastSignalStrength: signal.strength,
      },
    });

    // Create event entity for the signal itself
    const eventEntity = this.addEntity({
      type: 'event',
      name: signal.title,
      attributes: {
        signalType: signal.type,
        summary: signal.summary,
        source: signal.source,
        sourceTier: signal.sourceTier,
        signalScore: signal.signalScore,
        timestamp: signal.timestamp instanceof Date ? signal.timestamp.toISOString() : signal.timestamp,
      },
    });

    // Link event to company
    this.addEdge({
      sourceId: primaryCompany.id,
      targetId: eventEntity.id,
      relationship: 'triggered_by',
      weight: signal.signalScore / 100,
      metadata: { signalType: signal.type },
    });

    // People entities
    for (const personName of parsed.people) {
      const person = this.addEntity({
        type: 'person',
        name: personName,
        attributes: {
          company: signal.company,
          jobTitle: signal.jobTitle,
        },
      });

      const relationship: RelationshipType =
        signal.type === 'executive_movement' ? 'previously_at' : 'employed_by';

      this.addEdge({
        sourceId: person.id,
        targetId: primaryCompany.id,
        relationship,
        weight: signal.strength === 'critical' ? 0.95 : signal.strength === 'high' ? 0.8 : 0.6,
        metadata: { signalType: signal.type },
      });

      // Reciprocal edge
      this.addEdge({
        sourceId: primaryCompany.id,
        targetId: person.id,
        relationship: 'employs',
        weight: signal.strength === 'critical' ? 0.95 : signal.strength === 'high' ? 0.8 : 0.6,
        metadata: { signalType: signal.type },
      });
    }

    // Technology entities
    for (const techName of parsed.technologies) {
      const tech = this.addEntity({
        type: 'technology',
        name: techName,
        attributes: {},
      });

      this.addEdge({
        sourceId: primaryCompany.id,
        targetId: tech.id,
        relationship: 'uses_technology',
        weight: 0.7,
        metadata: { detectedFrom: 'signal_text' },
      });
    }

    // Secondary companies (acquisitions, partners, investors)
    for (const companyName of parsed.companies) {
      if (companyName.toLowerCase() === signal.company.toLowerCase()) continue;

      const secondaryCompany = this.addEntity({
        type: signal.type === 'funding_event' ? 'investor' : 'company',
        name: companyName,
        attributes: {},
      });

      let relationship: RelationshipType;
      let weight: number;

      switch (signal.type) {
        case 'funding_event':
          relationship = 'invested_in';
          weight = 0.9;
          // Also create portfolio edge
          this.addEdge({
            sourceId: primaryCompany.id,
            targetId: secondaryCompany.id,
            relationship: 'portfolio_of',
            weight: 0.9,
            metadata: {
              fundingAmount: signal.fundingAmount,
              signalType: signal.type,
            },
          });
          break;
        case 'expansion_signal':
          relationship = 'partners_with';
          weight = 0.6;
          break;
        default:
          relationship = 'partners_with';
          weight = 0.5;
          break;
      }

      this.addEdge({
        sourceId: secondaryCompany.id,
        targetId: primaryCompany.id,
        relationship,
        weight,
        metadata: { signalType: signal.type },
      });
    }
  }

  /** Batch-ingest multiple signals. */
  ingestBulkSignals(signals: CompanySignal[]): void {
    for (const signal of signals) {
      this.ingestSignal(signal);
    }
  }

  // ── Analytics ───────────────────────────────────────────────────────────

  /** Aggregate statistics about the current graph state. */
  getGraphStats(): GraphStats {
    const nodeCountByType = {} as Record<EntityType, number>;
    for (const t of ALL_ENTITY_TYPES) nodeCountByType[t] = 0;
    for (const entity of this.entities.values()) {
      nodeCountByType[entity.type]++;
    }

    const edgeCountByRelationship = {} as Record<RelationshipType, number>;
    for (const r of ALL_RELATIONSHIP_TYPES) edgeCountByRelationship[r] = 0;
    for (const edge of this.edges.values()) {
      edgeCountByRelationship[edge.relationship]++;
    }

    const mostConnected = this.getMostConnectedEntities(undefined, 10);

    return {
      nodeCountByType,
      edgeCountByRelationship,
      totalNodes: this.entities.size,
      totalEdges: this.edges.size,
      mostConnectedEntities: mostConnected,
    };
  }

  /** Entities with the most edges, optionally filtered by type. */
  getMostConnectedEntities(
    type?: EntityType,
    limit = 10,
  ): Array<{ entity: GraphEntity; edgeCount: number }> {
    const counts: Array<{ entity: GraphEntity; edgeCount: number }> = [];

    for (const [entityId, edgeIds] of this.adjacency) {
      const entity = this.entities.get(entityId);
      if (!entity) continue;
      if (type && entity.type !== type) continue;
      counts.push({ entity, edgeCount: edgeIds.size });
    }

    counts.sort((a, b) => b.edgeCount - a.edgeCount);
    return counts.slice(0, limit);
  }

  /** Most recently updated entities. */
  getRecentlyUpdated(limit = 20): GraphEntity[] {
    return Array.from(this.entities.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  // ── Internal Helpers ────────────────────────────────────────────────────

  /** Get the set of neighbor entity IDs for a given entity. */
  private getNeighborIds(entityId: string): Set<string> {
    const neighbors = new Set<string>();
    const edgeIds = this.adjacency.get(entityId);
    if (!edgeIds) return neighbors;

    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      const otherId = edge.sourceId === entityId ? edge.targetId : edge.sourceId;
      neighbors.add(otherId);
    }

    return neighbors;
  }

  /** Clear the entire graph (useful for testing). */
  clear(): void {
    this.entities.clear();
    this.edges.clear();
    this.adjacency.clear();
    this.scheduleSave();
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

export const intelligenceGraph = new IntelligenceGraph();
