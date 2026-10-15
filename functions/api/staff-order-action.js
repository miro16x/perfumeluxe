// Staff dashboard actions on one order:
//   ready     pickup order is ready; emails the customer
//   collected pickup order was picked up
//   shipped   shipping order left the store; emails the customer tracking
//             and gives it to PayPal
//   refund    cancels the order, refunding it in full if it was paid online
//   refund-items  refunds some items of a paid order; the rest goes ahead
import { accountOrdersEnabled, getStaffOrder, transitionOrder } from '../../lib/supabase.js';
import { getStaff, staffLookupFailure, canManage, sendCustomerEmail, CARRIERS } from '../../lib/staff.js';
import { paymentsEnabled, refundPayment, addTracking } from '../../lib/paypal.js';
import { alertOwner } from '../../lib/alerts.js';
import { CANCEL_WINDOW_MS } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

/* action → which orders it applies to and the statuses it may start from. */
const ACTIONS = {
  ready: { fulfillment: 'pickup', from: ['placed', 'paid'] },
  collected: { fulfillment: 'pickup', from: ['placed', 'paid', 'ready'] },
  shipped: { fulfillment: 'shipping', from: ['paid'] },
  refund: { fulfillment: null, from: ['placed', 'paid', 'ready'] },
  'refund-items': { fulfillment: null, from: ['paid', 'ready'] }
};

const cents = (dollars) => Math.round(Number(dollars) * 100);

/* Checks a request to refund `requested` ([{ index, qty }] into the order's
   items) and returns the items with their new refunded_qty, the amount, the
   refunded lines for the email, and whether nothing would be left; or null. */
function refundSelection(requested, items) {
  if (!Array.isArray(requested) || !requested.length || requested.length > items.length) return null;
  const counts = new Map();
  for (const entry of requested) {
    const index = Number(entry?.index);
    const qty = Number(entry?.qty);
    const item = Number.isInteger(index) ? items[index] : undefined;
    if (!item || counts.has(index) || !Number.isInteger(qty) || qty < 1) return null;
    if (qty > item.qty - (item.refunded_qty || 0)) return null;
    counts.set(index, qty);
  }
  const updated = items.map((item, index) => (counts.has(index)
    ? { ...item, refunded_qty: (item.refunded_qty || 0) + counts.get(index) }
    : item));
  return {
    updated,
    amount: [...counts].reduce((sum, [index, qty]) => sum + cents(items[index].price) * qty, 0) / 100,
    lines: [...counts].map(([index, qty]) => ({ ...items[index], qty })),
    nothingLeft: updated.every((item) => (item.refunded_qty || 0) >= item.qty)
  };
}

/* One PayPal request id per resulting set of refunded quantities: a double
   click asks for the same refund twice and PayPal makes it only once. */
async function partialRefundId(reference, items) {
  const state = items.map((item) => item.refunded_qty || 0).join(',');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  const hex = [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `refund-${reference}-${hex}`;
}

const astTime = (date) => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/St_Thomas'
}).format(date);

export async function onRequestPost({ request, env, waitUntil }) {
  if (!accountOrdersEnabled(env)) return json({ success: false, message: 'The order database is not configured.' }, 503);
  if (!env.RESEND_API_KEY) return json({ success: false, message: 'Email service is not configured.' }, 503);

  let staff;
  try {
    staff = await getStaff(request, env);
  } catch (error) {
    return json(await staffLookupFailure(env, waitUntil, error), 502);
  }
  if (!staff) return json({ success: false, message: 'This account does not have staff access.' }, 403);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid request.' }, 400);
  }
  const reference = String(input.reference || '').trim().slice(0, 40);
  const action = String(input.action || '');
  const rule = ACTIONS[action];
  if (!/^LP-\d{8}-[A-F0-9-]{8,}$/i.test(reference) || !rule) {
    return json({ success: false, message: 'Order or action is missing or invalid.' }, 400);
  }

  let order;
  try {
    order = await getStaffOrder(env, reference);
  } catch (error) {
    console.error('Staff order lookup failed', reference, error?.message);
    return json({ success: false, message: 'Unable to load this order right now. Please try again.' }, 502);
  }
  /* Another store's order is reported as missing, not as forbidden. */
  if (!order || !canManage(staff, order)) return json({ success: false, message: 'Order not found.' }, 404);
  if (rule.fulfillment && order.fulfillment !== rule.fulfillment) {
    return json({ success: false, message: `This is a ${order.fulfillment} order.` }, 409);
  }
  if (!rule.from.includes(order.status)) {
    return json({ success: false, message: `This order is already ${order.status}.` }, 409);
  }

  const now = new Date();
  const stamp = now.toISOString();
  const fields = { updated_by: staff.userId };
  const details = {};
  let match = {};

  if (action === 'ready') {
    Object.assign(fields, { status: 'ready', ready_at: stamp });
  } else if (action === 'collected') {
    Object.assign(fields, { status: 'collected', collected_at: stamp });
  } else if (action === 'shipped') {
    const carrier = String(input.carrier || '').toLowerCase();
    const trackingNumber = String(input.trackingNumber || '').replace(/[\s-]+/g, '').toUpperCase();
    if (!CARRIERS[carrier] || !/^[A-Z0-9]{8,40}$/.test(trackingNumber)) {
      return json({ success: false, message: 'Choose a carrier and enter a valid tracking number.' }, 400);
    }
    /* Shipping waits for the 24-hour window, so a customer can never cancel
       (and be refunded automatically) an order that has already left. */
    const shipAfter = new Date(new Date(order.placed_at).getTime() + CANCEL_WINDOW_MS);
    if (now < shipAfter) {
      return json({ success: false, message: `The customer can still cancel this order until ${astTime(shipAfter)} AST. Please ship after that.` }, 409);
    }
    Object.assign(fields, { status: 'shipped', shipped_at: stamp, tracking_carrier: carrier, tracking_number: trackingNumber });
    Object.assign(details, { carrier, trackingNumber });
  } else if (action === 'refund') {
    details.reason = String(input.reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (order.paypal_capture_id) {
      details.alreadyRefunded = Number(order.refunded_amount) || 0;
      if (!paymentsEnabled(env)) {
        return json({ success: false, message: 'Online refunds are unavailable right now. Refund this order in PayPal.' }, 503);
      }
      try {
        /* Same idempotency key as customer cancellations: never refunded twice. */
        await refundPayment(env, order.paypal_capture_id, reference);
      } catch (error) {
        console.error('Staff refund failed', reference, error?.code, error?.message, error?.providerError);
        return json({ success: false, message: 'PayPal could not refund this order. Nothing was changed. Try again, or refund it in PayPal.' }, 502);
      }
      /* Whatever items staff refunded earlier were already paid back. */
      details.refunded = (cents(order.total) - cents(details.alreadyRefunded)) / 100;
      Object.assign(fields, { status: 'refunded', cancelled_at: stamp, refunded_at: stamp, refunded_amount: Number(order.total) });
    } else {
      Object.assign(fields, { status: 'cancelled', cancelled_at: stamp });
    }
  } else if (action === 'refund-items') {
    if (!order.paypal_capture_id) {
      return json({ success: false, message: 'This order was not paid online, so there is nothing to refund.' }, 409);
    }
    const selection = refundSelection(input.items, order.items || []);
    if (!selection) return json({ success: false, message: 'Choose the items and how many of each to refund.' }, 400);
    if (selection.nothingLeft) {
      return json({ success: false, message: 'That is everything left in the order. Use Cancel & refund instead.' }, 409);
    }
    if (!paymentsEnabled(env)) {
      return json({ success: false, message: 'Online refunds are unavailable right now. Refund these items in PayPal.' }, 503);
    }
    details.reason = String(input.reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const previous = Number(order.refunded_amount) || 0;
    try {
      await refundPayment(env, order.paypal_capture_id, reference, {
        amount: selection.amount,
        requestId: await partialRefundId(reference, selection.updated),
        note: details.reason || undefined
      });
    } catch (error) {
      console.error('Staff item refund failed', reference, error?.code, error?.message, error?.providerError);
      return json({ success: false, message: 'PayPal could not refund these items. Nothing was changed. Try again, or refund them in PayPal.' }, 502);
    }
    details.refunded = selection.amount;
    details.refundedItems = selection.lines;
    Object.assign(fields, { items: selection.updated, refunded_amount: (cents(previous) + cents(selection.amount)) / 100 });
    /* Only if no one else refunded items in the meantime. */
    match = { refunded_amount: previous };
  }

  /* A refund that went through but couldn't be recorded must reach a person:
     the order would otherwise still show the money as kept. */
  const refundUnsaved = (problem) => alertOwner(env, waitUntil, {
    kind: `staff-refund-unsaved:${reference}`,
    throttle: false,
    subject: `Refund not recorded — ${reference}`,
    details: `${staff.name} refunded $${details.refunded.toFixed(2)} on order ${reference} from the staff dashboard and the refund DID go through, but the order could not be updated: ${problem}\n${action === 'refund'
      ? 'Set its status to refunded by hand.'
      : `Record it by hand: add ${details.refunded.toFixed(2)} to refunded_amount, and set refunded_qty on the refunded items (${details.refundedItems.map((item) => `${item.qty}× ${item.name} ${item.size}`).join(', ')}).`} The customer has not been emailed.`
  });

  let updated;
  try {
    updated = await transitionOrder(env, reference, rule.from, fields, match);
  } catch (error) {
    console.error('Staff order update failed', reference, action, error?.message);
    if (details.refunded) {
      await refundUnsaved(error?.message);
      return json({ success: false, message: 'The refund went through, but the order could not be updated. The site owner has been alerted.' }, 502);
    }
    return json({ success: false, message: 'Unable to update this order right now. Please try again.' }, 502);
  }
  if (!updated) {
    if (details.refunded) {
      await refundUnsaved('someone else changed the order at the same moment.');
      return json({ success: false, message: 'The refund went through, but someone else changed this order at the same moment, so it was not updated. The site owner has been alerted.' }, 409);
    }
    return json({ success: false, message: 'This order was changed by someone else. Refresh to see its current status.' }, 409);
  }

  /* Best-effort: the order has shipped either way. If PayPal can't take the
     tracking, the owner is asked to add it by hand. null: nothing to send. */
  let paypalTracking = null;
  if (action === 'shipped' && order.paypal_order_id && order.paypal_capture_id && paymentsEnabled(env)) {
    try {
      await addTracking(env, {
        orderId: order.paypal_order_id,
        captureId: order.paypal_capture_id,
        carrier: CARRIERS[details.carrier].paypal,
        trackingNumber: details.trackingNumber
      });
      paypalTracking = true;
    } catch (error) {
      console.error('PayPal tracking failed', reference, error?.code, error?.providerError);
      paypalTracking = false;
      await alertOwner(env, waitUntil, {
        kind: `paypal-tracking-failed:${reference}`,
        subject: `Tracking not sent to PayPal — ${reference}`,
        details: `Order ${reference} was marked shipped (${CARRIERS[details.carrier].name} ${details.trackingNumber}) and the customer was told, but PayPal didn't accept the tracking number (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}).\nAdd it by hand so PayPal can release the payment and protect you in a dispute: PayPal → Activity → find ${reference} → Add tracking.`
      });
    }
  }

  /* null: this action sends no email. The order is already updated, so a
     failed email is reported to staff rather than undoing it. */
  let customerEmailed = null;
  if (action !== 'collected') {
    try {
      await sendCustomerEmail(env, action, order, details);
      customerEmailed = true;
    } catch (error) {
      console.error('Staff action customer email failed', reference, action, error?.code, error?.providerError);
      customerEmailed = false;
    }
  }

  return json({ success: true, reference, status: fields.status ?? order.status, customerEmailed, paypalTracking, refunded: details.refunded ?? null });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
