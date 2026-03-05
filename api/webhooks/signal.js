/**
 * Signal Webhook Endpoint — Vercel Edge Function
 *
 * Manages webhook subscriptions for signal alerts and dispatches
 * notifications when signal conditions are met.
 *
 * POST /api/webhooks/signal       — Create a subscription
 * GET  /api/webhooks/signal?list=true — List active subscriptions
 * DELETE /api/webhooks/signal?id=xxx  — Remove a subscription
 *
 * POST body for subscription:
 * {
 *   "callbackUrl": "https://...",
 *   "signalTypes": ["funding_event", "executive_movement"],
 *   "minIntentScore": 80,
 *   "companies": ["Acme Corp"]
 * }
 *
 * Note: In-memory storage is illustrative. Production would use Upstash Redis
 * or similar persistent edge-compatible store.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';
import { checkRateLimit } from '../_rate-limit.js';

export const config = { runtime: 'edge' };

// ---------------------------------------------------------------------------
// In-memory subscription store (illustrative — edge functions are stateless)
// ---------------------------------------------------------------------------

const VALID_SIGNAL_TYPES = [
  'funding_event',
  'executive_movement',
  'hiring_surge',
  'expansion_signal',
  'technology_adoption',
  'financial_trigger',
  'press_release',
];

/** @type {Map<string, import('./signal').WebhookSubscription>} */
const subscriptions = new Map();

/**
 * @typedef {Object} WebhookSubscription
 * @property {string} id
 * @property {string} callbackUrl
 * @property {string[]} signalTypes
 * @property {number} minIntentScore
 * @property {string[]} companies
 * @property {string} createdAt
 * @property {number} deliveryCount
 * @property {string|null} lastDeliveredAt
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `wh_${timestamp}_${random}`;
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function validateSubscriptionBody(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  // callbackUrl — required, must be valid HTTPS URL
  if (!body.callbackUrl || typeof body.callbackUrl !== 'string') {
    errors.push('callbackUrl is required and must be a string');
  } else if (!isValidUrl(body.callbackUrl)) {
    errors.push('callbackUrl must be a valid HTTP or HTTPS URL');
  }

  // signalTypes — required, non-empty array of known types
  if (!Array.isArray(body.signalTypes) || body.signalTypes.length === 0) {
    errors.push('signalTypes must be a non-empty array');
  } else {
    const invalid = body.signalTypes.filter((t) => !VALID_SIGNAL_TYPES.includes(t));
    if (invalid.length > 0) {
      errors.push(`Unknown signal types: ${invalid.join(', ')}. Valid types: ${VALID_SIGNAL_TYPES.join(', ')}`);
    }
  }

  // minIntentScore — optional, 0-100
  if (body.minIntentScore !== undefined) {
    if (typeof body.minIntentScore !== 'number' || body.minIntentScore < 0 || body.minIntentScore > 100) {
      errors.push('minIntentScore must be a number between 0 and 100');
    }
  }

  // companies — optional, array of strings
  if (body.companies !== undefined) {
    if (!Array.isArray(body.companies) || body.companies.some((c) => typeof c !== 'string')) {
      errors.push('companies must be an array of strings');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

function handleListSubscriptions(cors) {
  const list = Array.from(subscriptions.values()).map((sub) => ({
    id: sub.id,
    callbackUrl: sub.callbackUrl,
    signalTypes: sub.signalTypes,
    minIntentScore: sub.minIntentScore,
    companies: sub.companies,
    createdAt: sub.createdAt,
    deliveryCount: sub.deliveryCount,
    lastDeliveredAt: sub.lastDeliveredAt,
  }));

  return new Response(JSON.stringify({ subscriptions: list, count: list.length }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function handleDeleteSubscription(subscriptionId, cors) {
  if (!subscriptionId || typeof subscriptionId !== 'string') {
    return new Response(JSON.stringify({ error: 'Provide ?id= parameter to delete a subscription' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const existed = subscriptions.delete(subscriptionId);

  if (!existed) {
    return new Response(JSON.stringify({ error: `Subscription "${subscriptionId}" not found` }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ deleted: true, id: subscriptionId }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function handleCreateSubscription(req, cors) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const validation = validateSubscriptionBody(body);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: validation.errors }), {
      status: 422,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Check for duplicate callbackUrl
  for (const sub of subscriptions.values()) {
    if (sub.callbackUrl === body.callbackUrl) {
      return new Response(JSON.stringify({
        error: 'A subscription with this callbackUrl already exists',
        existingId: sub.id,
      }), {
        status: 409,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  // Enforce subscription limit
  if (subscriptions.size >= 100) {
    return new Response(JSON.stringify({ error: 'Maximum subscription limit (100) reached' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const subscription = {
    id: generateId(),
    callbackUrl: body.callbackUrl,
    signalTypes: body.signalTypes,
    minIntentScore: typeof body.minIntentScore === 'number' ? body.minIntentScore : 0,
    companies: Array.isArray(body.companies) ? body.companies : [],
    createdAt: new Date().toISOString(),
    deliveryCount: 0,
    lastDeliveredAt: null,
  };

  subscriptions.set(subscription.id, subscription);

  return new Response(JSON.stringify({
    created: true,
    subscription: {
      id: subscription.id,
      callbackUrl: subscription.callbackUrl,
      signalTypes: subscription.signalTypes,
      minIntentScore: subscription.minIntentScore,
      companies: subscription.companies,
      createdAt: subscription.createdAt,
    },
  }), {
    status: 201,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, POST, DELETE, OPTIONS');

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Origin check
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting
  const rateLimited = await checkRateLimit(req, cors);
  if (rateLimited) return rateLimited;

  const url = new URL(req.url);

  // GET — list subscriptions
  if (req.method === 'GET') {
    const listParam = url.searchParams.get('list');
    if (listParam === 'true') {
      return handleListSubscriptions(cors);
    }

    return new Response(JSON.stringify({
      endpoint: '/api/webhooks/signal',
      methods: {
        POST: 'Create a webhook subscription',
        'GET?list=true': 'List active subscriptions',
        'DELETE?id=xxx': 'Remove a subscription',
      },
      validSignalTypes: VALID_SIGNAL_TYPES,
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // DELETE — remove subscription
  if (req.method === 'DELETE') {
    const subscriptionId = url.searchParams.get('id');
    return handleDeleteSubscription(subscriptionId, cors);
  }

  // POST — create subscription
  if (req.method === 'POST') {
    return handleCreateSubscription(req, cors);
  }

  // Method not allowed
  return new Response(JSON.stringify({ error: `Method ${req.method} not allowed` }), {
    status: 405,
    headers: { ...cors, 'Content-Type': 'application/json', 'Allow': 'GET, POST, DELETE, OPTIONS' },
  });
}
