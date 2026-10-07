// Store notification and customer confirmation for an order: store pickup
// (paid online, or pay at pickup when Stripe is off) or shipping (always paid).
// Paid orders are sent once the Stripe webhook confirms payment.
import { sendEmail } from './email.js';
import { alertOwner } from './alerts.js';
import { STORES, ALWAYS_NOTIFY, FROM_ADDRESS, CANCEL_WINDOW_MS, escapeHtml } from './stores.js';
import { formatAddress } from './shipping.js';

const money = (amount) => `$${Number(amount).toFixed(2)}`;
const itemLabel = (item) => item.size ? `${item.name} · ${item.size}` : item.name;
const itemBrand = (item) => String(item.brand || '').trim() || 'Not specified';
const astTime = (date, options) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'America/St_Thomas' }).format(date);

/* `order`: reference, customerName, customerEmail, phone, pickupStore, items
   (priced), placedAt (Date), paid, and either pickupDate (display label) and
   pickupTime, or fulfillment 'shipping' with shippingAddress and shippingCost. */
export function buildOrderEmails(order) {
  const store = STORES[order.pickupStore];
  const shipping = order.fulfillment === 'shipping';
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shippingCost = shipping ? Number(order.shippingCost || 0) : 0;
  const total = subtotal + shippingCost;
  const count = order.items.reduce((sum, item) => sum + item.qty, 0);
  const submittedAt = astTime(order.placedAt, { dateStyle: 'full', timeStyle: 'long' });
  const cancelBy = astTime(new Date(order.placedAt.getTime() + CANCEL_WINDOW_MS), { dateStyle: 'medium', timeStyle: 'short' });
  const shipTo = shipping ? formatAddress(order.shippingAddress) : '';
  const shipToHtml = escapeHtml(shipTo).replaceAll('\n', '<br>');

  const itemRows = order.items.map((item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(itemBrand(item))}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(itemLabel(item))}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center">${item.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(item.price)}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">${money(item.price * item.qty)}</td>
    </tr>`).join('');
  const itemText = order.items.map((item) =>
    `- ${itemLabel(item)} | Brand: ${itemBrand(item)} | Qty ${item.qty} | ${money(item.price)} each | ${money(item.price * item.qty)}`
  ).join('\n');
  const itemTable = `
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="padding:8px;text-align:left">Brand</th><th style="padding:8px;text-align:left">Fragrance</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>`;
  const shippingLine = shipping ? `Shipping: ${shippingCost ? money(shippingCost) : 'Free'}` : '';
  const totalsHtml = shipping
    ? `<p>Items: ${money(subtotal)}<br>${shippingLine}<br><strong>Total: ${money(total)}</strong></p>`
    : '';
  const totalsText = shipping ? `Items: ${money(subtotal)}\n${shippingLine}\nTotal: ${money(total)}` : '';
  const referenceBox = (note) => `
    <div style="margin:20px 0;padding:18px;border:2px solid #b08d32;text-align:center">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">${shipping ? 'Order reference' : 'Pickup reference'}</div>
      <strong style="display:block;font-size:24px;margin-top:6px">${escapeHtml(order.reference)}</strong>
      <div style="font-size:13px;margin-top:6px">${note}</div>
    </div>`;

  const storePayment = shipping
    ? `PAID ONLINE: ${money(total)} (including ${shippingCost ? `${money(shippingCost)} shipping` : 'free shipping'}). Ship to the address below.`
    : order.paid
      ? `PAID ONLINE: ${money(total)}. Do not charge the customer at pickup.`
      : `Payment due at pickup: ${money(total)}.`;
  /* Holding shipment until the window closes means a customer can never cancel
     (and be refunded automatically) an order that has already left the store. */
  const storeShipNote = shipping
    ? `The customer can cancel for a full refund until ${cancelBy} AST. Please ship after that time.`
    : '';
  const customerPayment = shipping
    ? `Paid online: ${money(total)}.`
    : order.paid
      ? `Paid online: ${money(total)}. Nothing more to pay at pickup.`
      : `Total due at pickup: ${money(total)}.`;
  const cancelNote = shipping
    ? 'You may cancel within 24 hours of placing this order for a full refund, using the cancellation option on your order-confirmation screen or by contacting Luxe Fragrances with your order reference. Your order ships after that.'
    : order.paid
      ? 'You may cancel within 24 hours of placing this order for a full refund. Use the cancellation option on your order-confirmation screen, or contact the store with your pickup reference.'
      : 'You may request cancellation within 24 hours of placing this order. Use the cancellation option on your order-confirmation screen, or contact the store with your pickup reference.';
  const closingNote = shipping
    ? 'Luxe Fragrances will email you tracking details when your order ships, or contact you if an item is unavailable, in which case it will be refunded.'
    : `The store will contact you when your order is ready, or if an item is unavailable${order.paid ? ', in which case it will be refunded' : ''}. Please bring a photo ID.`;

  const title = shipping ? 'New Shipping Order (Paid)' : `New Store Pick-Up Order${order.paid ? ' (Paid)' : ''}`;
  const storeHtml = `
    <h1>${title}</h1>
    ${referenceBox(shipping ? 'Include this reference with the shipment.' : "Use this reference to identify the customer's pickup order.")}
    <p style="padding:12px;background:${order.paid ? '#e8f5e9' : '#fff8e1'};font-weight:bold">${storePayment}${storeShipNote ? `<br>${storeShipNote}` : ''}</p>
    <h2>Customer</h2>
    <p><strong>Name:</strong> ${escapeHtml(order.customerName)}<br>
    <strong>Phone:</strong> ${escapeHtml(order.phone)}<br>
    <strong>Email:</strong> ${escapeHtml(order.customerEmail)}</p>
    ${shipping
      ? `<h2>Ship to</h2><p>${escapeHtml(order.customerName)}<br>${shipToHtml}</p>`
      : `<h2>Pickup</h2>
    <p><strong>Store:</strong> ${escapeHtml(order.pickupStore)}<br>
    <strong>Address:</strong> ${escapeHtml(store.address)}<br>
    <strong>Date:</strong> ${escapeHtml(order.pickupDate)}<br>
    <strong>Time:</strong> ${escapeHtml(order.pickupTime)}</p>`}
    ${itemTable}
    ${totalsHtml || `<p><strong>${count} item${count === 1 ? '' : 's'} · Total: ${money(total)}</strong></p>`}
    <p><small>Submitted ${escapeHtml(submittedAt)} AST</small></p>`;
  const storeText = `${title}\n\nOrder: ${order.reference}\n${storePayment}${storeShipNote ? `\n${storeShipNote}` : ''}\n\nCustomer: ${order.customerName}\nPhone: ${order.phone}\nEmail: ${order.customerEmail}\n${shipping
    ? `\nSHIP TO:\n${order.customerName}\n${shipTo}`
    : `Store: ${order.pickupStore}\nAddress: ${store.address}\nPickup: ${order.pickupDate} at ${order.pickupTime}`}\n\n${itemText}\n\n${totalsText || `${count} item(s) · Total: ${money(total)}`}\nSubmitted: ${submittedAt} AST`;

  const customerHtml = `
    <h1>${shipping ? 'Your order is paid and will ship soon' : order.paid ? 'Your order is paid and on its way to the store' : 'We received your pick-up request'}</h1>
    <p>Hi ${escapeHtml(order.customerName)},</p>
    ${shipping
      ? `<p>Your order will be shipped by Luxe Fragrances to:</p><p><strong>${escapeHtml(order.customerName)}<br>${shipToHtml}</strong></p>`
      : `<p>Your order was sent to ${escapeHtml(order.pickupStore)} for pickup on <strong>${escapeHtml(order.pickupDate)} at ${escapeHtml(order.pickupTime)}</strong>.</p>`}
    ${referenceBox(shipping ? 'Keep this reference for any questions about your order.' : 'Show this reference when collecting your order.')}
    ${shipping ? '' : `<p><strong>Pickup address:</strong><br>${escapeHtml(store.address)}<br>${escapeHtml(store.phone)}</p>`}
    ${itemTable}
    ${totalsHtml}
    <p><strong>${customerPayment}</strong></p>
    <p>${cancelNote}</p>
    <p>${closingNote}</p>`;
  const customerText = `Hi ${order.customerName},\n\n${shipping
    ? `Your order is paid and will be shipped by Luxe Fragrances to:\n${order.customerName}\n${shipTo}\n\nORDER REFERENCE: ${order.reference}`
    : `${order.paid ? 'Your order is paid and has been sent to the store.' : 'We received your pickup request.'}\n\nPICKUP REFERENCE: ${order.reference}\nShow this reference when collecting your order.\n\nStore: ${order.pickupStore}\nAddress: ${store.address}\nPhone: ${store.phone}\nPickup: ${order.pickupDate} at ${order.pickupTime}`}\n\n${itemText}\n\n${totalsText ? `${totalsText}\n\n` : ''}${customerPayment}\n\n${cancelNote}\n\n${closingNote}`;

  return {
    total,
    subtotal,
    count,
    storeText,
    store: {
      to: store.email,
      subject: shipping
        ? `New Shipping Order (PAID) — ${order.reference}`
        : `New Store Pick-Up Order${order.paid ? ' (PAID)' : ''} — ${order.reference}`,
      html: storeHtml,
      text: storeText
    },
    customer: {
      subject: order.paid
        ? `Your Luxe Perfume order is paid — ${order.reference}`
        : `We received your Luxe Perfume pickup request — ${order.reference}`,
      html: customerHtml,
      text: customerText
    }
  };
}

/* Throws if the store notification fails. A failed customer confirmation is
   alerted and reported through `customerEmailSent` instead. */
export async function sendOrderEmails(env, waitUntil, order) {
  const emails = buildOrderEmails(order);
  const store = STORES[order.pickupStore];
  const storeResult = await sendEmail(env, {
    from: FROM_ADDRESS,
    to: emails.store.to,
    bcc: [ALWAYS_NOTIFY],
    replyTo: order.customerEmail,
    subject: emails.store.subject,
    html: emails.store.html,
    text: emails.store.text
  });

  let customerResult;
  let customerEmailSent = false;
  try {
    customerResult = await sendEmail(env, {
      from: FROM_ADDRESS,
      to: order.customerEmail,
      replyTo: store.email,
      subject: emails.customer.subject,
      html: emails.customer.html,
      text: emails.customer.text
    });
    customerEmailSent = true;
  } catch (error) {
    console.error('Pickup customer receipt failed', order.reference, error?.code, error?.message, error?.providerError);
    await alertOwner(env, waitUntil, {
      kind: 'customer-receipt-failed',
      subject: `Customer confirmation email failed — ${order.reference}`,
      details: `The store received order ${order.reference}, but the confirmation to ${order.customerEmail} was rejected (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}).\nThe customer saw their reference on screen. If this repeats, check the Resend dashboard.`
    });
  }
  return { storeResult, customerResult, customerEmailSent, total: emails.total, count: emails.count };
}
