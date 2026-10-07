import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout-status.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { verifyCancellation } from '../lib/cancel-token.js';
import worker from '../worker.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const env = {
  RESEND_API_KEY: 'test-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
  CANCEL_SIGNING_SECRET: 'test-signing-secret'
};
afterEach(() => mock.restoreAll());

const paidSession = (overrides = {}) => ({
  id: 'cs_test_a1B2c3D4e5F6g7H8',
  payment_status: 'paid',
  amount_total: 32800,
  customer_email: 'customer@example.com',
  payment_intent: 'pi_test_123',
  metadata: {
    reference: 'LP-20261007-ABCD1234', customerName: 'Test Customer', phone: '3405550100',
    pickupStore: 'Perfume World', pickupDate: 'Thu, Oct 8', pickupTime: '12:00 PM',
    placedAt: new Date().toISOString()
  },
  line_items: { data: [{
    quantity: 2,
    description: 'Miss Dior Essence · 50ml',
    price: { unit_amount: 16400, product: { name: 'Miss Dior Essence · 50ml', description: 'DIOR', metadata: { productId: '11', size: '50ml', brand: 'DIOR' } } }
  }] },
  ...overrides
});

/* One fake network: Stripe, Resend and Supabase, each overridable. Records every call. */
const mockNetwork = ({ session = paidSession(), orderInsert = 201, existingOrder = null, resend = () => true, refund = () => Response.json({ id: 're_123' }) } = {}) => {
  const calls = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
    calls.push(call);
    if (url === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' });
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return Response.json(session);
    if (url === 'https://api.stripe.com/v1/refunds') return refund(call);
    if (url === 'https://api.resend.com/emails') {
      return resend(JSON.parse(options.body)) ? Response.json({ id: 'email-id' }) : Response.json({ name: 'validation_error' }, { status: 422 });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/orders`)) {
      if (call.method === 'POST') return new Response(null, { status: orderInsert });
      if (call.method === 'GET') return Response.json(existingOrder ? [existingOrder] : []);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  return calls;
};
const emails = (calls) => calls.filter((call) => call.url === 'https://api.resend.com/emails').map((call) => JSON.parse(call.body));
const orderEmails = (calls) => emails(calls).filter((email) => !email.from.includes('alerts@'));
const alerts = (calls) => emails(calls).filter((email) => email.from.includes('alerts@'));

const orderRequest = (items = [{ id: 11, size: '50ml', qty: 2, price: 1 }]) => new Request('https://luxeperfume.uluxe.site/api/pickup-order', {
  method: 'POST',
  body: JSON.stringify({
    pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
    phone: '3405550100', pickupDate: '2026-10-08', pickupDateLabel: 'Thu, Oct 8', pickupTime: '12:00 PM', items
  })
});

async function signedWebhook(event, { secret = env.STRIPE_WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))).toString('hex');
  return new Request('https://luxeperfume.uluxe.site/api/stripe-webhook', {
    method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body
  });
}
const completed = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_a1B2c3D4e5F6g7H8' } } };

/* ── Checkout ─────────────────────────────────────────── */

test('with Stripe configured, an order opens Checkout at catalog prices and emails nobody yet', async () => {
  const calls = mockNetwork();
  const response = await pickup({ request: orderRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_new');
  assert.equal(emails(calls).length, 0);

  const [create] = calls.filter((call) => call.url === 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(create.headers.Authorization, 'Bearer sk_test_123');
  assert.equal(create.headers['Idempotency-Key'], `checkout-${body.orderReference}`);
  const form = new URLSearchParams(create.body);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '16400');   /* $164, not the $1 sent */
  assert.equal(form.get('line_items[0][quantity]'), '2');
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Miss Dior Essence · 50ml');
  assert.equal(form.get('customer_email'), 'customer@example.com');
  assert.equal(form.get('metadata[reference]'), body.orderReference);
  assert.equal(form.get('metadata[pickupStore]'), 'Perfume World');
  assert.equal(form.get('success_url'), 'https://luxeperfume.uluxe.site/?checkout=success&session_id={CHECKOUT_SESSION_ID}');
});

test('without Stripe secrets, ordering stays pay-at-pickup', async () => {
  const calls = mockNetwork();
  const { STRIPE_SECRET_KEY, ...noStripe } = env;
  const body = await (await pickup({ request: orderRequest(), env: noStripe })).json();
  assert.equal(body.success, true);
  assert.equal(body.checkoutUrl, undefined);
  assert.equal(body.paid, false);
  assert.match(orderEmails(calls)[0].text, /Payment due at pickup: \$328\.00/);
});

test('a Stripe failure tells the customer and alerts the owner', async () => {
  const calls = mockNetwork();
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), body: options?.body });
    if (String(url).startsWith('https://api.stripe.com')) return Response.json({ error: { type: 'authentication_error' } }, { status: 401 });
    return Response.json({ id: 'email-id' });
  });
  const response = await pickup({ request: orderRequest(), env });
  assert.equal(response.status, 502);
  assert.match(alerts(calls)[0].subject, /Customers cannot start payment/);
});

/* ── Webhook ──────────────────────────────────────────── */

test('the webhook rejects calls without a valid Stripe signature', async () => {
  const calls = mockNetwork();
  for (const request of [
    new Request('https://x/api/stripe-webhook', { method: 'POST', body: JSON.stringify(completed) }),
    await signedWebhook(completed, { secret: 'whsec_wrong' }),
    await signedWebhook(completed, { timestamp: Math.floor(Date.now() / 1000) - 3600 })
  ]) {
    assert.equal((await webhook({ request, env })).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('a paid session records the order and emails the store and customer as PAID', async () => {
  const calls = mockNetwork();
  const response = await webhook({ request: await signedWebhook(completed), env });
  assert.equal(response.status, 200);

  const insert = calls.find((call) => call.url === `${SUPABASE}/rest/v1/orders` && call.method === 'POST');
  const row = JSON.parse(insert.body);
  assert.equal(row.reference, 'LP-20261007-ABCD1234');
  assert.equal(row.status, 'paid');
  assert.equal(row.user_id, null);
  assert.equal(row.total, 328);
  assert.equal(row.stripe_payment_intent, 'pi_test_123');
  assert.deepEqual(row.items, [{ id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 2 }]);

  const [storeEmail, customerEmail] = orderEmails(calls);
  assert.deepEqual(storeEmail.to, ['perfumeworldvi@gmail.com']);
  assert.match(storeEmail.subject, /\(PAID\)/);
  assert.match(storeEmail.text, /PAID ONLINE: \$328\.00\. Do not charge the customer at pickup\./);
  assert.deepEqual(customerEmail.to, ['customer@example.com']);
  assert.match(customerEmail.text, /Paid online: \$328\.00/);

  const notified = calls.find((call) => call.method === 'PATCH');
  assert.ok(JSON.parse(notified.body).notified_at);
});

test('a repeated webhook for an already-notified order sends nothing', async () => {
  const calls = mockNetwork({ orderInsert: 409, existingOrder: { reference: 'LP-20261007-ABCD1234', notified_at: '2026-10-07T12:00:00Z' } });
  const response = await webhook({ request: await signedWebhook(completed), env });
  assert.equal(response.status, 200);
  assert.equal(emails(calls).length, 0);
});

test('a retry after a failed store email sends it again', async () => {
  const calls = mockNetwork({ orderInsert: 409, existingOrder: { reference: 'LP-20261007-ABCD1234', notified_at: null } });
  await webhook({ request: await signedWebhook(completed), env });
  assert.equal(orderEmails(calls).length, 2);
});

test('if the store email fails, Stripe is asked to retry and the owner is alerted', async () => {
  const calls = mockNetwork({ resend: (email) => !email.to.includes('perfumeworldvi@gmail.com') });
  const response = await webhook({ request: await signedWebhook(completed), env });
  assert.equal(response.status, 500);
  assert.match(alerts(calls)[0].subject, /PAID ORDER NOT DELIVERED to Perfume World — LP-20261007-ABCD1234/);
});

test('a Supabase outage still delivers the paid order', async () => {
  const calls = mockNetwork({ orderInsert: 500 });
  const response = await webhook({ request: await signedWebhook(completed), env });
  assert.equal(response.status, 200);
  assert.equal(orderEmails(calls).length, 2);
  assert.match(alerts(calls)[0].subject, /Paid orders are not being recorded/);
});

test('unpaid sessions and other events are acknowledged and ignored', async () => {
  const calls = mockNetwork({ session: paidSession({ payment_status: 'unpaid' }) });
  assert.equal((await webhook({ request: await signedWebhook(completed), env })).status, 200);
  assert.equal((await webhook({ request: await signedWebhook({ type: 'charge.refunded', data: { object: {} } }), env })).status, 200);
  assert.equal(emails(calls).length, 0);
});

/* ── Return from Stripe ───────────────────────────────── */

const statusRequest = (id) => new Request(`https://luxeperfume.uluxe.site/api/checkout-status?session_id=${id}`);

test('checkout status returns the confirmation with a working cancel token', async () => {
  mockNetwork();
  const body = await (await checkoutStatus({ request: statusRequest('cs_test_a1B2c3D4e5F6g7H8'), env })).json();
  assert.equal(body.paid, true);
  assert.equal(body.orderReference, 'LP-20261007-ABCD1234');
  assert.equal(body.total, 328);
  assert.equal(body.sessionId, 'cs_test_a1B2c3D4e5F6g7H8');
  assert.ok(await verifyCancellation(env, {
    reference: body.orderReference, email: body.email, pickupStore: body.pickupStore, placedAt: body.placedAt
  }, body.cancelToken));
});

test('checkout status refuses unpaid sessions and malformed ids', async () => {
  mockNetwork({ session: paidSession({ payment_status: 'unpaid' }) });
  assert.equal((await checkoutStatus({ request: statusRequest('cs_test_a1B2c3D4e5F6g7H8'), env })).status, 409);
  assert.equal((await checkoutStatus({ request: statusRequest('../../v1/customers'), env })).status, 400);
});

/* ── Cancellation and refund ──────────────────────────── */

const cancelRequest = async (overrides = {}) => {
  mock.method(console, 'error', () => {});
  const status = await (await checkoutStatus({ request: statusRequest('cs_test_a1B2c3D4e5F6g7H8'), env })).json();
  return new Request('https://luxeperfume.uluxe.site/api/cancel-pickup-order', {
    method: 'POST',
    body: JSON.stringify({
      orderReference: status.orderReference, email: status.email, pickupStore: status.pickupStore,
      placedAt: status.placedAt, cancelToken: status.cancelToken, sessionId: status.sessionId, ...overrides
    })
  });
};

test('cancelling a paid order refunds it in full, then tells the store and customer', async () => {
  const calls = mockNetwork();
  const response = await cancel({ request: await cancelRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.refunded, 328);

  const refund = calls.find((call) => call.url === 'https://api.stripe.com/v1/refunds');
  assert.equal(new URLSearchParams(refund.body).get('payment_intent'), 'pi_test_123');
  assert.equal(refund.headers['Idempotency-Key'], 'refund-LP-20261007-ABCD1234');
  const [storeEmail, customerEmail] = orderEmails(calls);
  assert.match(storeEmail.text, /full refund of \$328\.00 has already been issued/);
  assert.match(customerEmail.subject, /cancelled and refunded/);
  const update = calls.find((call) => call.method === 'PATCH');
  assert.equal(JSON.parse(update.body).status, 'refunded');
});

test('an already-refunded payment still completes the cancellation', async () => {
  const calls = mockNetwork({
    refund: () => Response.json({ error: { type: 'invalid_request_error', code: 'charge_already_refunded' } }, { status: 400 })
  });
  assert.equal((await cancel({ request: await cancelRequest(), env })).status, 200);
  assert.equal(orderEmails(calls).length, 2);
});

test('a session from another order cannot be refunded with this token', async () => {
  mockNetwork();
  const request = await cancelRequest();
  mock.restoreAll();
  const calls = mockNetwork({ session: paidSession({ metadata: { ...paidSession().metadata, reference: 'LP-20261007-OTHER999' } }) });
  const response = await cancel({ request, env });
  assert.equal(response.status, 403);
  assert.ok(calls.some((call) => call.url.includes('/checkout/sessions/')));
  assert.ok(!calls.some((call) => call.url.endsWith('/refunds')));
});

test('a failed refund cancels nothing and alerts the owner', async () => {
  const calls = mockNetwork({ refund: () => Response.json({ error: { type: 'api_error' } }, { status: 500 }) });
  const response = await cancel({ request: await cancelRequest(), env });
  assert.equal(response.status, 502);
  assert.equal(orderEmails(calls).length, 0);
  assert.match(alerts(calls)[0].subject, /REFUND FAILED — LP-20261007-ABCD1234/);
});

/* ── Routing ──────────────────────────────────────────── */

test('the webhook is never rate limited; checkout status is', async () => {
  mockNetwork();
  const keys = [];
  const API_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const ctx = { waitUntil() {} };
  assert.equal((await worker.fetch(await signedWebhook(completed), { ...env, API_RATE_LIMITER }, ctx)).status, 200);
  assert.equal((await worker.fetch(statusRequest('cs_test_a1B2c3D4e5F6g7H8'), { ...env, API_RATE_LIMITER }, ctx)).status, 429);
  assert.deepEqual(keys, ['/api/checkout-status:unknown']);
  assert.equal((await worker.fetch(new Request('https://x/api/stripe-webhook'), env, ctx)).status, 405);
});
