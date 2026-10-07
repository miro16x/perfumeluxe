import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/pickup-order.js';

const order = {
  pickupStore: 'Luxe Fragrances', customerName: 'Test Customer',
  email: 'customer@example.com', phone: '3405550100',
  pickupDate: '2026-09-20', pickupTime: '12:00 PM',
  /* The browser's name, brand and price are ignored; id 239 is a DOLCE & GABBANA fragrance. */
  items: [{ id: 239, name: '<b>Fake</b>', brand: 'Fake & <House>', price: 1, qty: 1 }]
};
afterEach(() => mock.restoreAll());
const submit = (send) => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.from, 'Luxe Perfume Pickup <orders@luxeperfume.uluxe.site>');
    assert.ok(payload.reply_to);
    try {
      const result = await send({ ...payload, to: payload.to[0] });
      return Response.json({ id: result.messageId });
    } catch {
      return Response.json({ name: 'validation_error' }, { status: 403 });
    }
  });
  return onRequestPost({
  request: new Request('https://example.com/api/pickup-order', {
    method: 'POST', body: JSON.stringify(order)
  }), env: { RESEND_API_KEY: 'test-key' }
});
};

test('successful order sends store notification before customer receipt', async () => {
  const recipients = [];
  const messages = [];
  const response = await submit(async (message) => {
    recipients.push(message.to);
    messages.push(message);
    return { messageId: `message-${recipients.length}` };
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.customerEmailSent, true);
  assert.deepEqual(body.messageIds, ['message-1', 'message-2']);
  assert.deepEqual(recipients, ['luxefragrances.vi@gmail.com', order.email]);
  for (const message of messages) {
    assert.match(message.html, />Brand<\/th>/);
    assert.ok(message.html.includes('DOLCE &amp; GABBANA'));
    assert.ok(message.text.includes('Brand: DOLCE & GABBANA'));
    assert.ok(!message.html.includes('Fake') && !message.text.includes('$1.00'));
    assert.match(message.text, /Payment due at pickup|Total due at pickup/);
  }
});

test('unknown products, sizes and quantities are rejected before any email', async () => {
  for (const items of [
    [{ id: 999999, qty: 1 }],
    [{ id: 239, size: '9000ml', qty: 1 }],
    [{ id: 239, qty: 0 }],
    [{ id: 239, qty: 1.5 }],
    []
  ]) {
    const fetchMock = mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network call'); });
    const response = await onRequestPost({
      request: new Request('https://example.com/api/pickup-order', { method: 'POST', body: JSON.stringify({ ...order, items }) }),
      env: { RESEND_API_KEY: 'test-key' }
    });
    assert.equal(response.status, 400, JSON.stringify(items));
    assert.equal(fetchMock.mock.callCount(), 0);
    mock.restoreAll();
  }
});

test('receipt failure preserves accepted order and pickup reference', async () => {
  const response = await submit(async (message) => {
    if (message.to === order.email) throw Object.assign(new Error('Receipt rejected'), { code: 'E_RECIPIENT_NOT_ALLOWED' });
    return { messageId: 'store-message' };
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.customerEmailSent, false);
  assert.match(body.orderReference, /^LP-/);
  assert.deepEqual(body.messageIds, ['store-message']);
});

test('store failure returns diagnostic code without sending a customer receipt', async () => {
  let calls = 0;
  const response = await submit(async () => {
    calls++;
    throw Object.assign(new Error('Sender is not verified'), { code: 'E_SENDER_NOT_VERIFIED' });
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.success, false);
  assert.equal(body.errorCode, 'RESEND_HTTP_403');
  assert.equal(calls, 1);
});
