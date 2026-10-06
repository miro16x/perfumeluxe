import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../lib/email.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
import { signCancellation } from '../lib/cancel-token.js';
afterEach(() => mock.restoreAll());
const env = { RESEND_API_KEY: 'test-key', CANCEL_SIGNING_SECRET: 'test-signing-secret' };
const HOUR_MS = 60 * 60 * 1000;
const details = (overrides = {}) => ({
  orderReference: 'LP-20260914-ABCDEF12', email: 'customer@example.com',
  pickupStore: 'Luxe Fragrances', placedAt: new Date().toISOString(), ...overrides
});
/* A cancellation as the browser sends it: details plus the server-issued token. */
const signed = async (overrides = {}) => {
  const order = details(overrides);
  const cancelToken = await signCancellation(env, {
    reference: order.orderReference, email: order.email, pickupStore: order.pickupStore, placedAt: order.placedAt
  });
  return { ...order, cancelToken };
};
const request = (body = details()) => new Request('https://example.com/api/cancel-pickup-order', {
  method: 'POST', body: JSON.stringify(body)
});
const noNetwork = () => mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network call'); });

test('both endpoints reject missing secrets without contacting Resend', async () => {
  const fetchMock = noNetwork();
  for (const handler of [cancel, pickup]) {
    assert.equal((await handler({ request: request(), env: {} })).status, 503);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('cancellation is unavailable without the signing secret', async () => {
  const fetchMock = noNetwork();
  const response = await cancel({ request: request(await signed()), env: { RESEND_API_KEY: 'test-key' } });
  assert.equal(response.status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('cancellation without a token is rejected', async () => {
  const fetchMock = noNetwork();
  assert.equal((await cancel({ request: request(details()), env })).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('an expired order cannot be reopened by editing placedAt', async () => {
  const fetchMock = noNetwork();
  const old = await signed({ placedAt: new Date(Date.now() - 30 * HOUR_MS).toISOString() });
  assert.equal((await cancel({ request: request(old), env })).status, 409);
  const forged = { ...old, placedAt: new Date().toISOString() };
  assert.equal((await cancel({ request: request(forged), env })).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('a token cannot be reused for another order, email or store', async () => {
  const fetchMock = noNetwork();
  const order = await signed();
  for (const change of [
    { orderReference: 'LP-20260914-0000AAAA' },
    { email: 'someone-else@example.com' },
    { pickupStore: 'Perfume World' },
    { cancelToken: order.cancelToken.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) },
    { cancelToken: await signCancellation({ CANCEL_SIGNING_SECRET: 'wrong-secret' }, {
      reference: order.orderReference, email: order.email, pickupStore: order.pickupStore, placedAt: order.placedAt
    }) }
  ]) {
    assert.equal((await cancel({ request: request({ ...order, ...change }), env })).status, 403, JSON.stringify(change));
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('email case does not affect the token', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ id: 'test-id' }));
  const order = await signed();
  const response = await cancel({ request: request({ ...order, email: 'Customer@Example.com' }), env });
  assert.equal(response.status, 200);
});
test('a placed order can be cancelled with the token it was issued', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ id: 'test-id' }));
  const placed = await (await pickup({
    request: new Request('https://example.com/api/pickup-order', {
      method: 'POST', body: JSON.stringify({
        pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
        phone: '3405550100', pickupDate: '2026-09-20', pickupTime: '12:00 PM',
        items: [{ name: 'Test fragrance', price: 50, qty: 1 }]
      })
    }),
    env
  })).json();
  assert.match(placed.cancelToken, /^[A-Za-z0-9_-]{43}$/);
  const response = await cancel({
    request: request({
      orderReference: placed.orderReference, email: 'customer@example.com', pickupStore: placed.pickupStore,
      placedAt: placed.placedAt, cancelBy: placed.cancelBy, cancelToken: placed.cancelToken, status: 'active'
    }),
    env
  });
  assert.equal(response.status, 200);
});
test('orders placed without the signing secret get no cancel token', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ id: 'test-id' }));
  const placed = await (await pickup({
    request: new Request('https://example.com/api/pickup-order', {
      method: 'POST', body: JSON.stringify({
        pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
        phone: '3405550100', pickupDate: '2026-09-20', pickupTime: '12:00 PM',
        items: [{ name: 'Test fragrance', price: 50, qty: 1 }]
      })
    }),
    env: { RESEND_API_KEY: 'test-key' }
  })).json();
  assert.equal(placed.success, true);
  assert.equal(placed.cancelToken, null);
});
test('cancellation sends store BCC and customer confirmation through Resend', async () => {
  const payloads = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ id: 'test-id' });
  });
  const response = await cancel({ request: request(await signed()), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].bcc, ['amirsslem679@gmail.com']);
  assert.deepEqual(payloads[1].to, ['customer@example.com']);
});
test('cancellation surfaces Resend failure', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }));
  mock.method(console, 'error', () => {});
  assert.equal((await cancel({ request: request(await signed()), env })).status, 502);
});
test('malformed success cannot be mistaken for accepted email', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('invalid JSON'));
  await assert.rejects(sendEmail(env, { from: 'orders@example.com', to: 'customer@example.com', subject: 'Test', text: 'Test' }), { code: 'RESEND_INVALID_RESPONSE' });
});
