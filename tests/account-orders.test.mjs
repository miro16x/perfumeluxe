import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as createOrder } from '../functions/api/pickup-order.js';
import { onRequestPost as cancelOrder } from '../functions/api/cancel-pickup-order.js';
import { signCancellation } from '../lib/cancel-token.js';

const SUPABASE = 'https://bvffpffnyjfufprcdskb.supabase.co';
const order = {
  pickupStore: 'Perfume World', customerName: 'Test Customer',
  email: 'Customer@Example.com', phone: '3405550100',
  pickupDate: '2026-10-05', pickupDateLabel: 'Mon, Oct 5', pickupTime: '12:00 PM',
  items: [{ id: 287, name: 'Eros Eau de Toilette', brand: 'VERSACE', price: 50.5, qty: 2 }]
};
afterEach(() => mock.restoreAll());

/* Records every outbound request; Resend always succeeds, Supabase replies come from `supabase`. */
const mockNetwork = (supabase = {}) => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: `message-${calls.length}` });
    if (String(url).startsWith(`${SUPABASE}/auth/v1/user`)) {
      return supabase.user ? Response.json(supabase.user) : Response.json({ msg: 'invalid JWT' }, { status: 401 });
    }
    if (String(url).startsWith(`${SUPABASE}/rest/v1/orders`)) {
      return new Response(null, { status: supabase.ordersStatus ?? 201 });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  return calls;
};
const supabaseCalls = (calls) => calls.filter((call) => call.url.startsWith(SUPABASE));

const submitOrder = ({ token, env = {} } = {}) => createOrder({
  request: new Request('https://example.com/api/pickup-order', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(order)
  }),
  env: { RESEND_API_KEY: 'test-key', ...env }
});

test('signed-in order is saved to the account with server-calculated totals', async () => {
  const calls = mockNetwork({ user: { id: 'user-123' } });
  const response = await submitOrder({ token: 'user-jwt', env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-key' } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);

  const [verify, insert] = supabaseCalls(calls);
  assert.equal(verify.url, `${SUPABASE}/auth/v1/user`);
  assert.equal(verify.options.headers.Authorization, 'Bearer user-jwt');
  assert.notEqual(verify.options.headers.apikey, 'secret-key');

  assert.equal(insert.url, `${SUPABASE}/rest/v1/orders`);
  assert.equal(insert.options.method, 'POST');
  assert.equal(insert.options.headers.apikey, 'secret-key');
  const saved = JSON.parse(insert.options.body);
  assert.equal(saved.user_id, 'user-123');
  assert.equal(saved.reference, body.orderReference);
  assert.equal(saved.email, 'customer@example.com');
  assert.equal(saved.pickup_store, 'Perfume World');
  assert.equal(saved.pickup_date, 'Mon, Oct 5');
  assert.equal(saved.item_count, 2);
  assert.equal(saved.total, 101);
  assert.deepEqual(saved.items, [{ id: 287, name: 'Eros Eau de Toilette', brand: 'VERSACE', price: 50.5, qty: 2 }]);
});

test('guest order never contacts Supabase', async () => {
  const calls = mockNetwork({ user: { id: 'user-123' } });
  const response = await submitOrder({ env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-key' } });
  assert.equal(response.status, 200);
  assert.equal(supabaseCalls(calls).length, 0);
});

test('missing Supabase secret leaves ordering unchanged', async () => {
  const calls = mockNetwork({ user: { id: 'user-123' } });
  const response = await submitOrder({ token: 'user-jwt' });
  assert.equal(response.status, 200);
  assert.equal(supabaseCalls(calls).length, 0);
});

test('invalid access token saves nothing but still accepts the order', async () => {
  const calls = mockNetwork();
  const response = await submitOrder({ token: 'forged', env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-key' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.deepEqual(supabaseCalls(calls).map((call) => call.url), [`${SUPABASE}/auth/v1/user`]);
});

test('Supabase outage does not fail an order the store already received', async () => {
  mockNetwork({ user: { id: 'user-123' }, ordersStatus: 500 });
  mock.method(console, 'error', () => {});
  const response = await submitOrder({ token: 'user-jwt', env: { SUPABASE_SERVICE_ROLE_KEY: 'secret-key' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test('cancellation marks the matching account order cancelled', async () => {
  const calls = mockNetwork();
  const env = { RESEND_API_KEY: 'test-key', SUPABASE_SERVICE_ROLE_KEY: 'secret-key', CANCEL_SIGNING_SECRET: 'test-signing-secret' };
  const details = {
    reference: 'LP-20261002-AB12CD34', email: 'Customer@Example.com',
    pickupStore: 'Perfume World', placedAt: new Date().toISOString()
  };
  const response = await cancelOrder({
    request: new Request('https://example.com/api/cancel-pickup-order', {
      method: 'POST',
      body: JSON.stringify({
        orderReference: details.reference, email: details.email, pickupStore: details.pickupStore,
        placedAt: details.placedAt, cancelToken: await signCancellation(env, details)
      })
    }),
    env
  });
  assert.equal(response.status, 200);

  const [update] = supabaseCalls(calls);
  assert.equal(update.url, `${SUPABASE}/rest/v1/orders?reference=eq.LP-20261002-AB12CD34&email=eq.customer%40example.com`);
  assert.equal(update.options.method, 'PATCH');
  assert.equal(update.options.headers.apikey, 'secret-key');
  assert.equal(JSON.parse(update.options.body).status, 'cancelled');
});
