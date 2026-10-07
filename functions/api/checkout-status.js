// The customer lands back on the site from Stripe with ?session_id=…; this
// returns what the confirmation screen needs. The session id is an
// unguessable Stripe identifier, so knowing it is proof of being the buyer.
import { paymentsEnabled, validSessionId, retrieveCheckoutSession, orderFromSession } from '../../lib/stripe.js';
import { cancelSigningEnabled, signCancellation } from '../../lib/cancel-token.js';
import { STORES, CANCEL_WINDOW_MS } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export async function onRequestGet({ request, env }) {
  if (!paymentsEnabled(env)) return json({ success: false, message: 'Payments are not configured.' }, 503);
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!validSessionId(sessionId)) return json({ success: false, message: 'Invalid payment reference.' }, 400);

  let session;
  try {
    session = await retrieveCheckoutSession(env, sessionId);
  } catch (error) {
    console.error('Checkout status lookup failed', error?.code, error?.providerError);
    return json({ success: false, message: 'We could not load your payment. If you were charged, your confirmation email is on its way.' }, error?.code === 'STRIPE_HTTP_404' ? 404 : 502);
  }
  if (session.payment_status !== 'paid') {
    return json({ success: false, paid: false, message: 'This payment was not completed.' }, 409);
  }

  const order = orderFromSession(session);
  const store = STORES[order.pickupStore];
  if (!order.reference || !store) return json({ success: false, message: 'Order details are missing.' }, 502);
  const placedAt = order.placedAt.toISOString();

  return json({
    success: true,
    paid: true,
    orderReference: order.reference,
    pickupStore: order.pickupStore,
    pickupAddress: store.address,
    storePhone: store.phone,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
    fulfillment: order.fulfillment,
    shippingAddress: order.shippingAddress,
    shippingCost: order.shippingCost,
    email: order.customerEmail,
    total: order.total,
    itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
    placedAt,
    cancelBy: new Date(order.placedAt.getTime() + CANCEL_WINDOW_MS).toISOString(),
    cancelToken: cancelSigningEnabled(env)
      ? await signCancellation(env, { reference: order.reference, email: order.customerEmail, pickupStore: order.pickupStore, placedAt })
      : null,
    sessionId
  });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
