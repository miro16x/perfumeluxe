// Server-side only: emails the site owner when something breaks that a
// customer or store would otherwise never report. Uses Resend, so a total
// Resend outage can't alert; the Workers Logs tab still records every failure.
import { sendEmail } from './email.js';

const ALERT_TO = 'amirsslem679@gmail.com';
const ALERT_FROM = { email: 'alerts@luxeperfume.uluxe.site', name: 'Luxe Perfume Alerts' };
const QUIET_SECONDS = 60 * 60;

/* Throttled alerts are sent at most once per QUIET_SECONDS per kind (per
   Cloudflare location, via the Cache API) so an outage sends one email, not
   hundreds. Alerts carrying a lost order or cancellation pass throttle: false. */
async function alreadySentRecently(kind) {
  const cache = globalThis.caches?.default;
  if (!cache) return false;
  const key = new Request(`https://luxeperfume.uluxe.site/__alerts/${encodeURIComponent(kind)}`);
  if (await cache.match(key)) return true;
  await cache.put(key, new Response('sent', { headers: { 'Cache-Control': `max-age=${QUIET_SECONDS}` } }));
  return false;
}

async function sendAlert(env, { kind, subject, details, throttle }) {
  if (!env.RESEND_API_KEY) return;
  if (throttle && await alreadySentRecently(kind)) return;
  const footer = throttle ? `\n\nFurther "${kind}" alerts are paused for an hour. Check Cloudflare → Workers → luxeperfume → Logs for every occurrence.` : '';
  await sendEmail(env, {
    from: ALERT_FROM,
    to: ALERT_TO,
    subject: `[Luxe Perfume alert] ${subject}`,
    text: `${details}${footer}\n\nTime: ${new Date().toISOString()}`
  });
}

/* Never throws. On Workers it runs after the response via waitUntil, so callers
   can always `await` it without delaying the customer; elsewhere (tests) the
   await waits for the alert to finish. */
export async function alertOwner(env, waitUntil, { kind, subject, details, throttle = true }) {
  const task = sendAlert(env, { kind, subject, details, throttle })
    .catch((error) => console.error('Owner alert failed', kind, error?.code, error?.message));
  if (typeof waitUntil === 'function') waitUntil(task);
  else await task;
}
