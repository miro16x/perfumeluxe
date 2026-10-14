// PayPal calls this as a payment moves along (developer.paypal.com → Apps &
// Credentials → the app → Webhooks), with these events:
//   CHECKOUT.ORDER.APPROVED    the customer approved; take the payment, in
//                              case they closed the tab before returning
//   PAYMENT.CAPTURE.COMPLETED  the money is ours; send the order to the store
// Only here, once PayPal confirms the call came from it, is a paid order sent
// to the store.
import { paymentsEnabled, verifyWebhook } from '../../lib/paypal.js';
import { loadCheckout } from '../../lib/checkout.js';
import { insertPaidOrder, getOrder, updateOrder } from '../../lib/supabase.js';
import { sendOrderEmails, buildOrderEmails } from '../../lib/order-emails.js';
import { alertOwner } from '../../lib/alerts.js';
import { STORES } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

/* Records the paid order. Returns 'new', 'notified' (a retry of an order whose
   store email already went out) or 'unrecorded' (Supabase unavailable). */
async function recordPaidOrder(env, waitUntil, order, paypalOrderId) {
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
      paypal_order_id: paypalOrderId,
      paypal_capture_id: order.captureId
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
      details: `Paid order ${order.reference} was sent to the store but could not be saved in Supabase: ${error?.message}\nIt will be missing from the staff dashboard and the customer's order history. Check the SUPABASE_SERVICE_ROLE_KEY Worker secret and the Supabase project status.`
    });
    return 'unrecorded';
  }
}

/* The PayPal order id an event is about. */
function eventOrderId(event) {
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') return event.resource?.id;
  return event.resource?.supplementary_data?.related_ids?.order_id;
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!paymentsEnabled(env) || !env.RESEND_API_KEY) {
    return json({ success: false, message: 'Payments are not configured.' }, 503);
  }

  let event;
  try {
    event = await verifyWebhook(env, await request.text(), request.headers);
  } catch (error) {
    console.error('PayPal webhook verification failed', error?.code, error?.providerError);
    return json({ success: false }, 500);   /* PayPal retries */
  }
  if (!event) return json({ success: false, message: 'Invalid signature.' }, 400);
  if (event.event_type !== 'CHECKOUT.ORDER.APPROVED' && event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
    return json({ received: true });
  }
  const paypalOrderId = eventOrderId(event);
  if (!paypalOrderId) return json({ received: true });

  /* Re-read the order from PayPal for its current state, taking the payment
     if the customer approved it and nobody has yet. */
  let checkout;
  try {
    checkout = await loadCheckout(env, paypalOrderId, { capture: true });
  } catch (error) {
    console.error('PayPal order lookup or capture failed', paypalOrderId, error?.code, error?.providerError);
    /* A declined card can't succeed on retry; the customer is told on the return page. */
    if (String(error?.providerError || '').includes('INSTRUMENT_DECLINED')) return json({ received: true });
    return json({ success: false }, 500);   /* PayPal retries */
  }
  /* Approval only triggers the capture above; the capture's own event
     (PAYMENT.CAPTURE.COMPLETED) sends the order, exactly once. */
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED' || checkout.payment?.status !== 'COMPLETED') {
    return json({ received: true });
  }

  const { order } = checkout;
  if (!order?.reference || !STORES[order.pickupStore] || !order.items.length) {
    console.error('Paid PayPal order is missing order details', paypalOrderId);
    await alertOwner(env, waitUntil, {
      kind: `paid-order-unreadable:${paypalOrderId}`,
      subject: 'A payment arrived without readable order details',
      details: `PayPal order ${paypalOrderId} (reference ${checkout.reference || 'unknown'}) was paid ($${checkout.payment.amount} USD) but its order details are missing. Find it in PayPal (Activity → search the reference) and contact the customer.`
    });
    return json({ received: true });
  }

  if (await recordPaidOrder(env, waitUntil, order, paypalOrderId) === 'notified') {
    return json({ received: true, duplicate: true });
  }

  try {
    await sendOrderEmails(env, waitUntil, { ...order, paid: true });
  } catch (error) {
    console.error('Paid order email delivery failed', order.reference, error?.code, error?.message, error?.providerError);
    /* PayPal retries the webhook for up to three days, so this alerts at most
       hourly per order while it keeps failing. */
    await alertOwner(env, waitUntil, {
      kind: `paid-order-email-failed:${order.reference}`,
      subject: `PAID ORDER NOT DELIVERED to ${order.pickupStore} — ${order.reference}`,
      details: `The customer has paid, but the store notification failed (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}). PayPal will keep retrying automatically; pass the order on by hand if it's urgent.\n\n${buildOrderEmails({ ...order, paid: true }).storeText}`
    });
    return json({ success: false }, 500);
  }

  await updateOrder(env, order.reference, { notified_at: new Date().toISOString() })
    .catch((error) => console.error('Paid order notified flag failed', order.reference, error?.message));
  return json({ received: true });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
