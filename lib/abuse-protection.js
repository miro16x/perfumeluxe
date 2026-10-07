// Server-side only: TURNSTILE_SECRET_KEY is a Worker secret. Never send it to
// the browser. Turnstile proves a person (not a script) submitted the pickup
// form; the rate limiter caps how fast any one visitor can call the API.
import { alertOwner } from './alerts.js';

const SITEVERIFY_URL ='https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'pickup-order';
/* The widget is registered for uluxe.site, which covers every subdomain, so
   only accept tokens solved on the storefront itself. */
const TURNSTILE_HOSTNAMES = new Set(['luxeperfume.uluxe.site']);

export const turnstileEnabled = (env) => Boolean(env.TURNSTILE_SECRET_KEY);

/* Codes that mean every order is being blocked, not just a bot. */
const CONFIG_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);
const alertTurnstileProblem = (env, waitUntil, problem) => alertOwner(env, waitUntil, {
  kind: 'turnstile-broken',
  subject: 'Pickup orders are being blocked by the bot check',
  details: `Turnstile could not verify orders: ${problem}\nUntil this is fixed, customers see "We could not verify this request". Check the TURNSTILE_SECRET_KEY Worker secret against the widget's secret key (Cloudflare → Turnstile). To let orders through meanwhile, delete that secret.`
});

/* Fails closed: a missing, reused, expired or unverifiable token is rejected. */
export async function verifyTurnstile(env, request, token, waitUntil) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`siteverify HTTP ${response.status}`);
    const result = await response.json();
    const passed = result.success === true && result.action === TURNSTILE_ACTION &&
      TURNSTILE_HOSTNAMES.has(result.hostname);
    /* error-codes explain a rejection, e.g. invalid-input-secret (wrong secret
       key) or timeout-or-duplicate (expired or reused token). */
    if (!passed) {
      const codes = result['error-codes'] ?? [];
      console.error('Turnstile rejected token', JSON.stringify(codes), 'action:', result.action, 'hostname:', result.hostname);
      const configError = codes.find((code) => CONFIG_ERRORS.has(code));
      if (configError) await alertTurnstileProblem(env, waitUntil, configError);
    }
    return passed;
  } catch (error) {
    console.error('Turnstile verification failed', error?.message);
    await alertTurnstileProblem(env, waitUntil, `Cloudflare could not be reached (${error?.message}).`);
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
