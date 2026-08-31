const STORES = {
  'Luxe Fragrances': {
    email: 'luxefragrances.vi@gmail.com',
    address: '9001 Havensight Mall, Suite A & B, St. Thomas, VI 00802',
    phone: '340-693-0039'
  },
  'Perfume World': {
    email: 'perfumeworldvi@gmail.com',
    address: '4605 Tutu Park Mall, St. Thomas, VI 00802',
    phone: '340-777-5504'
  }
};

const ALWAYS_NOTIFY = 'amirslem679@gmail.com';
const FROM_ADDRESS = { email: 'orders@luxeperfume.com', name: 'Luxe Perfume Pickup' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function onRequestPost({ request, env }) {
  if (!env.EMAIL) return json({ success: false, message: 'Email service is not configured.' }, 503);

  let order;
  try {
    order = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid order data.' }, 400);
  }

  const store = STORES[order.pickupStore];
  const items = Array.isArray(order.items) ? order.items.slice(0, 50) : [];
  const phoneDigits = String(order.phone || '').replace(/\D/g, '');
  const validItems = items.length > 0 && items.every((item) =>
    String(item.name || '').trim() && Number.isFinite(Number(item.price)) && Number.isInteger(Number(item.qty)) && Number(item.qty) > 0
  );

  if (!store || !validEmail(String(order.email || '')) || phoneDigits.length < 10 ||
      String(order.customerName || '').trim().length < 2 || !order.pickupDate || !order.pickupTime || !validItems) {
    return json({ success: false, message: 'Required pickup-order information is missing or invalid.' }, 400);
  }

  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const reference = `LP-${dateStamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const placedAt = new Date();
  const cancelBy = new Date(placedAt.getTime() + 24 * 60 * 60 * 1000);
  const customerName = String(order.customerName).trim().slice(0, 120);
  const customerEmail = String(order.email).trim().slice(0, 254);
  const phone = String(order.phone).trim().slice(0, 40);
  const pickupStore = String(order.pickupStore);
  const pickupAddress = store.address;
  const pickupDate = String(order.pickupDateLabel || order.pickupDate).slice(0, 80);
  const pickupTime = String(order.pickupTime).slice(0, 40);
  const submittedAt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeStyle: 'long', timeZone: 'America/St_Thomas'
  }).format(placedAt);
  const calculatedTotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  const calculatedCount = items.reduce((sum, item) => sum + Number(item.qty), 0);
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(String(item.name).slice(0, 200))}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center">${Number(item.qty)}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">$${Number(item.price).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right">$${(Number(item.price) * Number(item.qty)).toFixed(2)}</td>
    </tr>`).join('');
  const itemText = items.map((item) =>
    `- ${String(item.name).slice(0, 200)} | Qty ${Number(item.qty)} | $${Number(item.price).toFixed(2)} each | $${(Number(item.price) * Number(item.qty)).toFixed(2)}`
  ).join('\n');

  const storeHtml = `
    <h1>New Store Pick-Up Order</h1>
    <p><strong>Order:</strong> ${escapeHtml(reference)}</p>
    <h2>Customer</h2>
    <p><strong>Name:</strong> ${escapeHtml(customerName)}<br>
    <strong>Phone:</strong> ${escapeHtml(phone)}<br>
    <strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
    <h2>Pickup</h2>
    <p><strong>Store:</strong> ${escapeHtml(pickupStore)}<br>
    <strong>Address:</strong> ${escapeHtml(pickupAddress)}<br>
    <strong>Date:</strong> ${escapeHtml(pickupDate)}<br>
    <strong>Time:</strong> ${escapeHtml(pickupTime)}</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="padding:8px;text-align:left">Fragrance</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p><strong>${calculatedCount} item${calculatedCount === 1 ? '' : 's'} · Total: $${calculatedTotal.toFixed(2)}</strong></p>
    <p><small>Submitted ${escapeHtml(submittedAt)} AST</small></p>`;
  const storeText = `New Store Pick-Up Order\n\nOrder: ${reference}\nCustomer: ${customerName}\nPhone: ${phone}\nEmail: ${customerEmail}\nStore: ${pickupStore}\nAddress: ${pickupAddress}\nPickup: ${pickupDate} at ${pickupTime}\n\n${itemText}\n\n${calculatedCount} item(s) · Total: $${calculatedTotal.toFixed(2)}\nSubmitted: ${submittedAt} AST`;

  const customerHtml = `
    <h1>We received your pick-up request</h1>
    <p>Hi ${escapeHtml(customerName)},</p>
    <p>Your order request was sent to ${escapeHtml(pickupStore)} for pickup on <strong>${escapeHtml(pickupDate)} at ${escapeHtml(pickupTime)}</strong>.</p>
    <div style="margin:20px 0;padding:18px;border:2px solid #b08d32;text-align:center">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">Pickup reference</div>
      <strong style="display:block;font-size:24px;margin-top:6px">${escapeHtml(reference)}</strong>
      <div style="font-size:13px;margin-top:6px">Show this reference when collecting your order.</div>
    </div>
    <p><strong>Pickup address:</strong><br>${escapeHtml(pickupAddress)}<br>${escapeHtml(store.phone)}</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="padding:8px;text-align:left">Fragrance</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p><strong>Total: $${calculatedTotal.toFixed(2)}</strong></p>
    <p>You may request cancellation within 24 hours of placing this order. Use the cancellation option on your order-confirmation screen, or contact the store with your pickup reference.</p>
    <p>This confirms receipt of your request, not product availability. The store will contact you when your order is ready. Please bring a photo ID.</p>`;
  const customerText = `Hi ${customerName},\n\nWe received your pickup request.\n\nPICKUP REFERENCE: ${reference}\nShow this reference when collecting your order.\n\nStore: ${pickupStore}\nAddress: ${pickupAddress}\nPhone: ${store.phone}\nPickup: ${pickupDate} at ${pickupTime}\n\n${itemText}\n\nTotal: $${calculatedTotal.toFixed(2)}\n\nYou may request cancellation within 24 hours of placing this order. Use the cancellation option on your order-confirmation screen, or contact the store with your pickup reference.\n\nThis confirms receipt of your request, not product availability. The store will contact you when it is ready. Please bring a photo ID.`;

  try {
    const results = await Promise.all([
      env.EMAIL.send({
        from: FROM_ADDRESS,
        to: store.email,
        bcc: [ALWAYS_NOTIFY],
        replyTo: customerEmail,
        subject: `New Store Pick-Up Order — ${reference}`,
        html: storeHtml,
        text: storeText
      }),
      env.EMAIL.send({
        from: FROM_ADDRESS,
        to: customerEmail,
        replyTo: store.email,
        subject: `We received your Luxe Perfume pickup request — ${reference}`,
        html: customerHtml,
        text: customerText
      })
    ]);

    return json({
      success: true,
      orderReference: reference,
      pickupStore,
      pickupAddress,
      storePhone: store.phone,
      placedAt: placedAt.toISOString(),
      cancelBy: cancelBy.toISOString(),
      messageIds: results.map((result) => result.messageId)
    });
  } catch (error) {
    console.error('Pickup email delivery failed', error?.code, error?.message);
    return json({ success: false, message: 'Unable to deliver pickup-order email.' }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
