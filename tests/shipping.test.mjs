import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, shippingCost } from '../lib/shipping.js';
import { onRequestPost as order } from '../functions/api/pickup-order.js';
import { onRequestPost as webhook } from '../functions/api/paypal-webhook.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout-status.js';
import { onRequestGet as checkoutOptions } from '../functions/api/checkout-options.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';

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

const address = { line1: '123 Main St', line2: 'Apt 4', city: 'Miami', state: 'FL', zip: '33101' };

/* ── Rules ────────────────────────────────────────────── */

test('addresses in the 50 states, D.C. and Puerto Rico are accepted', () => {
  assert.deepEqual(normalizeAddress(address), { ...address, country: 'US' });
  assert.equal(normalizeAddress({ ...address, state: 'dc', zip: '20001' }).state, 'DC');
  assert.equal(normalizeAddress({ ...address, state: 'PR', city: 'San Juan', zip: '00901' }).country, 'PR');
  assert.equal(normalizeAddress({ ...address, zip: '33101-1234' }).zip, '33101-1234');
});

test('military, other territories and mismatched ZIP codes are rejected', () => {
  for (const bad of [
    { state: 'AE', zip: '09001' },        /* military */
    { state: 'VI', zip: '00802' },        /* U.S. Virgin Islands */
    { state: 'GU', zip: '96910' },        /* Guam */
    { state: 'PR', zip: '33101' },        /* PR with a Florida ZIP */
    { state: 'FL', zip: '00901' },        /* Florida with a PR ZIP */
    { zip: '3310' },
    { line1: '' },
    { city: '' }
  ]) {
    assert.equal(normalizeAddress({ ...address, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(normalizeAddress(null), null);
});

test('shipping is $15 under $200 and free from $200', () => {
  assert.equal(shippingCost(35), 15);
  assert.equal(shippingCost(199), 15);
  assert.equal(shippingCost(199.99), 15);
  assert.equal(shippingCost(200), 0);
  assert.equal(shippingCost(328), 0);
});

test('checkout options offer shipping only when payments are on', async () => {
  const off = await checkoutOptions({ env: {} }).json();
  assert.deepEqual(off, { payments: false, shipping: null });
  const on = await checkoutOptions({ env }).json();
  assert.equal(on.payments, true);
  assert.equal(on.shipping.fromStore, 'Luxe Fragrances');
  assert.equal(on.shipping.flatRate, 15);
  assert.equal(on.shipping.freeOver, 200);
  assert.equal(on.shipping.states.PR, 'Puerto Rico');
  assert.equal(on.shipping.states.VI, undefined);
});

/* ── Placing a shipping order ─────────────────────────── */

const ORDER_ID = '7S1234567H8901234';
const CAPTURE_ID = '8C123456AB7890123';

/* One fake network: PayPal, Resend and Supabase. `checkout` is what Supabase
   holds for the order while it is paid for. */
const mockNetwork = (checkout = null) => {
  const calls = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === `${PAYPAL}/v1/oauth2/token`) return Response.json({ access_token: 'pp-token', expires_in: 32400 });
    if (url === `${PAYPAL}/v1/notifications/verify-webhook-signature`) return Response.json({ verification_status: 'SUCCESS' });
    if (url === `${PAYPAL}/v2/checkout/orders`) {
      return Response.json({ id: ORDER_ID, links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}` }] });
    }
    if (url === `${PAYPAL}/v2/checkout/orders/${ORDER_ID}`) {
      return Response.json({
        id: ORDER_ID, status: 'COMPLETED',
        purchase_units: [{ reference_id: checkout.reference, custom_id: checkout.reference, payments: { captures: [
          { id: CAPTURE_ID, status: 'COMPLETED', amount: { currency_code: 'USD', value: '179.00' } }
        ] } }]
      });
    }
    if (url === `${PAYPAL}/v2/payments/captures/${CAPTURE_ID}/refund`) return Response.json({ id: 'REFUND123', status: 'COMPLETED' });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
    if (url.startsWith(`${SUPABASE}/rest/v1/checkouts`)) {
      return options.method === 'POST' ? new Response(null, { status: 201 }) : Response.json(checkout ? [checkout] : []);
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/orders`)) return new Response(null, { status: options.method === 'POST' ? 201 : 204 });
    throw new Error(`Unexpected request to ${url}`);
  });
  return calls;
};
const shippingRequest = (overrides = {}) => new Request('https://luxeperfume.uluxe.site/api/pickup-order', {
  method: 'POST',
  body: JSON.stringify({
    fulfillment: 'shipping', pickupStore: 'Perfume World',   /* ignored: shipping is always from Luxe Fragrances */
    customerName: 'Test Customer', email: 'customer@example.com', phone: '3055550100',
    shippingAddress: address, items: [{ id: 11, size: '50ml', qty: 1 }], ...overrides
  })
});
const paypalOrder = (calls) => JSON.parse(calls.find((call) => call.url === `${PAYPAL}/v2/checkout/orders`).body);
const savedDetails = (calls) => JSON.parse(calls.find((call) => call.url === `${SUPABASE}/rest/v1/checkouts`).body).details;

test('a shipping order under $200 charges $15 shipping and gives PayPal the address', async () => {
  const calls = mockNetwork();
  const response = await order({ request: shippingRequest(), env });
  assert.equal(response.status, 200);
  const { purchase_units: [unit], payment_source: { paypal } } = paypalOrder(calls);
  assert.equal(unit.amount.value, '179.00');
  assert.equal(unit.amount.breakdown.shipping.value, '15.00');
  assert.equal(unit.shipping.name.full_name, 'Test Customer');
  assert.equal(unit.shipping.address.admin_area_1, 'FL');
  assert.equal(unit.shipping.address.postal_code, '33101');
  assert.equal(unit.shipping.address.country_code, 'US');
  assert.equal(paypal.experience_context.shipping_preference, 'SET_PROVIDED_ADDRESS');
  const details = savedDetails(calls);
  assert.equal(details.fulfillment, 'shipping');
  assert.equal(details.pickupStore, 'Luxe Fragrances');
  assert.equal(details.shippingCost, 15);
  assert.equal(details.shippingAddress.zip, '33101');
  assert.equal(calls.filter((call) => call.url.includes('resend')).length, 0);
});

test('a shipping order of $200 or more ships free', async () => {
  const calls = mockNetwork();
  await order({ request: shippingRequest({ items: [{ id: 11, size: '50ml', qty: 2 }] }), env });   /* $328 */
  const { purchase_units: [unit] } = paypalOrder(calls);
  assert.equal(unit.amount.value, '328.00');
  assert.equal(unit.amount.breakdown.shipping.value, '0.00');
});

test('a Puerto Rico address is sent to PayPal as country PR', async () => {
  const calls = mockNetwork();
  await order({ request: shippingRequest({ shippingAddress: { ...address, state: 'PR', city: 'San Juan', zip: '00901' } }), env });
  assert.equal(paypalOrder(calls).purchase_units[0].shipping.address.country_code, 'PR');
});

test('shipping needs online payment and a valid address', async () => {
  const calls = mockNetwork();
  const { PAYPAL_CLIENT_SECRET, ...noPayPal } = env;
  assert.equal((await order({ request: shippingRequest(), env: noPayPal })).status, 409);
  assert.equal((await order({ request: shippingRequest({ shippingAddress: { ...address, state: 'VI', zip: '00802' } }), env })).status, 400);
  assert.equal((await order({ request: shippingRequest({ shippingAddress: undefined }), env })).status, 400);
  assert.equal(calls.length, 0);
});

/* ── After payment ────────────────────────────────────── */

const shippingCheckout = () => ({
  reference: 'LP-20261007-5A1B1234',
  paypal_order_id: ORDER_ID,
  details: {
    customerName: 'Test Customer', customerEmail: 'customer@example.com', phone: '3055550100',
    pickupStore: 'Luxe Fragrances', pickupDate: '', pickupTime: '', fulfillment: 'shipping',
    shippingAddress: { line1: '123 Main St', line2: 'Apt 4', city: 'Miami', state: 'FL', zip: '33101', country: 'US' },
    shippingCost: 15, total: 179, placedAt: new Date().toISOString(), userId: null,
    items: [{ id: 11, name: 'Miss Dior Essence', brand: 'DIOR', size: '50ml', price: 164, qty: 1 }]
  }
});

const webhookRequest = () => new Request('https://x/api/paypal-webhook', {
  method: 'POST',
  headers: {
    'PayPal-Auth-Algo': 'SHA256withRSA', 'PayPal-Cert-Url': 'https://api.paypal.com/v1/notifications/certs/CERT',
    'PayPal-Transmission-Id': 'id', 'PayPal-Transmission-Sig': 'sig', 'PayPal-Transmission-Time': '2026-10-07T12:00:00Z'
  },
  body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } } })
});
const statusRequest = () => new Request(`https://x/api/checkout-status?token=${ORDER_ID}`);
const emails = (calls) => calls.filter((call) => call.url === 'https://api.resend.com/emails').map((call) => JSON.parse(call.body));

test('a paid shipping order goes to Luxe Fragrances with the address and a ship-after time', async () => {
  const calls = mockNetwork(shippingCheckout());
  const response = await webhook({ request: webhookRequest(), env });
  assert.equal(response.status, 200);

  const row = JSON.parse(calls.find((call) => call.method === 'POST' && call.url.endsWith('/orders')).body);
  assert.equal(row.fulfillment, 'shipping');
  assert.equal(row.pickup_store, 'Luxe Fragrances');
  assert.equal(row.pickup_date, null);
  assert.equal(row.shipping_cost, 15);
  assert.equal(row.total, 179);
  assert.deepEqual(row.shipping_address, { line1: '123 Main St', line2: 'Apt 4', city: 'Miami', state: 'FL', zip: '33101', country: 'US' });

  const [storeEmail, customerEmail] = emails(calls);
  assert.deepEqual(storeEmail.to, ['luxefragrances.vi@gmail.com']);
  assert.match(storeEmail.subject, /New Shipping Order \(PAID\)/);
  assert.match(storeEmail.text, /SHIP TO:\nTest Customer\n123 Main St\nApt 4\nMiami, FL 33101/);
  assert.match(storeEmail.text, /PAID ONLINE: \$179\.00 \(including \$15\.00 shipping\)/);
  assert.match(storeEmail.text, /Please ship after that time/);
  assert.match(customerEmail.text, /Items: \$164\.00\nShipping: \$15\.00\nTotal: \$179\.00/);
  assert.doesNotMatch(customerEmail.text, /photo ID|Pickup:/);
});

test('the confirmation screen gets the shipping details', async () => {
  mockNetwork(shippingCheckout());
  const body = await (await checkoutStatus({ request: statusRequest(), env })).json();
  assert.equal(body.fulfillment, 'shipping');
  assert.equal(body.shippingAddress.city, 'Miami');
  assert.equal(body.shippingCost, 15);
  assert.equal(body.total, 179);
});

test('cancelling a shipping order refunds it and tells the store not to ship', async () => {
  const calls = mockNetwork(shippingCheckout());
  const status = await (await checkoutStatus({ request: statusRequest(), env })).json();
  const response = await cancel({
    request: new Request('https://x/api/cancel-pickup-order', {
      method: 'POST',
      body: JSON.stringify({
        orderReference: status.orderReference, email: status.email, pickupStore: status.pickupStore,
        placedAt: status.placedAt, cancelToken: status.cancelToken, paymentId: status.paymentId
      })
    }),
    env
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).refunded, 179);
  const [storeEmail, customerEmail] = emails(calls);
  assert.match(storeEmail.subject, /Shipping order cancellation \(refunded\)/);
  assert.match(storeEmail.text, /Do not ship this order\./);
  assert.match(customerEmail.text, /cancel shipping order LP-20261007-5A1B1234/);
});
