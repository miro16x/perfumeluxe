import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, shippingCost } from '../lib/shipping.js';
import { onRequestPost as order } from '../functions/api/pickup-order.js';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout-status.js';
import { onRequestGet as checkoutOptions } from '../functions/api/checkout-options.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const env = {
  RESEND_API_KEY: 'test-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
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

const mockNetwork = (session) => {
  const calls = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    url = String(url);
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') return Response.json({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' });
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return Response.json(session);
    if (url === 'https://api.stripe.com/v1/refunds') return Response.json({ id: 're_123' });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'email-id' });
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
const sessionForm = (calls) => new URLSearchParams(calls.find((call) => call.url === 'https://api.stripe.com/v1/checkout/sessions').body);

test('a shipping order under $200 charges $15 shipping and records the address with Stripe', async () => {
  const calls = mockNetwork();
  const response = await order({ request: shippingRequest(), env });
  assert.equal(response.status, 200);
  const form = sessionForm(calls);
  assert.equal(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '1500');
  assert.equal(form.get('shipping_options[0][shipping_rate_data][display_name]'), 'Standard shipping');
  assert.equal(form.get('payment_intent_data[shipping][address][state]'), 'FL');
  assert.equal(form.get('payment_intent_data[shipping][address][country]'), 'US');
  assert.equal(form.get('payment_intent_data[shipping][name]'), 'Test Customer');
  assert.equal(form.get('metadata[fulfillment]'), 'shipping');
  assert.equal(form.get('metadata[pickupStore]'), 'Luxe Fragrances');
  assert.equal(form.get('metadata[shipZip]'), '33101');
  assert.equal(calls.filter((call) => call.url.includes('resend')).length, 0);
});

test('a shipping order of $200 or more ships free', async () => {
  const calls = mockNetwork();
  await order({ request: shippingRequest({ items: [{ id: 11, size: '50ml', qty: 2 }] }), env });   /* $328 */
  const form = sessionForm(calls);
  assert.equal(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '0');
  assert.equal(form.get('shipping_options[0][shipping_rate_data][display_name]'), 'Free shipping');
});

test('shipping needs online payment and a valid address', async () => {
  const calls = mockNetwork();
  const { STRIPE_SECRET_KEY, ...noStripe } = env;
  assert.equal((await order({ request: shippingRequest(), env: noStripe })).status, 409);
  assert.equal((await order({ request: shippingRequest({ shippingAddress: { ...address, state: 'VI', zip: '00802' } }), env })).status, 400);
  assert.equal((await order({ request: shippingRequest({ shippingAddress: undefined }), env })).status, 400);
  assert.equal(calls.length, 0);
});

/* ── After payment ────────────────────────────────────── */

const paidShippingSession = () => ({
  id: 'cs_test_s1H2i3P4p5I6n7G8',
  payment_status: 'paid',
  amount_total: 17900,
  shipping_cost: { amount_total: 1500 },
  customer_email: 'customer@example.com',
  payment_intent: 'pi_test_ship',
  metadata: {
    reference: 'LP-20261007-5A1B1234', customerName: 'Test Customer', phone: '3055550100',
    pickupStore: 'Luxe Fragrances', placedAt: new Date().toISOString(), fulfillment: 'shipping',
    shipLine1: '123 Main St', shipLine2: 'Apt 4', shipCity: 'Miami', shipState: 'FL', shipZip: '33101'
  },
  line_items: { data: [{
    quantity: 1,
    price: { unit_amount: 16400, product: { name: 'Miss Dior Essence · 50ml', description: 'DIOR', metadata: { productId: '11', size: '50ml', brand: 'DIOR' } } }
  }] }
});

async function signedWebhook(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))).toString('hex');
  return new Request('https://x/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body });
}
const emails = (calls) => calls.filter((call) => call.url === 'https://api.resend.com/emails').map((call) => JSON.parse(call.body));

test('a paid shipping order goes to Luxe Fragrances with the address and a ship-after time', async () => {
  const calls = mockNetwork(paidShippingSession());
  const response = await webhook({ request: await signedWebhook({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_s1H2i3P4p5I6n7G8' } } }), env });
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
  mockNetwork(paidShippingSession());
  const body = await (await checkoutStatus({ request: new Request('https://x/api/checkout-status?session_id=cs_test_s1H2i3P4p5I6n7G8'), env })).json();
  assert.equal(body.fulfillment, 'shipping');
  assert.equal(body.shippingAddress.city, 'Miami');
  assert.equal(body.shippingCost, 15);
  assert.equal(body.total, 179);
});

test('cancelling a shipping order refunds it and tells the store not to ship', async () => {
  const calls = mockNetwork(paidShippingSession());
  const status = await (await checkoutStatus({ request: new Request('https://x/api/checkout-status?session_id=cs_test_s1H2i3P4p5I6n7G8'), env })).json();
  const response = await cancel({
    request: new Request('https://x/api/cancel-pickup-order', {
      method: 'POST',
      body: JSON.stringify({
        orderReference: status.orderReference, email: status.email, pickupStore: status.pickupStore,
        placedAt: status.placedAt, cancelToken: status.cancelToken, sessionId: status.sessionId
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
