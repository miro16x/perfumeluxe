// Server-side only: who may use the staff dashboard, and the customer emails
// its actions send. Staff sign in with ordinary site accounts; the staff table
// (supabase/schema.sql) decides which store, if any, each one manages.
import { getSignedInUser, getStaffMember } from './supabase.js';
import { alertOwner } from './alerts.js';
import { sendEmail } from './email.js';
import { STORES, ALWAYS_NOTIFY, FROM_ADDRESS, escapeHtml } from './stores.js';
import { formatAddress } from './shipping.js';

export const CARRIERS = {
  usps: { name: 'USPS', track: (number) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(number)}` },
  ups: { name: 'UPS', track: (number) => `https://www.ups.com/track?tracknum=${encodeURIComponent(number)}` },
  fedex: { name: 'FedEx', track: (number) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(number)}` },
  dhl: { name: 'DHL', track: (number) => `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(number)}` }
};

/* Returns { userId, store, name, email } for a signed-in staff member, where
   store is null for staff who manage every store; or null for anyone else. */
export async function getStaff(request, env) {
  const user = await getSignedInUser(request, env);
  if (!user) return null;
  const member = await getStaffMember(env, user.id);
  if (!member) return null;
  return {
    userId: user.id,
    store: member.store === 'all' ? null : member.store,
    name: member.name || user.email,
    email: user.email
  };
}

/* The JSON body to send when getStaff throws. A 401/403 from Supabase means
   the Worker's key is wrong, which also stops orders being saved, so the
   owner is alerted (at most hourly). */
export async function staffLookupFailure(env, waitUntil, error) {
  console.error('Staff lookup failed', error?.message);
  const keyRejected = error?.status === 401 || error?.status === 403;
  if (keyRejected) {
    await alertOwner(env, waitUntil, {
      kind: 'supabase-key-rejected',
      subject: 'Supabase is rejecting the Worker secret key',
      details: `Supabase refused the SUPABASE_SERVICE_ROLE_KEY Worker secret (${error.message}). The staff dashboard can't load, and paid orders, cancellations and account history are probably not being saved either.\nReplace the secret with the project's current secret key: Supabase → Project Settings → API Keys, then Cloudflare → Workers → luxeperfume → Settings → Variables and Secrets.`
    });
  }
  return {
    success: false,
    message: keyRejected
      ? "The order database rejected the server's key, so staff access can't be checked. The site owner has been alerted."
      : 'Unable to check staff access right now. Please try again.'
  };
}

export const canManage = (staff, order) => !staff.store || staff.store === order.pickup_store;

const money = (amount) => `$${Number(amount).toFixed(2)}`;

const referenceBox = (order, note) => `
  <div style="margin:20px 0;padding:18px;border:2px solid #b08d32;text-align:center">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">${order.fulfillment === 'shipping' ? 'Order reference' : 'Pickup reference'}</div>
    <strong style="display:block;font-size:24px;margin-top:6px">${escapeHtml(order.reference)}</strong>
    <div style="font-size:13px;margin-top:6px">${note}</div>
  </div>`;

/* The customer email for a dashboard action, or null when none is sent. */
export function buildCustomerEmail(action, order, { carrier, trackingNumber, refunded, reason } = {}) {
  const store = STORES[order.pickup_store];
  const name = order.customer_name ? `Hi ${escapeHtml(order.customer_name)},` : 'Hello,';

  if (action === 'ready') {
    return {
      subject: `Your order is ready for pickup — ${order.reference}`,
      html: `
        <p>${name}</p>
        <h1>Your order is ready for pickup</h1>
        ${referenceBox(order, 'Ready for pickup')}
        <p><strong>${escapeHtml(order.pickup_store)}</strong><br>${escapeHtml(store.address)}<br>${escapeHtml(store.phone)}</p>
        <p>Please bring a photo ID and your pickup reference.</p>`,
      text: `${order.customer_name ? `Hi ${order.customer_name},\n\n` : ''}Your order ${order.reference} is ready for pickup at ${order.pickup_store}, ${store.address} (${store.phone}). Please bring a photo ID and your pickup reference.`
    };
  }

  if (action === 'shipped') {
    const { name: carrierName, track } = CARRIERS[carrier];
    const url = track(trackingNumber);
    const address = formatAddress(order.shipping_address);
    return {
      subject: `Your order has shipped — ${order.reference}`,
      html: `
        <p>${name}</p>
        <h1>Your order is on its way</h1>
        ${referenceBox(order, 'Shipped')}
        <p><strong>${escapeHtml(carrierName)} tracking number:</strong> ${escapeHtml(trackingNumber)}<br>
          <a href="${escapeHtml(url)}">Track your package</a></p>
        <p><strong>Shipping to</strong><br>${escapeHtml(address).replaceAll('\n', '<br>')}</p>
        <p>Questions? Contact ${escapeHtml(order.pickup_store)} at ${escapeHtml(store.phone)} with your order reference.</p>`,
      text: `${order.customer_name ? `Hi ${order.customer_name},\n\n` : ''}Your order ${order.reference} has shipped.\n\n${carrierName} tracking number: ${trackingNumber}\nTrack it: ${url}\n\nShipping to:\n${address}\n\nQuestions? Contact ${order.pickup_store} at ${store.phone}.`
    };
  }

  if (action === 'refund') {
    const kind = order.fulfillment === 'shipping' ? 'order' : 'pickup order';
    const reasonLine = reason ? `Reason: ${reason}` : '';
    const refundLine = refunded
      ? `A full refund of ${money(refunded)} has been issued to your card. It can take 5–10 business days to appear on your statement.`
      : '';
    return {
      subject: `Your order has been cancelled${refunded ? ' and refunded' : ''} — ${order.reference}`,
      html: `
        <p>${name}</p>
        <h1>Your order has been cancelled${refunded ? ' and refunded' : ''}</h1>
        ${referenceBox(order, refunded ? 'Cancelled and refunded' : 'Cancelled')}
        <p>${escapeHtml(order.pickup_store)} has cancelled your ${kind}.</p>
        ${reason ? `<p>${escapeHtml(reasonLine)}</p>` : ''}
        ${refunded ? `<p><strong>${refundLine}</strong></p>` : ''}
        <p>Questions? Contact ${escapeHtml(order.pickup_store)} at ${escapeHtml(store.phone)} with your reference.</p>`,
      text: `${order.customer_name ? `Hi ${order.customer_name},\n\n` : ''}${order.pickup_store} has cancelled your ${kind} ${order.reference}.${reason ? `\n${reasonLine}` : ''}${refunded ? `\n\n${refundLine}` : ''}\n\nQuestions? Contact ${order.pickup_store} at ${store.phone}.`
    };
  }

  return null;
}

/* The site owner is copied on staff cancellations, as on customer ones. */
export function sendCustomerEmail(env, action, order, details) {
  const email = buildCustomerEmail(action, order, details);
  if (!email) return null;
  return sendEmail(env, {
    from: FROM_ADDRESS,
    to: order.email,
    bcc: action === 'refund' ? [ALWAYS_NOTIFY] : undefined,
    replyTo: STORES[order.pickup_store].email,
    ...email
  });
}
