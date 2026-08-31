const STORES = {
  'Luxe Fragrances': { email: 'luxefragrances.vi@gmail.com' },
  'Perfume World': { email: 'perfumeworldvi@gmail.com' }
};

const ALWAYS_NOTIFY = 'amirslem679@gmail.com';
const FROM_ADDRESS = { email: 'orders@luxeperfume.com', name: 'Luxe Perfume Pickup' };
const DAY_MS = 24 * 60 * 60 * 1000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function onRequestPost({ request, env }) {
  if (!env.EMAIL) return json({ success: false, message: 'Email service is not configured.' }, 503);

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
  if (age < 0 || age > DAY_MS) {
    return json({ success: false, message: 'The 24-hour cancellation window has closed.' }, 409);
  }

  const subject = `Pickup cancellation requested — ${reference}`;
  const text = `CANCEL PICKUP ORDER\n\nOrder: ${reference}\nCustomer email: ${email}\nStore: ${pickupStore}\n\nThis cancellation was requested within 24 hours of the order being placed.`;

  try {
    await Promise.all([
      env.EMAIL.send({ from: FROM_ADDRESS, to: store.email, bcc: [ALWAYS_NOTIFY], replyTo: email, subject, text }),
      env.EMAIL.send({ from: FROM_ADDRESS, to: email, replyTo: store.email, subject: `We received your cancellation request — ${reference}`, text: `We received your request to cancel pickup order ${reference}. ${pickupStore} has been notified. Keep this message for your records.` })
    ]);
    return json({ success: true, orderReference: reference });
  } catch (error) {
    console.error('Pickup cancellation email delivery failed', error?.code, error?.message);
    return json({ success: false, message: 'Unable to deliver the cancellation request.' }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
