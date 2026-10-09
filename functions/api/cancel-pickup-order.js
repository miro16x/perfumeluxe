import { sendEmail } from '../../lib/email.js';
import { accountOrdersEnabled, getOrder, markAccountOrderCancelled, updateOrder } from '../../lib/supabase.js';
import { cancelSigningEnabled, verifyCancellation } from '../../lib/cancel-token.js';
import { alertOwner } from '../../lib/alerts.js';
import { paymentsEnabled, validSessionId, retrieveCheckoutSession, refundPayment } from '../../lib/stripe.js';
import { STORES, ALWAYS_NOTIFY, FROM_ADDRESS, CANCEL_WINDOW_MS as DAY_MS, escapeHtml } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/* Refunds a paid order in full. The session must belong to the signed order
   reference, so a valid token can't be paired with someone else's payment.
   Returns { amount refunded, shipping }, or a Response to send back on failure. */
async function refundOrder(env, waitUntil, { reference, pickupStore, sessionId }) {
  const store = STORES[pickupStore];
  if (!paymentsEnabled(env)) {
    return json({ success: false, message: `Online refunds are unavailable right now. Please call ${pickupStore} at ${store.phone} with your pickup reference.` }, 503);
  }
  try {
    const session = await retrieveCheckoutSession(env, sessionId);
    if (session.metadata?.reference !== reference) {
      return json({ success: false, message: 'This order could not be verified. Please contact the store with your pickup reference.' }, 403);
    }
    const shipping = session.metadata?.fulfillment === 'shipping';
    if (session.payment_status !== 'paid') return { amount: 0, shipping };
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    await refundPayment(env, paymentIntent, reference);
    return { amount: session.amount_total / 100, shipping };
  } catch (error) {
    console.error('Pickup refund failed', reference, error?.code, error?.message, error?.providerError);
    await alertOwner(env, waitUntil, {
      kind: 'refund-failed',
      throttle: false,
      subject: `REFUND FAILED — ${reference}`,
      details: `A customer tried to cancel paid order ${reference} (${pickupStore}) within 24 hours, but the refund failed (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}). The order was NOT cancelled and the store was not told.\nRefund it in the Stripe dashboard (search ${reference}) and let ${pickupStore} know, or ask the customer to try again.`
    });
    return json({ success: false, message: `We could not process your refund. Please try again, or call ${pickupStore} at ${store.phone}.` }, 502);
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.RESEND_API_KEY) return json({ success: false, message: 'Email service is not configured.' }, 503);
  if (!cancelSigningEnabled(env)) {
    return json({ success: false, message: 'Online cancellation is unavailable. Please contact the store with your pickup reference.' }, 503);
  }

  let cancellation;
  try {
    cancellation = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid cancellation data.' }, 400);
  }

  const reference = String(cancellation.orderReference || '').trim().slice(0, 40);
  const email = String(cancellation.email || '').trim().slice(0, 254);
  const pickupStore = String(cancellation.pickupStore || '');
  const placedAt = new Date(cancellation.placedAt);
  const store = STORES[pickupStore];
  const age = Date.now() - placedAt.getTime();

  if (!/^LP-\d{8}-[A-F0-9-]{8,}$/i.test(reference) || !validEmail(email) || !store ||
      !Number.isFinite(placedAt.getTime())) {
    return json({ success: false, message: 'Order details are missing or invalid.' }, 400);
  }
  /* placedAt decides the window below, so it is only trusted once the
     signature proves these exact details were issued by /api/pickup-order. */
  const signed = await verifyCancellation(env, {
    reference, email, pickupStore, placedAt: String(cancellation.placedAt)
  }, cancellation.cancelToken);
  if (!signed) {
    return json({ success: false, message: 'This order could not be verified. Please contact the store with your pickup reference.' }, 403);
  }
  if (age < 0 || age > DAY_MS) {
    return json({ success: false, message: 'The 24-hour cancellation window has closed.' }, 409);
  }

  /* Staff may already have handed the order over (staff dashboard). The lookup
     is best-effort: if Supabase is down, cancellation works as before. */
  if (accountOrdersEnabled(env)) {
    const current = await getOrder(env, reference).catch((error) => {
      console.error('Pickup cancellation status check failed', reference, error?.message);
      return null;
    });
    if (current?.status === 'shipped' || current?.status === 'collected') {
      return json({
        success: false,
        message: `This order has already been ${current.status === 'shipped' ? 'shipped' : 'picked up'}, so it can't be cancelled online. Please call ${pickupStore} at ${store.phone}.`
      }, 409);
    }
  }

  /* Paid orders carry their Stripe session id; refund before telling anyone. */
  let refunded = null;
  let shipping = false;
  if (cancellation.sessionId !== undefined && cancellation.sessionId !== null) {
    if (!validSessionId(cancellation.sessionId)) {
      return json({ success: false, message: 'Order details are missing or invalid.' }, 400);
    }
    const result = await refundOrder(env, waitUntil, { reference, pickupStore, sessionId: cancellation.sessionId });
    if (result instanceof Response) return result;
    refunded = result.amount || null;
    shipping = result.shipping;
  }
  const orderKind = shipping ? 'shipping order' : 'pickup order';
  const amount = refunded ? `$${refunded.toFixed(2)}` : '';
  const storeAction = shipping ? 'Do not ship this order.' : 'Do not hold the items.';
  const storeRefundNote = refunded ? `\n\nPAID ORDER: a full refund of ${amount} has already been issued to the customer's card. ${storeAction}` : '';
  const customerRefundNote = refunded ? `A full refund of ${amount} has been issued to your card. It can take 5–10 business days to appear on your statement.` : '';

  const subject = `${shipping ? 'Shipping order' : 'Pickup'} cancellation${refunded ? ' (refunded)' : ' requested'} — ${reference}`;
  const text = `CANCEL PICKUP ORDER\n\nOrder: ${reference}\nCustomer email: ${email}\nStore: ${pickupStore}\n\nThis cancellation was requested within 24 hours of the order being placed.${storeRefundNote}`;
  const referenceHtml = `
    <div style="margin:20px 0;padding:18px;border:2px solid #b08d32;text-align:center">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">Pickup reference</div>
      <strong style="display:block;font-size:24px;margin-top:6px">${escapeHtml(reference)}</strong>
      <div style="font-size:13px;margin-top:6px">Cancellation requested</div>
    </div>`;
  const detailsHtml = `
    <h2>Request details</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr><th scope="row" style="padding:8px;border-bottom:1px solid #ddd;text-align:left">Store</th>
        <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(pickupStore)}</td></tr>
      <tr><th scope="row" style="padding:8px;border-bottom:1px solid #ddd;text-align:left">Customer email</th>
        <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(email)}</td></tr>
    </table>`;
  const storeHtml = `
    <h1>${shipping ? 'Shipping order' : 'Pickup'} cancellation requested</h1>
    <p>A customer has requested cancellation of their ${orderKind} at <strong>${escapeHtml(pickupStore)}</strong>.</p>
    ${referenceHtml}
    ${detailsHtml}
    ${refunded ? `<p style="padding:12px;background:#e8f5e9;font-weight:bold">Paid order: a full refund of ${amount} has already been issued to the customer's card. ${storeAction}</p>` : ''}
    <p>Please use the pickup reference to locate the original order and process the cancellation request.</p>
    <p><small>This cancellation was requested within 24 hours of the order being placed.</small></p>`;
  const customerHtml = `
    <h1>${refunded ? 'Your order is cancelled and refunded' : 'We received your cancellation request'}</h1>
    <p>We received your request to cancel your ${orderKind} with <strong>${escapeHtml(pickupStore)}</strong>.</p>
    ${referenceHtml}
    ${detailsHtml}
    ${refunded ? `<p><strong>${customerRefundNote}</strong></p>` : ''}
    <p>The store has been notified of your request. Keep this message and your pickup reference for your records.</p>
    <p>This confirms receipt of your cancellation request. Contact the store with your pickup reference if you need further assistance.</p>`;

  try {
    await Promise.all([
      sendEmail(env, { from: FROM_ADDRESS, to: store.email, bcc: [ALWAYS_NOTIFY], replyTo: email, subject, html: storeHtml, text }),
      sendEmail(env, {
        from: FROM_ADDRESS, to: email, replyTo: store.email,
        subject: refunded ? `Your order is cancelled and refunded — ${reference}` : `We received your cancellation request — ${reference}`,
        html: customerHtml,
        text: `We received your request to cancel ${orderKind} ${reference}. ${pickupStore} has been notified.${refunded ? ` ${customerRefundNote}` : ''} Keep this message for your records.`
      })
    ]);

    /* Best-effort: reflect the cancellation in the order record. Paid orders
       are stored for guests too; unpaid ones only for signed-in customers. */
    if (accountOrdersEnabled(env)) {
      const now = new Date().toISOString();
      const markCancelled = (refunded
        ? updateOrder(env, reference, { status: 'refunded', cancelled_at: now, refunded_at: now })
        : markAccountOrderCancelled(env, reference, email))
        .catch((error) => {
          console.error('Pickup cancellation account update failed', reference, error?.message);
          return alertOwner(env, waitUntil, {
            kind: 'account-cancel-failed',
            subject: 'Cancellations are not being saved to customer accounts',
            details: `Order ${reference} was cancelled with the store, but the customer's order history still shows it as placed: ${error?.message}\nCheck the SUPABASE_SERVICE_ROLE_KEY Worker secret and the Supabase project status.`
          });
        });
      if (typeof waitUntil === 'function') waitUntil(markCancelled);
      else await markCancelled;
    }

    return json({ success: true, orderReference: reference, refunded });
  } catch (error) {
    console.error('Pickup cancellation email delivery failed', error?.code, error?.message, error?.providerError);
    /* The two emails are sent together, so the store may or may not have it. */
    await alertOwner(env, waitUntil, {
      kind: 'cancel-email-failed',
      throttle: false,
      subject: `CANCELLATION MAY NOT HAVE REACHED ${pickupStore} — ${reference}`,
      details: `A customer tried to cancel order ${reference} and was told it failed (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}). ${pickupStore} may not know about the cancellation.${refunded ? ` The refund of ${amount} DID go through.` : ''}\n\n${text}`
    });
    /* A retry is safe: the refund won't be issued twice. */
    return json({
      success: false,
      message: refunded
        ? `Your refund of ${amount} was issued, but we could not notify the store. Please try again or call ${pickupStore} at ${store.phone}.`
        : 'Unable to deliver the cancellation request.'
    }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
