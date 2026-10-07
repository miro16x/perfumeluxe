// Server-side only: SUPABASE_SERVICE_ROLE_KEY is supplied by the Worker secret
// binding and bypasses row-level security. Never send it to the browser.
// The URL and publishable key below are public (the same values ship in auth.js).
const SUPABASE_URL = 'https://bvffpffnyjfufprcdskb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NGGc4fVDwCVlsInS2NT51g_ymNOYi7w';

const baseUrl = (env) => String(env.SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, '');

export const accountOrdersEnabled = (env) => Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

const serviceHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal'
});

const bearerToken = (request) =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1] || null;

/* Resolve the signed-in customer from the access token the browser sent.
   Supabase validates the token, so a forged or expired one yields null. */
export async function getSignedInUser(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const response = await fetch(`${baseUrl(env)}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

export async function saveAccountOrder(env, userId, order) {
  const response = await fetch(`${baseUrl(env)}/rest/v1/orders`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ user_id: userId, ...order })
  });
  if (!response.ok) throw new Error(`Supabase rejected order save (HTTP ${response.status}).`);
}

/* ── Paid orders (guest and signed-in), written by the Stripe webhook ── */

/* Returns false when the order already exists: Stripe retries webhooks, and
   the unique reference makes the first delivery the only one that records it. */
export async function insertPaidOrder(env, order) {
  const response = await fetch(`${baseUrl(env)}/rest/v1/orders`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(order)
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`Supabase rejected paid order (HTTP ${response.status}).`);
  return true;
}

export async function getOrder(env, reference) {
  const query = `reference=eq.${encodeURIComponent(reference)}&select=reference,email,status,stripe_payment_intent,notified_at,total`;
  const response = await fetch(`${baseUrl(env)}/rest/v1/orders?${query}`, { headers: serviceHeaders(env) });
  if (!response.ok) throw new Error(`Supabase rejected order lookup (HTTP ${response.status}).`);
  const [order] = await response.json();
  return order ?? null;
}

export async function updateOrder(env, reference, fields) {
  const response = await fetch(`${baseUrl(env)}/rest/v1/orders?reference=eq.${encodeURIComponent(reference)}`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify(fields)
  });
  if (!response.ok) throw new Error(`Supabase rejected order update (HTTP ${response.status}).`);
}

/* Matches on reference AND email, the same pair the cancellation request proves. */
export async function markAccountOrderCancelled(env, reference, email) {
  const query = `reference=eq.${encodeURIComponent(reference)}&email=eq.${encodeURIComponent(email.toLowerCase())}`;
  const response = await fetch(`${baseUrl(env)}/rest/v1/orders?${query}`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Supabase rejected order cancellation (HTTP ${response.status}).`);
}
