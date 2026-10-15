import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as listOrders } from '../functions/api/staff-orders.js';
import { onRequestPost as orderAction } from '../functions/api/staff-order-action.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { signCancellation } from '../lib/cancel-token.js';
import worker from '../worker.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const PAYPAL = 'https://api-m.sandbox.paypal.com';
const REFUND_URL = `${PAYPAL}/v2/payments/captures/3C679366HH908993F/refund`;
const TRACK_URL = `${PAYPAL}/v2/checkout/orders/5O190127TN364715T/track`;
const env = {
  RESEND_API_KEY: 'test-key',
  PAYPAL_CLIENT_ID: 'pp-client',
  PAYPAL_CLIENT_SECRET: 'pp-secret',
  PAYPAL_WEBHOOK_ID: 'WH-TEST-123',
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
  paypal_order_id: '5O190127TN364715T',
  paypal_capture_id: '3C679366HH908993F',
  ...overrides
});
const shippingOrder = (overrides = {}) => pickupOrder({
  fulfillment: 'shipping', pickup_store: 'Luxe Fragrances', pickup_date: null, pickup_time: null,
  shipping_address: { line1: '1 Main St', line2: '', city: 'Miami', state: 'FL', zip: '33101', country: 'US' },
  shipping_cost: 0, ...overrides
});

/* One fake network: Supabase auth, staff and orders tables, PayPal refunds and Resend. */
const mockNetwork = ({ user = { id: 'staff-1', email: 'jane@example.com' }, staff = { user_id: 'staff-1', store: 'Perfume World', name: 'Jane' }, order = pickupOrder(), patched = true, refund = () => Response.json({ id: 'REFUND123', status: 'COMPLETED' }), track = () => Response.json({ id: '5O190127TN364715T', status: 'COMPLETED' }) } = {}) => {
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
    if (url === `${PAYPAL}/v1/oauth2/token`) return Response.json({ access_token: 'pp-token', expires_in: 32400 });
    if (url === REFUND_URL) return refund(call);
    if (url === TRACK_URL) return track(call);
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    throw new Error(`Unexpected request to ${url}`);
  });
  return calls;
};
const emails = (calls) => calls.filter((call) => call.url === 'https://api.resend.com/emails').map((call) => JSON.parse(call.body));
const patches = (calls) => calls.filter((call) => call.method === 'PATCH');
const refunds = (calls) => calls.filter((call) => call.url === REFUND_URL);

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

test('store staff see only their store and open orders, without PayPal ids', async () => {
  const calls = mockNetwork();
  const response = await listOrders({ request: listRequest(), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.staff, { name: 'Jane', store: 'Perfume World' });

  const list = calls.find((call) => call.url.startsWith(`${SUPABASE}/rest/v1/orders`));
  assert.match(list.url, /pickup_store=eq\.Perfume%20World/);
  assert.match(list.url, /status=in\.\(placed,paid,ready\)/);
  assert.doesNotMatch(list.url, /paypal|user_id/);
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

  /* PayPal gets the same tracking, for the order's captured payment. */
  assert.equal(body.paypalTracking, true);
  const [track] = calls.filter((call) => call.url === TRACK_URL);
  assert.deepEqual(JSON.parse(track.body), {
    capture_id: '3C679366HH908993F', tracking_number: '9400100000000000000000', carrier: 'USPS', notify_payer: false
  });
});

test('each carrier is sent to PayPal under its PayPal code', async () => {
  for (const [carrier, code] of [['ups', 'UPS'], ['fedex', 'FEDEX'], ['dhl', 'DHL']]) {
    const calls = mockNetwork({ staff: allStores, order: shippingOrder() });
    await act({ action: 'shipped', carrier, trackingNumber: '1Z999AA10123456784' });
    assert.equal(JSON.parse(calls.find((call) => call.url === TRACK_URL).body).carrier, code);
    mock.restoreAll();
  }
});

test('if PayPal refuses the tracking, the order still ships and the owner is told to add it by hand', async () => {
  const calls = mockNetwork({
    staff: allStores, order: shippingOrder(),
    track: () => Response.json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_CARRIER' }] }, { status: 422 })
  });
  const body = await (await act({ action: 'shipped', carrier: 'usps', trackingNumber: '9400 1000 0000 0000 0000 00' })).json();
  assert.equal(body.success, true);
  assert.equal(body.status, 'shipped');
  assert.equal(body.paypalTracking, false);
  const [alert, customerEmail] = [
    emails(calls).find((email) => email.from.includes('alerts@')),
    emails(calls).find((email) => !email.from.includes('alerts@'))
  ];
  assert.match(alert.subject, /Tracking not sent to PayPal — LP-20261007-ABCD1234/);
  assert.match(alert.text, /INVALID_CARRIER/);
  assert.match(customerEmail.subject, /has shipped/);
});

test('an order with no PayPal payment sends no tracking to PayPal', async () => {
  const calls = mockNetwork({ staff: allStores, order: shippingOrder({ paypal_order_id: null, paypal_capture_id: null }) });
  const body = await (await act({ action: 'shipped', carrier: 'usps', trackingNumber: '9400 1000 0000 0000 0000 00' })).json();
  assert.equal(body.status, 'shipped');
  assert.equal(body.paypalTracking, null);
  assert.ok(!calls.some((call) => call.url === TRACK_URL));
});

test('shipping needs a known carrier and a plausible tracking number', async () => {
  mockNetwork({ staff: allStores, order: shippingOrder() });
  assert.equal((await act({ action: 'shipped', carrier: 'pigeon', trackingNumber: '9400100000000000000000' })).status, 400);
  assert.equal((await act({ action: 'shipped', carrier: 'ups', trackingNumber: '<script>' })).status, 400);
});

/* ── Cancel and refund ────────────────────────────────── */

test('cancelling a paid order refunds it in full through PayPal, then emails the customer', async () => {
  const calls = mockNetwork({ order: pickupOrder({ status: 'ready' }) });
  const body = await (await act({ action: 'refund', reason: 'Out of stock' })).json();
  assert.equal(body.status, 'refunded');
  assert.equal(body.refunded, 328);

  const [refund] = refunds(calls);
  assert.equal(refund.headers['PayPal-Request-Id'], 'refund-LP-20261007-ABCD1234');   /* same key as customer cancellations */
  assert.equal(refund.body, '{}');   /* no amount: refund in full */

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
  const calls = mockNetwork({ order: pickupOrder({ status: 'placed', paypal_capture_id: null }) });
  const body = await (await act({ action: 'refund' })).json();
  assert.equal(body.status, 'cancelled');
  assert.equal(body.refunded, null);
  assert.equal(refunds(calls).length, 0);
  assert.doesNotMatch(emails(calls)[0].text, /refund/i);
});

test('a failed refund changes nothing and emails nobody', async () => {
  const calls = mockNetwork({ refund: () => Response.json({ name: 'INTERNAL_SERVER_ERROR' }, { status: 500 }) });
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
    if (url === `${PAYPAL}/v1/oauth2/token`) return Response.json({ access_token: 'pp-token', expires_in: 32400 });
    if (url === REFUND_URL) return Response.json({ id: 'REFUND123', status: 'COMPLETED' });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    throw new Error(`Unexpected request to ${url}`);
  });
  const response = await act({ action: 'refund' });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /refund went through/);
  const [alert] = emails(calls);
  assert.match(alert.subject, /Refund not recorded — LP-20261007-ABCD1234/);
  assert.match(alert.text, /Set its status to refunded by hand/);
});

/* ── Refunding some items ─────────────────────────────── */

const twoItemOrder = (overrides = {}) => pickupOrder({
  items: [
    { id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 1 },
    { id: 20, name: 'Eros', brand: 'VERSACE', size: '100ml', price: 95, qty: 2 }
  ],
  item_count: 3, total: 354, refunded_amount: 0, ...overrides
});

test('refunding one item refunds just its price through PayPal and tells the customer', async () => {
  const calls = mockNetwork({ order: twoItemOrder({ status: 'ready' }) });
  const body = await (await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }], reason: 'Out of stock' })).json();
  assert.equal(body.success, true);
  assert.equal(body.status, 'ready');   /* the rest of the order goes ahead */
  assert.equal(body.refunded, 95);

  const [refund] = refunds(calls);
  assert.deepEqual(JSON.parse(refund.body), { amount: { currency_code: 'USD', value: '95.00' }, note_to_payer: 'Out of stock' });
  assert.match(refund.headers['PayPal-Request-Id'], /^refund-LP-20261007-ABCD1234-[0-9a-f]{16}$/);

  const [patch] = patches(calls);
  assert.match(patch.url, /status=in\.\(paid,ready\)&refunded_amount=eq\.0&/);   /* nobody refunded in between */
  const fields = JSON.parse(patch.body);
  assert.equal(fields.refunded_amount, 95);
  assert.equal(fields.items[0].refunded_qty, undefined);
  assert.equal(fields.items[1].refunded_qty, 1);
  assert.equal(fields.status, undefined);

  const [email] = emails(calls);
  assert.match(email.subject, /Part of your order has been refunded — LP-20261007-ABCD1234/);
  assert.match(email.text, /- 1× VERSACE · Eros · 100ml: \$95\.00/);
  assert.match(email.text, /Reason: Out of stock/);
  assert.match(email.text, /A refund of \$95\.00 has been issued/);
  assert.match(email.text, /The rest of your order is ready for pickup at Perfume World/);
  assert.deepEqual(email.bcc, ['amirsslem679@gmail.com']);
});

test('a double click asks PayPal for the same refund, so it is made only once', async () => {
  const calls = mockNetwork({ order: twoItemOrder() });
  await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] });
  await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] });
  const [first, second] = refunds(calls);
  assert.equal(first.headers['PayPal-Request-Id'], second.headers['PayPal-Request-Id']);

  /* A later refund of the second bottle is a different refund. */
  mock.restoreAll();
  const later = mockNetwork({ order: twoItemOrder({ items: twoItemOrder().items.map((item, i) => (i === 1 ? { ...item, refunded_qty: 1 } : item)), refunded_amount: 95 }) });
  await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] });
  assert.notEqual(refunds(later)[0].headers['PayPal-Request-Id'], first.headers['PayPal-Request-Id']);
  assert.match(patches(later)[0].url, /refunded_amount=eq\.95&/);
  assert.equal(JSON.parse(patches(later)[0].body).refunded_amount, 190);
});

test('item refunds that are impossible or not needed are refused before any money moves', async () => {
  const calls = mockNetwork({ order: twoItemOrder() });
  for (const [items, status] of [
    [[{ index: 0, qty: 1 }, { index: 1, qty: 2 }], 409],   /* everything: use Cancel & refund */
    [[{ index: 1, qty: 3 }], 400],                         /* more than were ordered */
    [[{ index: 1, qty: 1 }, { index: 1, qty: 1 }], 400],   /* same line twice */
    [[{ index: 5, qty: 1 }], 400],
    [[{ index: 0, qty: 0 }], 400],
    [[{ index: 0, qty: 1.5 }], 400],
    [[], 400],
    ['all', 400]
  ]) {
    assert.equal((await act({ action: 'refund-items', items })).status, status, JSON.stringify(items));
  }
  assert.match((await (await act({ action: 'refund-items', items: [{ index: 0, qty: 1 }, { index: 1, qty: 2 }] })).json()).message, /Cancel & refund/);
  mock.restoreAll();

  const unpaid = mockNetwork({ order: twoItemOrder({ status: 'ready', paypal_capture_id: null }) });
  assert.equal((await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] })).status, 409);
  mock.restoreAll();
  const shipped = mockNetwork({ order: twoItemOrder({ status: 'collected' }) });
  assert.equal((await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] })).status, 409);

  assert.equal([...refunds(calls), ...refunds(unpaid), ...refunds(shipped)].length, 0);
  assert.equal([...patches(calls), ...patches(unpaid), ...patches(shipped)].length, 0);
});

test('a failed item refund changes nothing and emails nobody', async () => {
  const calls = mockNetwork({ order: twoItemOrder(), refund: () => Response.json({ name: 'UNPROCESSABLE_ENTITY' }, { status: 422 }) });
  const response = await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /Nothing was changed/);
  assert.equal(patches(calls).length, 0);
  assert.equal(emails(calls).length, 0);
});

test('if someone else changed the order while the refund went through, the owner is told what to record', async () => {
  const calls = mockNetwork({ order: twoItemOrder(), patched: false });
  const response = await act({ action: 'refund-items', items: [{ index: 1, qty: 1 }] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /refund went through/);
  const [alert] = emails(calls);
  assert.match(alert.subject, /Refund not recorded — LP-20261007-ABCD1234/);
  assert.match(alert.text, /add 95\.00 to refunded_amount/);
  assert.match(alert.text, /1× Eros 100ml/);
});

test('cancelling after an item refund refunds only what is left', async () => {
  const calls = mockNetwork({ order: twoItemOrder({ items: twoItemOrder().items.map((item, i) => (i === 1 ? { ...item, refunded_qty: 1 } : item)), refunded_amount: 95 }) });
  const body = await (await act({ action: 'refund' })).json();
  assert.equal(body.refunded, 259);
  assert.equal(refunds(calls)[0].body, '{}');   /* PayPal refunds whatever is left */
  const fields = JSON.parse(patches(calls)[0].body);
  assert.equal(fields.status, 'refunded');
  assert.equal(fields.refunded_amount, 354);
  assert.match(emails(calls)[0].text, /A refund of the remaining \$259\.00 has been issued/);
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
        paymentId: '5O190127TN364715T'
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

test('a rejected Supabase key is explained to staff and alerts the owner', async () => {
  const calls = mockNetwork();
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: 'staff-1', email: 'jane@example.com' });
    if (url.startsWith(`${SUPABASE}/rest/v1/staff`)) return Response.json({ message: 'Invalid API key' }, { status: 401 });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    throw new Error(`Unexpected request to ${url}`);
  });
  const response = await listOrders({ request: listRequest(), env });
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /rejected the server's key/);
  const [alert] = emails(calls);
  assert.match(alert.subject, /Supabase is rejecting the Worker secret key/);
});

test('the activity chart data comes in the same request, without customer details', async () => {
  const calls = mockNetwork();
  const body = await (await listOrders({ request: listRequest('open&activity=1'), env })).json();
  assert.equal(body.activity.days, 14);
  assert.ok(Array.isArray(body.activity.orders));

  const lists = calls.filter((call) => call.url.startsWith(`${SUPABASE}/rest/v1/orders`));
  assert.equal(lists.length, 2);
  const activity = lists.find((call) => call.url.includes('placed_at=gte.'));
  assert.match(activity.url, /pickup_store=eq\.Perfume%20World/);
  assert.match(activity.url, /select=reference,status,fulfillment,pickup_store,total,refunded_amount,placed_at,shipped_at,collected_at&/);
  assert.doesNotMatch(activity.url, /email|phone|customer_name/);
});

test('unknown views are refused', async () => {
  mockNetwork();
  assert.equal((await listOrders({ request: listRequest('toString'), env })).status, 400);
});
