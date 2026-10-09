// Staff dashboard actions on one order:
//   ready     pickup order is ready; emails the customer
//   collected pickup order was picked up
//   shipped   shipping order left the store; emails the customer tracking
//   refund    cancels the order, refunding it in full if it was paid online
import { accountOrdersEnabled, getStaffOrder, transitionOrder } from '../../lib/supabase.js';
import { getStaff, staffLookupFailure, canManage, sendCustomerEmail, CARRIERS } from '../../lib/staff.js';
import { paymentsEnabled, refundPayment } from '../../lib/stripe.js';
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
  refund: { fulfillment: null, from: ['placed', 'paid', 'ready'] }
};

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
    if (order.stripe_payment_intent) {
      if (!paymentsEnabled(env)) {
        return json({ success: false, message: 'Online refunds are unavailable right now. Refund this order in the Stripe dashboard.' }, 503);
      }
      try {
        /* Same idempotency key as customer cancellations: never refunded twice. */
        await refundPayment(env, order.stripe_payment_intent, reference);
      } catch (error) {
        console.error('Staff refund failed', reference, error?.code, error?.message, error?.providerError);
        return json({ success: false, message: 'Stripe could not refund this order. Nothing was changed. Try again, or refund it in the Stripe dashboard.' }, 502);
      }
      details.refunded = Number(order.total);
      Object.assign(fields, { status: 'refunded', cancelled_at: stamp, refunded_at: stamp });
    } else {
      Object.assign(fields, { status: 'cancelled', cancelled_at: stamp });
    }
  }

  let updated;
  try {
    updated = await transitionOrder(env, reference, rule.from, fields);
  } catch (error) {
    console.error('Staff order update failed', reference, action, error?.message);
    if (details.refunded) {
      await alertOwner(env, waitUntil, {
        kind: `staff-refund-unsaved:${reference}`,
        throttle: false,
        subject: `Refunded order not marked refunded — ${reference}`,
        details: `${staff.name} refunded order ${reference} from the staff dashboard and the refund DID go through, but the order could not be updated in Supabase: ${error?.message}\nSet its status to refunded by hand. The customer has not been emailed.`
      });
      return json({ success: false, message: 'The refund went through, but the order could not be updated. The site owner has been alerted.' }, 502);
    }
    return json({ success: false, message: 'Unable to update this order right now. Please try again.' }, 502);
  }
  if (!updated) {
    return json({ success: false, message: 'This order was changed by someone else. Refresh to see its current status.' }, 409);
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

  return json({ success: true, reference, status: fields.status, customerEmailed, refunded: details.refunded ?? null });
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
