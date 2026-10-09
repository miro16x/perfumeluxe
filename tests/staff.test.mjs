import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as listOrders } from '../functions/api/staff-orders.js';
import { onRequestPost as orderAction } from '../functions/api/staff-order-action.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { signCancellation } from '../lib/cancel-token.js';
import worker from '../worker.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const env = {
  RESEND_API_KEY: 'test-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
  CANCEL_SIGNING_SECRET: 'test-signing-secret'
};
const DAY = 24 * 60 * 60 * 1000;
afterEach(() => mock.restoreAll());

const pickupOrder = (overrides = {}) => ({
  reference: 'LP-20261007-ABCD1234', status: 'paid', fulfillment: 'pickup',
  pickup_store: 'Perfume World', pickup_date: 'Thu, Oct 8', pickup_time: '12:00 PM',
  customer_name: 'Test Customer', email: 'customer@example.com', phone: '3405550100',
  shipping_address: null, shipping_cost: 0,
  items: [{ id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 2 }],
  item_count: 2, total: 328, placed_at: new Date(Date.now() - 2 * DAY).toISOString(),
  stripe_payment_intent: 'pi_test_123',
  ...overrides
});
const shippingOrder = (overrides = {}) => pickupOrder({
  fulfillment: 'shipping', pickup_store: 'Luxe Fragrances', pickup_date: null, pickup_time: null,
  shipping_address: { line1: '1 Main St', line2: '', city: 'Miami', state: 'FL', zip: '33101', country: 'US' },
  shipping_cost: 0, ...overrides
});

/* One fake network: Supabase auth, staff and orders tables, Stripe refunds and Resend. */
const mockNetwork = ({ user = { id: 'staff-1', email: 'jane@example.com' }, staff = { user_id: 'staff-1', store: 'Perfume World', name: 'Jane' }, order = pickupOrder(), patched = true, refund = () => Response.json({ id: 're_123' }) } = {}) => {
  const calls = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body };
    calls.push(call);
    if (url === `${SUPABASE}/auth/v1/user`) {
      return user && call.headers.Authorization === 'Bearer staff-jwt' ? Response.json(user) : Response.json({ msg: 'invalid JWT' }, { status: 401 });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/staff`)) return Response.json(staff ? [staff] : []);
    if (url.startsWith(`${SUPABASE}/rest/v1/orders`)) {
      if (call.method === 'PATCH') return Response.json(patched ? [{ reference: order?.reference }] : []);
      return Response.json(order ? [order] : []);
    }
    if (url === 'https://api.stripe.com/v1/refunds') return refund(call);
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    throw new Error(`Unexpected request to ${url}`);
  });
  return calls;
};
const emails = (calls) => calls.filter((call) => call.url === 'https://api.resend.com/emails').map((call) => JSON.parse(call.body));
const patches = (calls) => calls.filter((call) => call.method === 'PATCH');
const refunds = (calls) => calls.filter((call) => call.url === 'https://api.stripe.com/v1/refunds');

const listRequest = (view = '', token = 'staff-jwt') => new Request(`https://luxeperfume.uluxe.site/api/staff-orders${view ? `?view=${view}` : ''}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {}
});
const act = (body, token = 'staff-jwt') => orderAction({
  request: new Request('https://luxeperfume.uluxe.site/api/staff-order-action', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ reference: 'LP-20261007-ABCD1234', ...body })
  }),
  env
});

/* ── Access ───────────────────────────────────────────── */

test('only signed-in staff can see or change orders', async () => {
  let calls = mockNetwork();
  assert.equal((await listOrders({ request: listRequest('', null), env })).status, 403);
  assert.equal((await act({ action: 'ready' }, 'customer-jwt')).status, 403);
  assert.equal(patches(calls).length, 0);

  calls = mockNetwork({ staff: null });
  const response = await listOrders({ request: listRequest(), env });
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /staff access/);
  assert.equal(calls.filter((call) => call.url.includes('/rest/v1/orders')).length, 0);
});

test('store staff see only their store and open orders, without Stripe ids', async () => {
  const calls = mockNetwork();
  const response = await listOrders({ request: listRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.staff, { name: 'Jane', store: 'Perfume World' });

  const list = calls.find((call) => call.url.startsWith(`${SUPABASE}/rest/v1/orders`));
  assert.match(list.url, /pickup_store=eq\.Perfume%20World/);
  assert.match(list.url, /status=in\.\(placed,paid,ready\)/);
  assert.doesNotMatch(list.url, /stripe|user_id/);
  assert.equal(list.headers.apikey, 'secret-key');
});

test('staff for every store get every store, and the done view lists finished orders', async () => {
  const calls = mockNetwork({ staff: { user_id: 'staff-1', store: 'all', name: '' } });
  const body = await (await listOrders({ request: listRequest('done'), env })).json();
  assert.equal(body.staff.store, null);
  assert.equal(body.staff.name, 'jane@example.com');
  const list = calls.find((call) => call.url.startsWith(`${SUPABASE}/rest/v1/orders`));
  assert.doesNotMatch(list.url, /pickup_store=eq/);
  assert.match(list.url, /status=in\.\(shipped,collected,cancelled,refunded\)/);
});

test("staff can't act on another store's order", async () => {
  const calls = mockNetwork({ order: shippingOrder() });   /* Luxe Fragrances */
  const response = await act({ action: 'refund' });
  assert.equal(response.status, 404);
  assert.equal(refunds(calls).length, 0);
  assert.equal(patches(calls).length, 0);
});

/* ── Pickup ───────────────────────────────────────────── */

test('ready for pickup updates the order only if it is still paid and emails the customer', async () => {
  const calls = mockNetwork();
  const body = await (await act({ action: 'ready' })).json();
  assert.equal(body.success, true);
  assert.equal(body.status, 'ready');
  assert.equal(body.customerEmailed, true);

  const [update] = patches(calls);
  assert.match(update.url, /reference=eq\.LP-20261007-ABCD1234&status=in\.\(placed,paid\)/);
  const fields = JSON.parse(update.body);
  assert.equal(fields.status, 'ready');
  assert.equal(fields.updated_by, 'staff-1');
  assert.ok(fields.ready_at);

  const [email] = emails(calls);
  assert.deepEqual(email.to, ['customer@example.com']);
  assert.equal(email.reply_to, 'perfumeworldvi@gmail.com');
  assert.match(email.subject, /ready for pickup — LP-20261007-ABCD1234/);
  assert.match(email.text, /4605 Tutu Park Mall/);
});

test('picked up sends no email', async () => {
  const calls = mockNetwork({ order: pickupOrder({ status: 'ready' }) });
  const body = await (await act({ action: 'collected' })).json();
  assert.equal(body.status, 'collected');
  assert.equal(body.customerEmailed, null);
  assert.equal(emails(calls).length, 0);
});

test('an order someone else already changed is not changed again or emailed', async () => {
  const calls = mockNetwork({ patched: false });
  const response = await act({ action: 'ready' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /changed by someone else/);
  assert.equal(emails(calls).length, 0);
});

test('actions that do not fit the order are refused', async () => {
  mockNetwork();
  assert.equal((await act({ action: 'shipped', carrier: 'usps', trackingNumber: '9400100000000000000000' })).status, 409);
  mockNetwork({ order: pickupOrder({ status: 'collected' }) });
  assert.equal((await act({ action: 'refund' })).status, 409);
  mockNetwork();
  assert.equal((await act({ action: 'delete' })).status, 400);
});

/* ── Shipping ─────────────────────────────────────────── */

const allStores = { user_id: 'staff-1', store: 'all', name: 'Owner' };

test('a shipping order cannot be marked shipped while the customer can still cancel', async () => {
  const calls = mockNetwork({ staff: allStores, order: shippingOrder({ placed_at: new Date().toISOString() }) });
  const response = await act({ action: 'shipped', carrier: 'usps', trackingNumber: '9400 1000 0000 0000 0000 00' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /can still cancel/);
  assert.equal(patches(calls).length, 0);
});

test('marking shipped saves the tracking number and emails the customer a tracking link', async () => {
  const calls = mockNetwork({ staff: allStores, order: shippingOrder() });
  const body = await (await act({ action: 'shipped', carrier: 'usps', trackingNumber: '9400 1000 0000 0000 0000 00' })).json();
  assert.equal(body.status, 'shipped');

  const fields = JSON.parse(patches(calls)[0].body);
  assert.equal(fields.tracking_carrier, 'usps');
  assert.equal(fields.tracking_number, '9400100000000000000000');

  const [email] = emails(calls);
  assert.match(email.subject, /has shipped/);
  assert.match(email.text, /USPS tracking number: 9400100000000000000000/);
  assert.match(email.html, /tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=9400100000000000000000/);
  assert.match(email.text, /Miami, FL 33101/);
});

test('shipping needs a known carrier and a plausible tracking number', async () => {
  mockNetwork({ staff: allStores, order: shippingOrder() });
  assert.equal((await act({ action: 'shipped', carrier: 'pigeon', trackingNumber: '9400100000000000000000' })).status, 400);
  assert.equal((await act({ action: 'shipped', carrier: 'ups', trackingNumber: '<script>' })).status, 400);
});

/* ── Cancel and refund ────────────────────────────────── */

test('cancelling a paid order refunds it in full through Stripe, then emails the customer', async () => {
  const calls = mockNetwork({ order: pickupOrder({ status: 'ready' }) });
  const body = await (await act({ action: 'refund', reason: 'Out of stock' })).json();
  assert.equal(body.status, 'refunded');
  assert.equal(body.refunded, 328);

  const [refund] = refunds(calls);
  assert.equal(refund.headers['Idempotency-Key'], 'refund-LP-20261007-ABCD1234');   /* same key as customer cancellations */
  assert.equal(new URLSearchParams(refund.body).get('payment_intent'), 'pi_test_123');

  const fields = JSON.parse(patches(calls)[0].body);
  assert.equal(fields.status, 'refunded');
  assert.ok(fields.refunded_at && fields.cancelled_at);

  const [email] = emails(calls);
  assert.match(email.subject, /cancelled and refunded/);
  assert.match(email.text, /Reason: Out of stock/);
  assert.match(email.text, /\$328\.00/);
  assert.deepEqual(email.bcc, ['amirsslem679@gmail.com']);
});

test('cancelling a pay-at-pickup order needs no refund', async () => {
  const calls = mockNetwork({ order: pickupOrder({ status: 'placed', stripe_payment_intent: null }) });
  const body = await (await act({ action: 'refund' })).json();
  assert.equal(body.status, 'cancelled');
  assert.equal(body.refunded, null);
  assert.equal(refunds(calls).length, 0);
  assert.doesNotMatch(emails(calls)[0].text, /refund/i);
});

test('a failed refund changes nothing and emails nobody', async () => {
  const calls = mockNetwork({ refund: () => Response.json({ error: { type: 'api_error' } }, { status: 500 }) });
  const response = await act({ action: 'refund' });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /Nothing was changed/);
  assert.equal(patches(calls).length, 0);
  assert.equal(emails(calls).length, 0);
});

test('a refund that cannot be saved alerts the owner', async () => {
  const calls = mockNetwork();
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: 'staff-1', email: 'jane@example.com' });
    if (url.startsWith(`${SUPABASE}/rest/v1/staff`)) return Response.json([{ user_id: 'staff-1', store: 'Perfume World', name: 'Jane' }]);
    if (url.startsWith(`${SUPABASE}/rest/v1/orders`)) {
      return options.method === 'PATCH' ? new Response(null, { status: 500 }) : Response.json([pickupOrder()]);
    }
    if (url === 'https://api.stripe.com/v1/refunds') return Response.json({ id: 're_123' });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    throw new Error(`Unexpected request to ${url}`);
  });
  const response = await act({ action: 'refund' });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /refund went through/);
  const [alert] = emails(calls);
  assert.match(alert.subject, /Refunded order not marked refunded/);
});

/* ── Customer cancellation after hand-over ────────────── */

test("customers can't cancel online once the order has been picked up", async () => {
  const calls = mockNetwork({ order: pickupOrder({ status: 'collected', placed_at: new Date().toISOString() }) });
  const details = { reference: 'LP-20261007-ABCD1234', email: 'customer@example.com', pickupStore: 'Perfume World', placedAt: new Date().toISOString() };
  const response = await cancel({
    request: new Request('https://luxeperfume.uluxe.site/api/cancel-pickup-order', {
      method: 'POST',
      body: JSON.stringify({
        orderReference: details.reference, email: details.email, pickupStore: details.pickupStore,
        placedAt: details.placedAt, cancelToken: await signCancellation(env, details),
        sessionId: 'cs_test_a1B2c3D4e5F6g7H8'
      })
    }),
    env
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /already been picked up/);
  assert.equal(refunds(calls).length, 0);
  assert.equal(emails(calls).length, 0);
});

/* ── Routing ──────────────────────────────────────────── */

test('the worker routes the staff API', async () => {
  mockNetwork();
  const ctx = { waitUntil: () => {} };
  const routed = { ...env, API_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const list = await worker.fetch(listRequest(), routed, ctx);
  assert.equal(list.status, 200);
  const wrongMethod = await worker.fetch(new Request('https://luxeperfume.uluxe.site/api/staff-order-action'), routed, ctx);
  assert.equal(wrongMethod.status, 405);
});
