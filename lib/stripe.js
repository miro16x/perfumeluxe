// Server-side only: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are Worker
// secrets. Never send them to the browser. Card details are entered on
// Stripe's hosted Checkout page and never reach this site.
const API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const encoder = new TextEncoder();

/* Until both secrets are set, ordering falls back to paying at pickup. */
export const paymentsEnabled = (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

export const validSessionId = (value) => typeof value === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(value);

/* Stripe takes form encoding with bracketed keys: a[b][0][c]=value. */
function formEncode(value, prefix, pairs = []) {
  if (value === undefined || value === null) return pairs;
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) formEncode(child, prefix ? `${prefix}[${key}]` : key, pairs);
  } else {
    pairs.push([prefix, String(value)]);
  }
  return pairs;
}

async function stripe(env, method, path, params, idempotencyKey) {
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let body;
  if (params && method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(formEncode(params)).toString();
  }
  const response = await fetch(`${API}${path}`, { method, headers, body });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(`Stripe rejected request (HTTP ${response.status}).`);
    error.code = `STRIPE_HTTP_${response.status}`;
    // Log only Stripe's error type and code, never request headers or keys.
    error.providerError = [result?.error?.type, result?.error?.code].filter(Boolean).join(':') || undefined;
    throw error;
  }
  return result;
}

const toCents = (dollars) => Math.round(Number(dollars) * 100);

/* `items` must already be priced by lib/catalog.js. The session expires
   after 30 minutes (Stripe's minimum), and the reference doubles as the
   idempotency key so a retried request can't open two payments. */
export function createCheckoutSession(env, { reference, origin, email, items, metadata, shipping }) {
  /* Shipping orders: the address was validated on our side, so Stripe only
     shows the rate and records the address on the payment. */
  const shippingParams = shipping ? {
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: shipping.cost ? 'Standard shipping' : 'Free shipping',
        fixed_amount: { amount: toCents(shipping.cost), currency: 'usd' }
      }
    }]
  } : {};
  return stripe(env, 'POST', '/checkout/sessions', {
    ...shippingParams,
    mode: 'payment',
    payment_method_types: ['card'],   /* includes Apple Pay and Google Pay */
    customer_email: email,
    client_reference_id: reference,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    line_items: items.map((item) => ({
      quantity: item.qty,
      price_data: {
        currency: 'usd',
        unit_amount: toCents(item.price),
        product_data: {
          name: `${item.name} · ${item.size}`,
          description: item.brand,
          images: item.img ? [encodeURI(`${origin}/${item.img}`)] : undefined,
          metadata: { productId: item.id, size: item.size, brand: item.brand }
        }
      }
    })),
    metadata: { reference, ...metadata },
    payment_intent_data: {
      description: `${shipping ? 'Shipping' : 'Pickup'} order ${reference} — ${metadata.pickupStore}`,
      metadata: { reference },
      shipping: shipping ? {
        name: shipping.name,
        phone: shipping.phone,
        address: {
          line1: shipping.address.line1,
          line2: shipping.address.line2 || undefined,
          city: shipping.address.city,
          state: shipping.address.state,
          postal_code: shipping.address.zip,
          country: shipping.address.country
        }
      } : undefined
    },
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancelled`
  }, `checkout-${reference}`);
}

/* Includes the line items, whose product metadata carries id, size and brand. */
export function retrieveCheckoutSession(env, sessionId) {
  return stripe(env, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items.data.price.product`);
}

/* Rebuilds the order's items from a retrieved session. */
export const sessionItems = (session) => (session.line_items?.data ?? []).map((line) => {
  const product = line.price?.product ?? {};
  return {
    id: Number(product.metadata?.productId) || null,
    name: String(product.name || line.description || '').replace(/ · [^·]+$/, ''),
    brand: product.metadata?.brand || product.description || '',
    size: product.metadata?.size || '',
    price: line.price?.unit_amount / 100,
    qty: line.quantity
  };
});

/* The order as created by /api/pickup-order, rebuilt from its Checkout session. */
export function orderFromSession(session) {
  const metadata = session.metadata ?? {};
  const shipping = metadata.fulfillment === 'shipping';
  return {
    fulfillment: shipping ? 'shipping' : 'pickup',
    shippingAddress: shipping ? {
      line1: metadata.shipLine1,
      line2: metadata.shipLine2 || '',
      city: metadata.shipCity,
      state: metadata.shipState,
      zip: metadata.shipZip,
      country: metadata.shipState === 'PR' ? 'PR' : 'US'
    } : null,
    shippingCost: shipping ? (session.shipping_cost?.amount_total ?? 0) / 100 : 0,
    reference: metadata.reference,
    customerName: metadata.customerName,
    customerEmail: session.customer_email || session.customer_details?.email,
    phone: metadata.phone,
    pickupStore: metadata.pickupStore,
    pickupDate: metadata.pickupDate,
    pickupTime: metadata.pickupTime,
    placedAt: new Date(metadata.placedAt),
    userId: metadata.userId || null,
    items: sessionItems(session),
    total: session.amount_total / 100,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  };
}

/* Full refund. The idempotency key and the already-refunded check make a
   repeated cancellation harmless. */
export async function refundPayment(env, paymentIntentId, reference) {
  try {
    return await stripe(env, 'POST', '/refunds', {
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
      metadata: { reference }
    }, `refund-${reference}`);
  } catch (error) {
    if (String(error.providerError || '').includes('charge_already_refunded')) return { alreadyRefunded: true };
    throw error;
  }
}

/* Verifies the Stripe-Signature header (HMAC-SHA256 over "timestamp.body")
   and returns the parsed event, or null if it wasn't sent by Stripe. */
export async function verifyWebhook(env, rawBody, signatureHeader) {
  const parts = String(signatureHeader || '').split(',').map((part) => part.split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || !signatures.length) return null;
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return null;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const signed = encoder.encode(`${timestamp}.${rawBody}`);
  for (const signature of signatures) {
    if (!/^[0-9a-f]{64}$/.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/../g), (byte) => parseInt(byte, 16));
    /* crypto.subtle.verify compares in constant time. */
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) {
      try { return JSON.parse(rawBody); } catch { return null; }
    }
  }
  return null;
}
