// A paid order comes from two halves: the details the customer entered, saved
// in Supabase (checkouts table) when payment started, and the payment itself,
// read back from PayPal. The return page, the webhook and cancellation all
// pair them the same way.
import { getCheckout } from './supabase.js';
import { getCheckoutOrder, captureCheckoutOrder, orderCapture, orderReference } from './paypal.js';

/* The order as created by /api/pickup-order, from its saved details. */
function orderFromCheckout(saved, payment) {
  const details = saved.details ?? {};
  const shipping = details.fulfillment === 'shipping';
  return {
    reference: saved.reference,
    fulfillment: shipping ? 'shipping' : 'pickup',
    shippingAddress: shipping ? details.shippingAddress : null,
    shippingCost: shipping ? Number(details.shippingCost) || 0 : 0,
    customerName: details.customerName,
    customerEmail: details.customerEmail,
    phone: details.phone,
    pickupStore: details.pickupStore,
    pickupDate: shipping ? '' : details.pickupDate,
    pickupTime: shipping ? '' : details.pickupTime,
    placedAt: new Date(details.placedAt),
    userId: details.userId || null,
    items: Array.isArray(details.items) ? details.items : [],
    /* What PayPal actually charged, once it has. */
    total: Number.isFinite(payment?.amount) ? payment.amount : Number(details.total),
    captureId: payment?.id ?? null
  };
}

/* Reads a PayPal order and pairs it with its saved details. With `capture`,
   an order the customer approved but nobody has captured yet is captured
   first. `order` is null when the details are missing or belong to another
   PayPal order, so a valid id can't be paired with someone else's details. */
export async function loadCheckout(env, paypalOrderId, { capture = false } = {}) {
  let paypalOrder = await getCheckoutOrder(env, paypalOrderId);
  const reference = orderReference(paypalOrder);
  if (capture && paypalOrder.status === 'APPROVED' && reference) {
    paypalOrder = await captureCheckoutOrder(env, paypalOrderId, reference);
  }
  const payment = orderCapture(paypalOrder);
  const saved = reference ? await getCheckout(env, reference) : null;
  const order = saved && saved.paypal_order_id === paypalOrderId ? orderFromCheckout(saved, payment) : null;
  return { reference, status: paypalOrder.status, payment, order };
}
