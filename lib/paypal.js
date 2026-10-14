// Server-side only: PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID are Worker
// secrets. Never send them to the browser. Customers pay on PayPal's hosted
// page (with a PayPal account, or by card as a guest); card details never
// reach this site. PAYPAL_ENV=live switches from the sandbox to real payments.
import { accountOrdersEnabled } from './supabase.js';

const API = { live: 'https://api-m.paypal.com', sandbox: 'https://api-m.sandbox.paypal.com' };
const apiBase = (env) => (env.PAYPAL_ENV === 'live' ? API.live : API.sandbox);

/* Until the PayPal secrets are set, ordering falls back to paying at pickup.
   Order details wait in Supabase while the customer pays (PayPal only keeps
   a short reference), so payments also need the Supabase key. */
export const paymentsEnabled = (env) => Boolean(
  env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID && accountOrdersEnabled(env)
);

/* PayPal order ids look like 5O190127TN364715T. */
export const validPaymentId = (value) => typeof value === 'string' && /^[A-Z0-9]{10,40}$/.test(value);

function paypalError(response, result) {
  const error = new Error(`PayPal rejected request (HTTP ${response.status}).`);
  error.code = `PAYPAL_HTTP_${response.status}`;
  // Log only PayPal's error name and issue, never request headers or keys.
  error.providerError = [result?.name || result?.error, result?.details?.[0]?.issue].filter(Boolean).join(':') || undefined;
  return error;
}

/* Access tokens last about nine hours; reuse one while this isolate lives. */
let cachedToken = null;

async function accessToken(env) {
  const cacheKey = `${apiBase(env)}|${env.PAYPAL_CLIENT_ID}`;
  if (cachedToken?.key === cacheKey && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const response = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.access_token) throw paypalError(response, result);
  cachedToken = {
    key: cacheKey,
    value: result.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(result.expires_in) || 0) - 300) * 1000
  };
  return cachedToken.value;
}

/* `body` is an object, or a ready-made JSON string (see verifyWebhook). */
async function paypal(env, method, path, body, requestId) {
  const headers = { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw paypalError(response, result);
  return result;
}

const toCents = (dollars) => Math.round(Number(dollars) * 100);
const money = (cents) => ({ currency_code: 'USD', value: (cents / 100).toFixed(2) });

/* `items` must already be priced by lib/catalog.js. The reference is the
   order's custom_id and invoice_id (PayPal refuses a second payment on one
   invoice), and the request id makes a retried request return the same order. */
export async function createCheckoutOrder(env, { reference, origin, items, pickupStore, shipping }) {
  const itemCents = items.reduce((sum, item) => sum + toCents(item.price) * item.qty, 0);
  const shippingCents = shipping ? toCents(shipping.cost) : 0;
  const order = await paypal(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: reference,
      custom_id: reference,
      invoice_id: reference,
      description: `${shipping ? 'Shipping' : 'Pickup'} order ${reference} — ${pickupStore}`.slice(0, 127),
      amount: {
        ...money(itemCents + shippingCents),
        breakdown: { item_total: money(itemCents), shipping: money(shippingCents) }
      },
      items: items.map((item) => ({
        name: `${item.name} · ${item.size}`.slice(0, 127),
        description: String(item.brand || '').slice(0, 127) || undefined,
        sku: String(item.id),
        unit_amount: money(toCents(item.price)),
        quantity: String(item.qty),
        category: 'PHYSICAL_GOODS'
      })),
      /* Shipping orders: the address was validated on our side, so PayPal
         shows it without letting the customer change it. */
      shipping: shipping ? {
        name: { full_name: shipping.name },
        address: {
          address_line_1: shipping.address.line1,
          address_line_2: shipping.address.line2 || undefined,
          admin_area_2: shipping.address.city,
          admin_area_1: shipping.address.state,
          postal_code: shipping.address.zip,
          country_code: shipping.address.country
        }
      } : undefined
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Luxe Perfume',
          locale: 'en-US',
          user_action: 'PAY_NOW',
          shipping_preference: shipping ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
          /* PayPal adds &token=<order id>&PayerID=… to both. */
          return_url: `${origin}/?checkout=success`,
          cancel_url: `${origin}/?checkout=cancelled`
        }
      }
    }
  }, `checkout-${reference}`);
  const url = order.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href;
  if (!url) throw Object.assign(new Error('PayPal returned no payment page.'), { code: 'PAYPAL_NO_APPROVAL_LINK' });
  return { id: order.id, url };
}

export function getCheckoutOrder(env, orderId) {
  return paypal(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/* Takes the payment the customer approved. The return page and the webhook
   may both try; the request id and the already-captured check make that safe. */
export async function captureCheckoutOrder(env, orderId, reference) {
  try {
    return await paypal(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${reference}`);
  } catch (error) {
    if (String(error.providerError || '').includes('ORDER_ALREADY_CAPTURED')) return getCheckoutOrder(env, orderId);
    throw error;
  }
}

/* The order's single payment, once captured: { id, status, amount, reference }.
   Status COMPLETED means paid; PENDING means PayPal is still reviewing it. */
export function orderCapture(order) {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture) return null;
  return {
    id: capture.id,
    status: capture.status,
    amount: Number(capture.amount?.value),
    reference: capture.custom_id || unit.custom_id || unit.reference_id
  };
}

export const orderReference = (order) => order?.purchase_units?.[0]?.custom_id || order?.purchase_units?.[0]?.reference_id || null;

/* Full refund. The request id and the already-refunded check make a repeated
   cancellation harmless. */
export async function refundPayment(env, captureId, reference) {
  try {
    return await paypal(env, 'POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {}, `refund-${reference}`);
  } catch (error) {
    if (String(error.providerError || '').includes('CAPTURE_FULLY_REFUNDED')) return { alreadyRefunded: true };
    throw error;
  }
}

/* Asks PayPal whether this webhook call really came from PayPal, and returns
   the parsed event, or null. The raw body is passed through untouched: PayPal
   checks a checksum of it, which re-serializing could change. */
export async function verifyWebhook(env, rawBody, headers) {
  let event;
  try { event = JSON.parse(rawBody); } catch { return null; }
  const fields = {
    auth_algo: headers.get('PayPal-Auth-Algo'),
    cert_url: headers.get('PayPal-Cert-Url'),
    transmission_id: headers.get('PayPal-Transmission-Id'),
    transmission_sig: headers.get('PayPal-Transmission-Sig'),
    transmission_time: headers.get('PayPal-Transmission-Time'),
    webhook_id: env.PAYPAL_WEBHOOK_ID
  };
  if (Object.values(fields).some((value) => !value)) return null;
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
  const result = await paypal(env, 'POST', '/v1/notifications/verify-webhook-signature', body);
  return result.verification_status === 'SUCCESS' ? event : null;
}
