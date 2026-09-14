import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../lib/email.js';
import { onRequestPost as cancel } from '../functions/api/cancel-pickup-order.js';
import { onRequestPost as pickup } from '../functions/api/pickup-order.js';
afterEach(() => mock.restoreAll());
const env = { RESEND_API_KEY: 'test-key' };
const request = () => new Request('https://example.com/api/cancel-pickup-order', {
  method: 'POST', body: JSON.stringify({
    orderReference: 'LP-20260914-ABCDEF12', email: 'customer@example.com',
    pickupStore: 'Luxe Fragrances', placedAt: new Date().toISOString()
  })
});
test('both endpoints reject missing secrets without contacting Resend', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network call'); });
  for (const handler of [cancel, pickup]) {
    assert.equal((await handler({ request: request(), env: {} })).status, 503);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
test('cancellation sends store BCC and customer confirmation through Resend', async () => {
  const payloads = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return Response.json({ id: 'test-id' });
  });
  const response = await cancel({ request: request(), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].bcc, ['amirslem679@gmail.com']);
  assert.deepEqual(payloads[1].to, ['customer@example.com']);
});
test('cancellation surfaces Resend failure', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }));
  assert.equal((await cancel({ request: request(), env })).status, 502);
});
test('malformed success cannot be mistaken for accepted email', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('invalid JSON'));
  await assert.rejects(sendEmail(env, { from: 'orders@example.com', to: 'customer@example.com', subject: 'Test', text: 'Test' }), { code: 'RESEND_INVALID_RESPONSE' });
});
