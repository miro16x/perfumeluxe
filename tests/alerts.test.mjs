import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { signCancellation } from '../lib/cancel-token.js';
import { alertOwner } from '../lib/alerts.js';

const env = { RESEND_API_KEY: 'test-key', CANCEL_SIGNING_SECRET: 'test-signing-secret' };
const OWNER = 'amirsslem679@gmail.com';
afterEach(() => {
  mock.restoreAll();
  delete globalThis.caches;
});

const order = () => new Request('https://example.com/api/pickup-order', {
  method: 'POST',
  body: JSON.stringify({
    pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
    phone: '3405550100', pickupDate: '2026-09-20', pickupTime: '12:00 PM',
    items: [{ id: 11, size: '50ml', qty: 1 }]
  })
});
/* Resend stand-in: `reject(payload)` decides which emails fail; returns every payload sent. */
const mockResend = (reject) => {
  const payloads = [];
  mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    return reject(payload)
      ? Response.json({ name: 'validation_error' }, { status: 422 })
      : Response.json({ id: 'test-id' });
  });
  return payloads;
};
const alerts = (payloads) => payloads.filter((payload) => payload.from.includes('alerts@'));
/* Minimal Cache API so throttling can be exercised outside Workers. */
const fakeCache = () => {
  const entries = new Map();
  globalThis.caches = { default: {
    match: async (request) => entries.get(request.url),
    put: async (request, response) => { entries.set(request.url, response); }
  } };
};

test('an order the store never received alerts the owner with the full order', async () => {
  const payloads = mockResend((payload) => payload.to.includes('perfumeworldvi@gmail.com'));
  const response = await pickup({ request: order(), env });
  assert.equal(response.status, 502);
  const [alert] = alerts(payloads);
  assert.deepEqual(alert.to, [OWNER]);
  assert.match(alert.subject, /ORDER NOT DELIVERED to Perfume World — LP-/);
  assert.match(alert.text, /Test Customer/);
  assert.match(alert.text, /3405550100/);
  assert.match(alert.text, /Miss Dior Essence · 50ml/);
});

test('every lost order is alerted, even during an outage', async () => {
  fakeCache();
  const payloads = mockResend((payload) => payload.to.includes('perfumeworldvi@gmail.com'));
  await pickup({ request: order(), env });
  await pickup({ request: order(), env });
  assert.equal(alerts(payloads).length, 2);
});

test('a failed customer receipt alerts once, then stays quiet', async () => {
  fakeCache();
  const payloads = mockResend((payload) => payload.to.includes('customer@example.com'));
  assert.equal((await pickup({ request: order(), env })).status, 200);
  assert.equal((await pickup({ request: order(), env })).status, 200);
  const sent = alerts(payloads);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Customer confirmation email failed/);
});

test('a failed cancellation alerts the owner with the order reference', async () => {
  const details = {
    reference: 'LP-20260914-ABCDEF12', email: 'customer@example.com',
    pickupStore: 'Luxe Fragrances', placedAt: new Date().toISOString()
  };
  const payloads = mockResend((payload) => !payload.from.includes('alerts@'));
  const response = await cancel({
    request: new Request('https://example.com/api/cancel-pickup-order', {
      method: 'POST',
      body: JSON.stringify({
        orderReference: details.reference, email: details.email, pickupStore: details.pickupStore,
        placedAt: details.placedAt, cancelToken: await signCancellation(env, details)
      })
    }),
    env
  });
  assert.equal(response.status, 502);
  const [alert] = alerts(payloads);
  assert.match(alert.subject, /CANCELLATION MAY NOT HAVE REACHED Luxe Fragrances — LP-20260914-ABCDEF12/);
});

test('a failing alert never throws', async () => {
  mockResend(() => true);
  await alertOwner(env, undefined, { kind: 'test', subject: 'Test', details: 'Test' });
});
