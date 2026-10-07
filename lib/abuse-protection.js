// Server-side only: TURNSTILE_SECRET_KEY is a Worker secret. Never send it to
// the browser. Turnstile proves a person (not a script) submitted the pickup
// form; the rate limiter caps how fast any one visitor can call the API.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'pickup-order';

export const turnstileEnabled = (env) => Boolean(env.TURNSTILE_SECRET_KEY);

/* Fails closed: a missing, reused, expired or unverifiable token is rejected. */
export async function verifyTurnstile(env, request, token) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    const result = await response.json();
    return result.success === true && result.action === TURNSTILE_ACTION;
  } catch (error) {
    console.error('Turnstile verification failed', error?.message);
    return false;
  }
}

/* Per-visitor limit from the API_RATE_LIMITER binding in wrangler.jsonc.
   Counters are per Cloudflare location and approximate, which is enough to
   stop a script hammering the endpoints. Without the binding nothing is limited. */
export async function rateLimited(env, request, route) {
  if (!env.API_RATE_LIMITER) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.API_RATE_LIMITER.limit({ key: `${route}:${ip}` });
  return !success;
}
