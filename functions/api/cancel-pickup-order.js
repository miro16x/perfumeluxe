import { sendEmail } from '../../lib/email.js';

const STORES = {
  'Luxe Fragrances': { email: 'luxefragrances.vi@gmail.com' },
  'Perfume World': { email: 'perfumeworldvi@gmail.com' }
};

const ALWAYS_NOTIFY = 'amirsslem679@gmail.com';
const FROM_ADDRESS = { email: 'orders@luxeperfume.uluxe.site', name: 'Luxe Perfume Pickup' };
const DAY_MS = 24 * 60 * 60 * 1000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) return json({ success: false, message: 'Email service is not configured.' }, 503);

  let cancellation;
  try {
    cancellation = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid cancellation data.' }, 400);
  }

  const reference = String(cancellation.orderReference || '').trim().slice(0, 40);
  const email = String(cancellation.email || '').trim().slice(0, 254);
  const pickupStore = String(cancellation.pickupStore || '');
  const placedAt = new Date(cancellation.placedAt);
  const store = STORES[pickupStore];
  const age = Date.now() - placedAt.getTime();

  if (!/^LP-\d{8}-[A-F0-9-]{8,}$/i.test(reference) || !validEmail(email) || !store ||
      !Number.isFinite(placedAt.getTime())) {
    return json({ success: false, message: 'Order details are missing or invalid.' }, 400);
  }
  if (age < 0 || age > DAY_MS) {
    return json({ success: false, message: 'The 24-hour cancellation window has closed.' }, 409);
  }

  const subject = `Pickup cancellation requested — ${reference}`;
  const text = `CANCEL PICKUP ORDER\n\nOrder: ${reference}\nCustomer email: ${email}\nStore: ${pickupStore}\n\nThis cancellation was requested within 24 hours of the order being placed.`;
  const referenceHtml = `
    <div style="margin:20px 0;padding:18px;border:2px solid #b08d32;text-align:center">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">Pickup reference</div>
      <strong style="display:block;font-size:24px;margin-top:6px">${escapeHtml(reference)}</strong>
      <div style="font-size:13px;margin-top:6px">Cancellation requested</div>
    </div>`;
  const detailsHtml = `
    <h2>Request details</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr><th scope="row" style="padding:8px;border-bottom:1px solid #ddd;text-align:left">Store</th>
        <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(pickupStore)}</td></tr>
      <tr><th scope="row" style="padding:8px;border-bottom:1px solid #ddd;text-align:left">Customer email</th>
        <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(email)}</td></tr>
    </table>`;
  const storeHtml = `
    <h1>Pickup cancellation requested</h1>
    <p>A customer has requested cancellation of their pickup order at <strong>${escapeHtml(pickupStore)}</strong>.</p>
    ${referenceHtml}
    ${detailsHtml}
    <p>Please use the pickup reference to locate the original order and process the cancellation request.</p>
    <p><small>This cancellation was requested within 24 hours of the order being placed.</small></p>`;
  const customerHtml = `
    <h1>We received your cancellation request</h1>
    <p>We received your request to cancel your pickup order with <strong>${escapeHtml(pickupStore)}</strong>.</p>
    ${referenceHtml}
    ${detailsHtml}
    <p>The store has been notified of your request. Keep this message and your pickup reference for your records.</p>
    <p>This confirms receipt of your cancellation request. Contact the store with your pickup reference if you need further assistance.</p>`;

  try {
    await Promise.all([
      sendEmail(env, { from: FROM_ADDRESS, to: store.email, bcc: [ALWAYS_NOTIFY], replyTo: email, subject, html: storeHtml, text }),
      sendEmail(env, { from: FROM_ADDRESS, to: email, replyTo: store.email, subject: `We received your cancellation request — ${reference}`, html: customerHtml, text: `We received your request to cancel pickup order ${reference}. ${pickupStore} has been notified. Keep this message for your records.` })
    ]);
    return json({ success: true, orderReference: reference });
  } catch (error) {
    console.error('Pickup cancellation email delivery failed', error?.code, error?.message, error?.providerError);
    return json({ success: false, message: 'Unable to deliver the cancellation request.' }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
