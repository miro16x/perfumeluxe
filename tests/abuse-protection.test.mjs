import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
import worker from '../worker.js';
afterEach(() => mock.restoreAll());

const env = { RESEND_API_KEY: 'test-key', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const order = (overrides = {}) => new Request('https://example.com/api/pickup-order', {
  method: 'POST',
  headers: { 'CF-Connecting-IP': '203.0.113.7' },
  body: JSON.stringify({
    pickupStore: 'Perfume World', customerName: 'Test Customer', email: 'customer@example.com',
    phone: '3405550100', pickupDate: '2026-09-20', pickupTime: '12:00 PM',
    items: [{ id: 11, size: '50ml', qty: 1 }], ...overrides
  })
});
/* Turnstile answers with `siteverify`; Resend accepts every email. */
const mockNetwork = (siteverify) => mock.method(globalThis, 'fetch', async (url, options) => {
  if (url === SITEVERIFY) return siteverify(options.body);
  return Response.json({ id: 'test-id' });
});
const resendPayloads = (fetchMock) => fetchMock.mock.calls
  .filter((call) => call.arguments[0] !== SITEVERIFY)
  .map((call) => JSON.parse(call.arguments[1].body));
const isAlert = (payload) => payload.from.includes('alerts@');
const emailsSent = (fetchMock) => resendPayloads(fetchMock).filter((payload) => !isAlert(payload)).length;
const alertsSent = (fetchMock) => resendPayloads(fetchMock).filter(isAlert);

test('an order without a Turnstile token is rejected before any email', async () => {
  const fetchMock = mockNetwork(() => Response.json({ success: true, action: 'pickup-order', hostname: 'luxeperfume.uluxe.site' }));
  assert.equal((await pickup({ request: order(), env })).status, 403);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('a verified Turnstile token lets the order through', async () => {
  let sent;
  const fetchMock = mockNetwork((body) => {
    sent = body;
    return Response.json({ success: true, action: 'pickup-order', hostname: 'luxeperfume.uluxe.site' });
  });
  const response = await pickup({ request: order({ turnstileToken: 'good-token' }), env });
  assert.equal(response.status, 200);
  assert.equal(sent.get('secret'), 'test-turnstile-secret');
  assert.equal(sent.get('response'), 'good-token');
  assert.equal(sent.get('remoteip'), '203.0.113.7');
  assert.equal(emailsSent(fetchMock), 2);
});

test('failed, mismatched or unreachable verification blocks the order', async () => {
  for (const siteverify of [
    () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    () => Response.json({ success: true, action: 'some-other-form', hostname: 'luxeperfume.uluxe.site' }),
    () => Response.json({ success: true, action: 'pickup-order', hostname: 'other.uluxe.site' }),
    () => new Response('Service unavailable', { status: 503 }),
    () => { throw new TypeError('network down'); }
  ]) {
    mock.method(console, 'error', () => {});
    const fetchMock = mockNetwork(siteverify);
    assert.equal((await pickup({ request: order({ turnstileToken: 'token' }), env })).status, 403);
    assert.equal(emailsSent(fetchMock), 0);
    mock.restoreAll();
  }
});

test('a bot rejection does not alert the owner, a broken secret or outage does', async () => {
  for (const [siteverify, alerts] of [
    [() => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }), 0],
    [() => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }), 1],
    [() => new Response('Service unavailable', { status: 503 }), 1]
  ]) {
    mock.method(console, 'error', () => {});
    const fetchMock = mockNetwork(siteverify);
    await pickup({ request: order({ turnstileToken: 'token' }), env });
    const sent = alertsSent(fetchMock);
    assert.equal(sent.length, alerts);
    if (alerts) {
      assert.deepEqual(sent[0].to, ['amirsslem679@gmail.com']);
      assert.match(sent[0].subject, /blocked by the bot check/);
    }
    mock.restoreAll();
  }
});

test('orders work without Turnstile until the secret is configured', async () => {
  mockNetwork(() => { throw new Error('Turnstile should not be called'); });
  const response = await pickup({ request: order(), env: { RESEND_API_KEY: 'test-key' } });
  assert.equal(response.status, 200);
});

test('the Worker returns 429 once a visitor exceeds the rate limit', async () => {
  const fetchMock = mockNetwork(() => Response.json({ success: true, action: 'pickup-order', hostname: 'luxeperfume.uluxe.site' }));
  const keys = [];
  const API_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const response = await worker.fetch(order({ turnstileToken: 'token' }), { ...env, API_RATE_LIMITER }, { waitUntil() {} });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(keys, ['/api/pickup-order:203.0.113.7']);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('the rate limiter does not touch page requests', async () => {
  const API_RATE_LIMITER = { limit: async () => { throw new Error('should not be called'); } };
  const ASSETS = { fetch: async () => new Response('page') };
  const response = await worker.fetch(new Request('https://example.com/shop.html'), { API_RATE_LIMITER, ASSETS }, { waitUntil() {} });
  assert.equal(await response.text(), 'page');
});
