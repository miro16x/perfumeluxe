// The customer lands back on the site from PayPal with ?token=<order id>; this
// takes the payment they approved and returns what the confirmation screen
// needs. The order id is an unguessable PayPal identifier, so knowing it is
// proof of being the buyer. The store is emailed by the webhook, not here.
import { paymentsEnabled, validPaymentId } from '../../lib/paypal.js';
import { loadCheckout } from '../../lib/checkout.js';
import { cancelSigningEnabled, signCancellation } from '../../lib/cancel-token.js';
import { STORES, CANCEL_WINDOW_MS } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export async function onRequestGet({ request, env }) {
  if (!paymentsEnabled(env)) return json({ success: false, message: 'Payments are not configured.' }, 503);
  const paymentId = new URL(request.url).searchParams.get('token');
  if (!validPaymentId(paymentId)) return json({ success: false, message: 'Invalid payment reference.' }, 400);

  let checkout;
  try {
    checkout = await loadCheckout(env, paymentId, { capture: true });
  } catch (error) {
    console.error('Checkout status lookup failed', error?.code, error?.providerError);
    if (String(error?.providerError || '').includes('INSTRUMENT_DECLINED')) {
      return json({ success: false, paid: false, message: 'Your payment was declined, so you were not charged. Please try again with another card or payment method.' }, 402);
    }
    return json({ success: false, message: 'We could not load your payment. If you were charged, your confirmation email is on its way.' }, error?.code === 'PAYPAL_HTTP_404' ? 404 : 502);
  }
  if (checkout.payment?.status === 'PENDING') {
    return json({ success: false, paid: false, message: 'PayPal is still reviewing your payment. We will email your confirmation as soon as it clears.' }, 202);
  }
  if (checkout.payment?.status !== 'COMPLETED') {
    return json({ success: false, paid: false, message: 'This payment was not completed.' }, 409);
  }

  const { order } = checkout;
  const store = STORES[order?.pickupStore];
  if (!order?.reference || !store) return json({ success: false, message: 'Order details are missing.' }, 502);
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
    paymentId
  });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
