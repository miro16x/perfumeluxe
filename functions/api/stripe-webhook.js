// Stripe calls this after a customer pays (Dashboard → Developers → Webhooks,
// event checkout.session.completed). Only here, once the signature proves the
// call came from Stripe, is a paid order sent to the store.
import { paymentsEnabled, verifyWebhook, retrieveCheckoutSession, orderFromSession } from '../../lib/stripe.js';
import { accountOrdersEnabled, insertPaidOrder, getOrder, updateOrder } from '../../lib/supabase.js';
import { sendOrderEmails, buildOrderEmails } from '../../lib/order-emails.js';
import { alertOwner } from '../../lib/alerts.js';
import { STORES } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

/* Records the paid order. Returns 'new', 'notified' (a retry of an order whose
   store email already went out) or 'unrecorded' (Supabase unavailable). */
async function recordPaidOrder(env, waitUntil, order, sessionId) {
  if (!accountOrdersEnabled(env)) return 'unrecorded';
  try {
    const created = await insertPaidOrder(env, {
      user_id: order.userId,
      reference: order.reference,
      email: order.customerEmail.toLowerCase(),
      customer_name: order.customerName,
      phone: order.phone,
      pickup_store: order.pickupStore,
      pickup_date: order.fulfillment === 'pickup' ? order.pickupDate : null,
      pickup_time: order.fulfillment === 'pickup' ? order.pickupTime : null,
      fulfillment: order.fulfillment,
      shipping_address: order.shippingAddress,
      shipping_cost: order.shippingCost,
      items: order.items,
      item_count: order.items.reduce((sum, item) => sum + item.qty, 0),
      total: order.total,
      status: 'paid',
      placed_at: order.placedAt.toISOString(),
      paid_at: new Date().toISOString(),
      stripe_session_id: sessionId,
      stripe_payment_intent: order.paymentIntent
    });
    if (created) return 'new';
    const existing = await getOrder(env, order.reference);
    return existing?.notified_at ? 'notified' : 'new';
  } catch (error) {
    /* Never hold up a paid order over record-keeping: email the store anyway. */
    console.error('Paid order record failed', order.reference, error?.message);
    await alertOwner(env, waitUntil, {
      kind: 'paid-order-save-failed',
      subject: 'Paid orders are not being recorded',
      details: `Paid order ${order.reference} was sent to the store but could not be saved in Supabase: ${error?.message}\nIt will be missing from the customer's order history. Check the SUPABASE_SERVICE_ROLE_KEY Worker secret and the Supabase project status.`
    });
    return 'unrecorded';
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!paymentsEnabled(env) || !env.RESEND_API_KEY) {
    return json({ success: false, message: 'Payments are not configured.' }, 503);
  }

  const event = await verifyWebhook(env, await request.text(), request.headers.get('Stripe-Signature'));
  if (!event) return json({ success: false, message: 'Invalid signature.' }, 400);
  if (event.type !== 'checkout.session.completed') return json({ received: true });

  /* Re-read the session from Stripe for its line items and current state. */
  let session;
  try {
    session = await retrieveCheckoutSession(env, event.data?.object?.id);
  } catch (error) {
    console.error('Stripe session lookup failed', event.data?.object?.id, error?.code, error?.providerError);
    return json({ success: false }, 500);   /* Stripe retries */
  }
  if (session.payment_status !== 'paid') return json({ received: true });

  const order = orderFromSession(session);
  if (!order.reference || !STORES[order.pickupStore] || !order.items.length) {
    console.error('Paid session is missing order details', session.id);
    await alertOwner(env, waitUntil, {
      kind: `paid-order-unreadable:${session.id}`,
      subject: 'A payment arrived without readable order details',
      details: `Stripe Checkout session ${session.id} was paid (${session.amount_total / 100} USD) but its order details are missing. Find it in the Stripe dashboard and contact the customer (${order.customerEmail || 'unknown email'}).`
    });
    return json({ received: true });
  }

  if (await recordPaidOrder(env, waitUntil, order, session.id) === 'notified') {
    return json({ received: true, duplicate: true });
  }

  try {
    await sendOrderEmails(env, waitUntil, { ...order, paid: true });
  } catch (error) {
    console.error('Paid order email delivery failed', order.reference, error?.code, error?.message, error?.providerError);
    /* Stripe retries the webhook for up to three days, so this alerts at most
       hourly per order while it keeps failing. */
    await alertOwner(env, waitUntil, {
      kind: `paid-order-email-failed:${order.reference}`,
      subject: `PAID ORDER NOT DELIVERED to ${order.pickupStore} — ${order.reference}`,
      details: `The customer has paid, but the store notification failed (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}). Stripe will keep retrying automatically; pass the order on by hand if it's urgent.\n\n${buildOrderEmails({ ...order, paid: true }).storeText}`
    });
    return json({ success: false }, 500);
  }

  if (accountOrdersEnabled(env)) {
    await updateOrder(env, order.reference, { notified_at: new Date().toISOString() })
      .catch((error) => console.error('Paid order notified flag failed', order.reference, error?.message));
  }
  return json({ received: true });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
