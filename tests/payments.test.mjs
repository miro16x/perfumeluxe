import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
import { onRequestPost as webhook } from '../functions/api/paypal-webhook.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout-status.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { verifyCancellation } from '../lib/cancel-token.js';
import { cleanUpCheckouts } from '../lib/checkout.js';
import worker from '../worker.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const PAYPAL = 'https://api-m.sandbox.paypal.com';
const env = {
  RESEND_API_KEY: 'test-key',
  PAYPAL_CLIENT_ID: 'pp-client',
  PAYPAL_CLIENT_SECRET: 'pp-secret',
  PAYPAL_WEBHOOK_ID: 'WH-TEST-123',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
  CANCEL_SIGNING_SECRET: 'test-signing-secret'
};
afterEach(() => mock.restoreAll());

const REFERENCE = 'LP-20261007-ABCD1234';
const ORDER_ID = '5O190127TN364715T';
const CAPTURE_ID = '3C679366HH908993F';

const capturedOrder = ({ status = 'COMPLETED', reference = REFERENCE } = {}) => ({
  id: ORDER_ID,
  status: 'COMPLETED',   /* even while the capture itself is PENDING */
  purchase_units: [{
    reference_id: reference, custom_id: reference,
    payments: { captures: [{ id: CAPTURE_ID, status, amount: { currency_code: 'USD', value: '328.00' }, custom_id: reference }] }
  }]
});
const approvedOrder = () => ({ id: ORDER_ID, status: 'APPROVED', purchase_units: [{ reference_id: REFERENCE, custom_id: REFERENCE }] });
const savedCheckout = (overrides = {}) => ({
  reference: REFERENCE,
  paypal_order_id: ORDER_ID,
  details: {
    customerName: 'Test Customer', customerEmail: 'customer@example.com', phone: '3405550100',
    pickupStore: 'Perfume World', pickupDate: 'Thu, Oct 8', pickupTime: '12:00 PM', fulfillment: 'pickup',
    shippingAddress: null, shippingCost: 0, total: 328, placedAt: new Date().toISOString(), userId: null,
    items: [{ id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 2 }]
  },
  ...overrides
});

/* One fake network: PayPal, Resend and Supabase, each overridable. Records every call. */
const mockNetwork = ({
  paypalOrder = capturedOrder(), capture = () => Response.json(capturedOrder()), checkout = savedCheckout(),
  checkoutSave = 201, orderInsert = 201, existingOrder = null, verified = true,
  resend = () => true, refund = () => Response.json({ id: 'REFUND123', status: 'COMPLETED' })
} = {}) => {
  const calls = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
    calls.push(call);
    if (url === `${PAYPAL}/v1/oauth2/token`) return Response.json({ access_token: 'pp-token', expires_in: 32400 });
    if (url === `${PAYPAL}/v1/notifications/verify-webhook-signature`) {
      return Response.json({ verification_status: verified ? 'SUCCESS' : 'FAILURE' });
    }
    if (url === `${PAYPAL}/v2/checkout/orders`) {
      return Response.json({ id: ORDER_ID, status: 'PAYER_ACTION_REQUIRED', links: [
        { rel: 'self', href: `${PAYPAL}/v2/checkout/orders/${ORDER_ID}` },
        { rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}` }
      ] });
    }
    if (url === `${PAYPAL}/v2/checkout/orders/${ORDER_ID}/capture`) return capture(call);
    if (url === `${PAYPAL}/v2/checkout/orders/${ORDER_ID}`) return Response.json(paypalOrder);
    if (url === `${PAYPAL}/v2/payments/captures/${CAPTURE_ID}/refund`) return refund(call);
    if (url === 'https://api.resend.com/emails') {
      return resend(JSON.parse(options.body)) ? Response.json({ id: 'email-id' }) : Response.json({ name: 'validation_error' }, { status: 422 });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/checkouts`)) {
      if (call.method === 'POST') return new Response(null, { status: checkoutSave });
      return Response.json(checkout ? [checkout] : []);
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
const captures = (calls) => calls.filter((call) => call.url.endsWith('/capture'));

const orderRequest = (items = [{ id: 11, size: '50ml', qty: 2, price: 1 }]) => new Request('https://luxeperfume.uluxe.site/api/pickup-order', {
  method: 'POST',
  body: JSON.stringify({
    pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
    phone: '3405550100', pickupDate: '2026-10-08', pickupDateLabel: 'Thu, Oct 8', pickupTime: '12:00 PM', items
  })
});

const PAYPAL_HEADERS = {
  'PayPal-Auth-Algo': 'SHA256withRSA',
  'PayPal-Cert-Url': 'https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77',
  'PayPal-Transmission-Id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
  'PayPal-Transmission-Sig': 'signature',
  'PayPal-Transmission-Time': '2026-10-07T12:00:00Z'
};
const webhookRequest = (event, headers = PAYPAL_HEADERS) => new Request('https://luxeperfume.uluxe.site/api/paypal-webhook', {
  method: 'POST', headers, body: JSON.stringify(event)
});
const captureCompleted = { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } } };
const orderApproved = { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: ORDER_ID } };

/* ── Checkout ─────────────────────────────────────────── */

test('with PayPal configured, an order opens PayPal at catalog prices, saves its details and emails nobody yet', async () => {
  const calls = mockNetwork();
  const response = await pickup({ request: orderRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.checkoutUrl, `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`);
  assert.equal(emails(calls).length, 0);

  const create = calls.find((call) => call.url === `${PAYPAL}/v2/checkout/orders`);
  assert.equal(create.headers.Authorization, 'Bearer pp-token');
  assert.equal(create.headers['PayPal-Request-Id'], `checkout-${body.orderReference}`);
  const { purchase_units: [unit], payment_source: { paypal } } = JSON.parse(create.body);
  assert.equal(unit.items[0].unit_amount.value, '164.00');   /* $164, not the $1 sent */
  assert.equal(unit.items[0].quantity, '2');
  assert.equal(unit.items[0].name, 'Miss Dior Essence · 50ml');
  assert.deepEqual(unit.amount, {
    currency_code: 'USD', value: '328.00',
    breakdown: { item_total: { currency_code: 'USD', value: '328.00' }, shipping: { currency_code: 'USD', value: '0.00' } }
  });
  assert.equal(unit.custom_id, body.orderReference);
  assert.equal(unit.invoice_id, body.orderReference);
  assert.equal(unit.shipping, undefined);
  assert.equal(paypal.experience_context.shipping_preference, 'NO_SHIPPING');
  assert.equal(paypal.experience_context.return_url, 'https://luxeperfume.uluxe.site/?checkout=success');
  assert.equal(paypal.experience_context.cancel_url, 'https://luxeperfume.uluxe.site/?checkout=cancelled');

  const saved = JSON.parse(calls.find((call) => call.url === `${SUPABASE}/rest/v1/checkouts` && call.method === 'POST').body);
  assert.equal(saved.reference, body.orderReference);
  assert.equal(saved.paypal_order_id, ORDER_ID);
  assert.equal(saved.details.pickupStore, 'Perfume World');
  assert.equal(saved.details.customerEmail, 'customer@example.com');
  assert.equal(saved.details.total, 328);
  assert.deepEqual(saved.details.items, [{ id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 2 }]);
});

test('without the PayPal secrets or the Supabase key, ordering stays pay-at-pickup', async () => {
  const { PAYPAL_CLIENT_SECRET, ...noPayPal } = env;
  const { SUPABASE_SERVICE_ROLE_KEY, ...noSupabase } = env;
  for (const partial of [noPayPal, noSupabase]) {
    const calls = mockNetwork();
    const body = await (await pickup({ request: orderRequest(), env: partial })).json();
    assert.equal(body.success, true);
    assert.equal(body.checkoutUrl, undefined);
    assert.equal(body.paid, false);
    assert.match(orderEmails(calls)[0].text, /Payment due at pickup: \$328\.00/);
    mock.restoreAll();
  }
});

test('a PayPal failure tells the customer and alerts the owner', async () => {
  const calls = mockNetwork();
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), body: options?.body });
    if (String(url).startsWith(PAYPAL)) return Response.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 });
    return Response.json({ id: 'email-id' });
  });
  const response = await pickup({ request: orderRequest(), env });
  assert.equal(response.status, 502);
  assert.match(alerts(calls)[0].subject, /Customers cannot start payment/);
});

test('if the order details cannot be saved, the customer is not sent to pay', async () => {
  const calls = mockNetwork({ checkoutSave: 500 });
  const response = await pickup({ request: orderRequest(), env });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).checkoutUrl, undefined);
  assert.match(alerts(calls)[0].text, /checkouts table/);
});

/* ── Webhook ──────────────────────────────────────────── */

test('the webhook rejects calls PayPal does not vouch for', async () => {
  let calls = mockNetwork();
  assert.equal((await webhook({ request: webhookRequest(captureCompleted, {}), env })).status, 400);
  assert.equal(calls.length, 0);

  calls = mockNetwork({ verified: false });
  assert.equal((await webhook({ request: webhookRequest(captureCompleted), env })).status, 400);
  assert.ok(!calls.some((call) => call.url.includes('/v2/checkout/orders')));
  assert.equal(emails(calls).length, 0);
});

test('verification sends PayPal the webhook body exactly as received', async () => {
  const calls = mockNetwork();
  const raw = `{"event_type":"PAYMENT.CAPTURE.COMPLETED",  "resource":{"id":"${CAPTURE_ID}","supplementary_data":{"related_ids":{"order_id":"${ORDER_ID}"}}}}`;
  await webhook({ request: new Request('https://x/api/paypal-webhook', { method: 'POST', headers: PAYPAL_HEADERS, body: raw }), env });
  const verify = calls.find((call) => call.url.endsWith('/verify-webhook-signature'));
  assert.ok(verify.body.endsWith(`"webhook_event":${raw}}`));
  const fields = JSON.parse(verify.body);
  assert.equal(fields.webhook_id, 'WH-TEST-123');
  assert.equal(fields.transmission_sig, 'signature');
});

test('a completed capture records the order and emails the store and customer as PAID', async () => {
  const calls = mockNetwork();
  const response = await webhook({ request: webhookRequest(captureCompleted), env });
  assert.equal(response.status, 200);
  assert.equal(captures(calls).length, 0);

  const insert = calls.find((call) => call.url === `${SUPABASE}/rest/v1/orders` && call.method === 'POST');
  const row = JSON.parse(insert.body);
  assert.equal(row.reference, REFERENCE);
  assert.equal(row.status, 'paid');
  assert.equal(row.user_id, null);
  assert.equal(row.total, 328);
  assert.equal(row.paypal_order_id, ORDER_ID);
  assert.equal(row.paypal_capture_id, CAPTURE_ID);
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

test('an approved order is captured by the webhook, without emailing anyone yet', async () => {
  const calls = mockNetwork({ paypalOrder: approvedOrder() });
  const response = await webhook({ request: webhookRequest(orderApproved), env });
  assert.equal(response.status, 200);
  const [capture] = captures(calls);
  assert.equal(capture.headers['PayPal-Request-Id'], `capture-${REFERENCE}`);
  assert.equal(emails(calls).length, 0);
  assert.ok(!calls.some((call) => call.url.endsWith('/rest/v1/orders')));
});

test('a capture that was already taken (by the return page) is not an error', async () => {
  let fetched = 0;
  const calls = mockNetwork({
    paypalOrder: approvedOrder(),
    capture: () => Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, { status: 422 })
  });
  const original = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (url, options) => {
    /* The second look at the order shows the capture the other caller made. */
    if (String(url) === `${PAYPAL}/v2/checkout/orders/${ORDER_ID}` && fetched++ > 0) return Response.json(capturedOrder());
    return original(url, options);
  });
  assert.equal((await webhook({ request: webhookRequest(orderApproved), env })).status, 200);
  assert.equal(captures(calls).length, 1);
});

test('a repeated webhook for an already-notified order sends nothing', async () => {
  const calls = mockNetwork({ orderInsert: 409, existingOrder: { reference: REFERENCE, notified_at: '2026-10-07T12:00:00Z' } });
  const response = await webhook({ request: webhookRequest(captureCompleted), env });
  assert.equal(response.status, 200);
  assert.equal(emails(calls).length, 0);
});

test('a retry after a failed store email sends it again', async () => {
  const calls = mockNetwork({ orderInsert: 409, existingOrder: { reference: REFERENCE, notified_at: null } });
  await webhook({ request: webhookRequest(captureCompleted), env });
  assert.equal(orderEmails(calls).length, 2);
});

test('if the store email fails, PayPal is asked to retry and the owner is alerted', async () => {
  const calls = mockNetwork({ resend: (email) => !email.to.includes('perfumeworldvi@gmail.com') });
  const response = await webhook({ request: webhookRequest(captureCompleted), env });
  assert.equal(response.status, 500);
  assert.match(alerts(calls)[0].subject, /PAID ORDER NOT DELIVERED to Perfume World — LP-20261007-ABCD1234/);
});

test('a failed order record still delivers the paid order', async () => {
  const calls = mockNetwork({ orderInsert: 500 });
  const response = await webhook({ request: webhookRequest(captureCompleted), env });
  assert.equal(response.status, 200);
  assert.equal(orderEmails(calls).length, 2);
  assert.match(alerts(calls)[0].subject, /Paid orders are not being recorded/);
});

test('if the saved details cannot be read, PayPal is asked to retry', async () => {
  const calls = mockNetwork();
  const original = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (url, options) => (
    String(url).startsWith(`${SUPABASE}/rest/v1/checkouts`) ? new Response(null, { status: 503 }) : original(url, options)
  ));
  assert.equal((await webhook({ request: webhookRequest(captureCompleted), env })).status, 500);
  assert.equal(orderEmails(calls).length, 0);
});

test('a payment whose details are missing alerts the owner', async () => {
  const calls = mockNetwork({ checkout: null });
  assert.equal((await webhook({ request: webhookRequest(captureCompleted), env })).status, 200);
  assert.equal(orderEmails(calls).length, 0);
  assert.match(alerts(calls)[0].subject, /without readable order details/);
});

test('pending captures and other events are acknowledged and ignored', async () => {
  const calls = mockNetwork({ paypalOrder: capturedOrder({ status: 'PENDING' }) });
  assert.equal((await webhook({ request: webhookRequest(captureCompleted), env })).status, 200);
  assert.equal((await webhook({ request: webhookRequest({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: {} }), env })).status, 200);
  assert.equal(emails(calls).length, 0);
});

/* ── Return from PayPal ───────────────────────────────── */

const statusRequest = (id) => new Request(`https://luxeperfume.uluxe.site/api/checkout-status?token=${id}&PayerID=PAYER123`);

test('returning from PayPal captures the payment and returns the confirmation with a working cancel token', async () => {
  const calls = mockNetwork({ paypalOrder: approvedOrder() });
  const body = await (await checkoutStatus({ request: statusRequest(ORDER_ID), env })).json();
  assert.equal(captures(calls).length, 1);
  assert.equal(emails(calls).length, 0);   /* the webhook emails the store */
  assert.equal(body.paid, true);
  assert.equal(body.orderReference, REFERENCE);
  assert.equal(body.total, 328);
  assert.equal(body.paymentId, ORDER_ID);
  assert.ok(await verifyCancellation(env, {
    reference: body.orderReference, email: body.email, pickupStore: body.pickupStore, placedAt: body.placedAt
  }, body.cancelToken));
});

test('an order the webhook already captured is not captured again', async () => {
  const calls = mockNetwork();
  assert.equal((await checkoutStatus({ request: statusRequest(ORDER_ID), env })).status, 200);
  assert.equal(captures(calls).length, 0);
});

test('a declined card, a pending review and a malformed id are each explained', async () => {
  mockNetwork({
    paypalOrder: approvedOrder(),
    capture: () => Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }, { status: 422 })
  });
  const declined = await checkoutStatus({ request: statusRequest(ORDER_ID), env });
  assert.equal(declined.status, 402);
  assert.match((await declined.json()).message, /not charged/);
  mock.restoreAll();

  mockNetwork({ paypalOrder: capturedOrder({ status: 'PENDING' }) });
  assert.equal((await checkoutStatus({ request: statusRequest(ORDER_ID), env })).status, 202);
  assert.equal((await checkoutStatus({ request: statusRequest('../../v1/oauth2'), env })).status, 400);
});

test('details saved for another PayPal order are never shown', async () => {
  mockNetwork({ checkout: savedCheckout({ paypal_order_id: '9X999999XX999999X' }) });
  assert.equal((await checkoutStatus({ request: statusRequest(ORDER_ID), env })).status, 502);
});

/* ── Cancellation and refund ──────────────────────────── */

const cancelRequest = async (overrides = {}) => {
  mock.method(console, 'error', () => {});
  const status = await (await checkoutStatus({ request: statusRequest(ORDER_ID), env })).json();
  return new Request('https://luxeperfume.uluxe.site/api/cancel-pickup-order', {
    method: 'POST',
    body: JSON.stringify({
      orderReference: status.orderReference, email: status.email, pickupStore: status.pickupStore,
      placedAt: status.placedAt, cancelToken: status.cancelToken, paymentId: status.paymentId, ...overrides
    })
  });
};

test('cancelling a paid order refunds it in full, then tells the store and customer', async () => {
  const calls = mockNetwork();
  const response = await cancel({ request: await cancelRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.refunded, 328);

  const refund = calls.find((call) => call.url.endsWith('/refund'));
  assert.equal(refund.url, `${PAYPAL}/v2/payments/captures/${CAPTURE_ID}/refund`);
  assert.equal(refund.headers['PayPal-Request-Id'], `refund-${REFERENCE}`);
  assert.equal(refund.body, '{}');   /* no amount: refund in full */
  const [storeEmail, customerEmail] = orderEmails(calls);
  assert.match(storeEmail.text, /full refund of \$328\.00 has already been issued/);
  assert.match(customerEmail.subject, /cancelled and refunded/);
  const update = calls.find((call) => call.method === 'PATCH');
  assert.equal(JSON.parse(update.body).status, 'refunded');
});

test('a customer cancelling after the store refunded an item gets back only the rest', async () => {
  const partlyRefunded = capturedOrder({ status: 'PARTIALLY_REFUNDED' });
  partlyRefunded.purchase_units[0].payments.refunds = [{ id: 'REFUND1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '164.00' } }];
  const calls = mockNetwork();
  const request = await cancelRequest();
  mock.restoreAll();
  mockNetwork({ paypalOrder: partlyRefunded });
  const body = await (await cancel({ request, env })).json();
  assert.equal(body.refunded, 164);
  assert.ok(calls.length);
});

test('an already-refunded payment still completes the cancellation', async () => {
  const calls = mockNetwork({
    refund: () => Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'CAPTURE_FULLY_REFUNDED' }] }, { status: 422 })
  });
  assert.equal((await cancel({ request: await cancelRequest(), env })).status, 200);
  assert.equal(orderEmails(calls).length, 2);
});

test('a PayPal order from another order cannot be refunded with this token', async () => {
  mockNetwork();
  const request = await cancelRequest();
  mock.restoreAll();
  const calls = mockNetwork({ paypalOrder: capturedOrder({ reference: 'LP-20261007-OTHER999' }) });
  const response = await cancel({ request, env });
  assert.equal(response.status, 403);
  assert.ok(calls.some((call) => call.url === `${PAYPAL}/v2/checkout/orders/${ORDER_ID}`));
  assert.ok(!calls.some((call) => call.url.endsWith('/refund')));
});

test('a failed refund cancels nothing and alerts the owner', async () => {
  const calls = mockNetwork({ refund: () => Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 }) });
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
  assert.equal((await worker.fetch(webhookRequest(captureCompleted), { ...env, API_RATE_LIMITER }, ctx)).status, 200);
  assert.equal((await worker.fetch(statusRequest(ORDER_ID), { ...env, API_RATE_LIMITER }, ctx)).status, 429);
  assert.deepEqual(keys, ['/api/checkout-status:unknown']);
  assert.equal((await worker.fetch(new Request('https://x/api/paypal-webhook'), env, ctx)).status, 405);
});

/* ── Cleanup ──────────────────────────────────────────── */

test('the daily cleanup deletes only checkouts started more than two weeks ago', async () => {
  const calls = mockNetwork();
  await cleanUpCheckouts(env, undefined, new Date('2026-10-15T08:00:00Z'));
  const [cleanup] = calls.filter((call) => call.method === 'DELETE');
  assert.equal(cleanup.url, `${SUPABASE}/rest/v1/checkouts?created_at=lt.${encodeURIComponent('2026-10-01T08:00:00.000Z')}`);
  assert.equal(cleanup.headers.Authorization, 'Bearer secret-key');
  assert.ok(!calls.some((call) => call.method === 'DELETE' && call.url.includes('/orders')));
});

test('a failed cleanup alerts the owner; without Supabase there is nothing to clean', async () => {
  let calls = mockNetwork();
  const original = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (url, options) => (
    options?.method === 'DELETE' ? new Response(null, { status: 401 }) : original(url, options)
  ));
  await cleanUpCheckouts(env);
  assert.match(alerts(calls)[0].subject, /Old checkouts are not being deleted/);
  mock.restoreAll();

  calls = mockNetwork();
  const { SUPABASE_SERVICE_ROLE_KEY, ...noSupabase } = env;
  await cleanUpCheckouts(noSupabase);
  assert.equal(calls.length, 0);
});

test('the Worker runs the cleanup on its daily schedule', async () => {
  const calls = mockNetwork();
  const pending = [];
  await worker.scheduled({ cron: '0 8 * * *' }, env, { waitUntil: (task) => pending.push(task) });
  await Promise.all(pending);
  assert.equal(calls.filter((call) => call.method === 'DELETE' && call.url.startsWith(`${SUPABASE}/rest/v1/checkouts`)).length, 1);
});
