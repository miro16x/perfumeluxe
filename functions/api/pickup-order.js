import { accountOrdersEnabled, getSignedInUser, saveAccountOrder } from '../../lib/supabase.js';
import { cancelSigningEnabled, signCancellation } from '../../lib/cancel-token.js';
import { turnstileEnabled, verifyTurnstile } from '../../lib/abuse-protection.js';
import { alertOwner } from '../../lib/alerts.js';
import { priceCartItem } from '../../lib/catalog.js';
import { paymentsEnabled, createCheckoutSession } from '../../lib/stripe.js';
import { sendOrderEmails, buildOrderEmails } from '../../lib/order-emails.js';
import { STORES, CANCEL_WINDOW_MS } from '../../lib/stores.js';
import { SHIPPING_STORE, normalizeAddress, shippingCost } from '../../lib/shipping.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/* Carts saved before sizes were sent separately carry the size in the name. */
const requestedSize = (item) => item.size ?? String(item.name || '').split(' · ')[1] ?? '';

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.RESEND_API_KEY) return json({ success: false, message: 'Email service is not configured.' }, 503);

  let order;
  try {
    order = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid order data.' }, 400);
  }

  /* Shipping orders always come from Luxe Fragrances and must be paid online. */
  const shipping = order.fulfillment === 'shipping';
  if (shipping && !paymentsEnabled(env)) {
    return json({ success: false, message: 'Shipping is not available yet. Please choose store pickup.' }, 409);
  }
  const shippingAddress = shipping ? normalizeAddress(order.shippingAddress) : null;
  const storeName = shipping ? SHIPPING_STORE : order.pickupStore;
  const store = STORES[storeName];
  const requested = Array.isArray(order.items) ? order.items.slice(0, 50) : [];
  /* Names and prices come from the catalog, never from the request. */
  const items = requested.map((item) => priceCartItem({ id: item.id, size: requestedSize(item), qty: item.qty }));
  const phoneDigits = String(order.phone || '').replace(/\D/g, '');

  if (!store || !validEmail(String(order.email || '')) || phoneDigits.length < 10 ||
      String(order.customerName || '').trim().length < 2 || (!shipping && (!order.pickupDate || !order.pickupTime))) {
    return json({ success: false, message: 'Required order information is missing or invalid.' }, 400);
  }
  if (shipping && !shippingAddress) {
    return json({ success: false, message: 'Enter a complete shipping address in the 50 states, Washington, D.C. or Puerto Rico.' }, 400);
  }
  if (!items.length || items.includes(null)) {
    return json({ success: false, message: 'Some items in your cart are no longer available. Please remove them and try again.' }, 400);
  }

  /* Checked before any email is sent or payment started, so scripts can't use
     this endpoint to email stores or arbitrary addresses. Off until the secret is configured. */
  if (turnstileEnabled(env) && !(await verifyTurnstile(env, request, order.turnstileToken, waitUntil))) {
    return json({ success: false, message: 'We could not verify this request. Please complete the security check and try again.' }, 403);
  }

  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const reference = `LP-${dateStamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const placedAt = new Date();
  const details = {
    reference,
    customerName: String(order.customerName).trim().slice(0, 120),
    customerEmail: String(order.email).trim().slice(0, 254),
    phone: String(order.phone).trim().slice(0, 40),
    pickupStore: storeName,
    pickupDate: shipping ? '' : String(order.pickupDateLabel || order.pickupDate).slice(0, 80),
    pickupTime: shipping ? '' : String(order.pickupTime).slice(0, 40),
    fulfillment: shipping ? 'shipping' : 'pickup',
    shippingAddress,
    shippingCost: shipping ? shippingCost(items.reduce((sum, item) => sum + item.price * item.qty, 0)) : 0,
    items,
    placedAt
  };

  /* Online payment: the customer pays on Stripe's page first. The store is only
     emailed once Stripe confirms payment (functions/api/stripe-webhook.js). */
  if (paymentsEnabled(env)) {
    try {
      const user = request.headers.get('Authorization')
        ? await getSignedInUser(request, env).catch(() => null)
        : null;
      const session = await createCheckoutSession(env, {
        reference,
        origin: new URL(request.url).origin,
        email: details.customerEmail,
        items,
        metadata: {
          customerName: details.customerName,
          phone: details.phone,
          pickupStore: details.pickupStore,
          pickupDate: details.pickupDate,
          pickupTime: details.pickupTime,
          placedAt: placedAt.toISOString(),
          userId: user?.id || '',
          fulfillment: details.fulfillment,
          ...(shipping ? {
            shipLine1: shippingAddress.line1,
            shipLine2: shippingAddress.line2,
            shipCity: shippingAddress.city,
            shipState: shippingAddress.state,
            shipZip: shippingAddress.zip
          } : {})
        },
        shipping: shipping
          ? { cost: details.shippingCost, address: shippingAddress, name: details.customerName, phone: details.phone }
          : undefined
      });
      return json({ success: true, orderReference: reference, checkoutUrl: session.url });
    } catch (error) {
      console.error('Stripe checkout failed', reference, error?.code, error?.message, error?.providerError);
      await alertOwner(env, waitUntil, {
        kind: 'stripe-checkout-failed',
        subject: 'Customers cannot start payment',
        details: `Stripe refused to start checkout for ${reference} (${error?.code || 'unknown error'}${error?.providerError ? `: ${error.providerError}` : ''}).\nCheck the STRIPE_SECRET_KEY Worker secret and the Stripe dashboard. To take orders without payment meanwhile, delete STRIPE_SECRET_KEY.`
      });
      return json({
        success: false,
        message: `We could not start the payment. Please try again, or call ${details.pickupStore} at ${store.phone}.`
      }, 502);
    }
  }

  /* Pay at pickup (online payment not configured): email the store now. */
  const cancelBy = new Date(placedAt.getTime() + CANCEL_WINDOW_MS);
  try {
    const { storeResult, customerResult, customerEmailSent, total, count } =
      await sendOrderEmails(env, waitUntil, { ...details, paid: false });

    /* Signed-in customers get the order added to their account history. This
       is best-effort: the order is already accepted, so a failure here is
       logged and never turns a sent order into an error for the customer. */
    if (accountOrdersEnabled(env) && request.headers.get('Authorization')) {
      const saveToAccount = (async () => {
        const user = await getSignedInUser(request, env);
        if (!user) return;
        await saveAccountOrder(env, user.id, {
          reference,
          email: details.customerEmail.toLowerCase(),
          pickup_store: details.pickupStore,
          pickup_date: details.pickupDate,
          pickup_time: details.pickupTime,
          items: items.map(({ id, name, brand, size, price, qty }) => ({ id, name, brand, size, price, qty })),
          item_count: count,
          total: Number(total.toFixed(2)),
          placed_at: placedAt.toISOString()
        });
      })().catch((error) => {
        console.error('Pickup order account save failed', reference, error?.message);
        return alertOwner(env, waitUntil, {
          kind: 'account-save-failed',
          subject: 'Orders are not being saved to customer accounts',
          details: `Order ${reference} was sent to the store but could not be added to the customer's order history: ${error?.message}\nCheck the SUPABASE_SERVICE_ROLE_KEY Worker secret and the Supabase project status.`
        });
      });
      if (typeof waitUntil === 'function') waitUntil(saveToAccount);
      else await saveToAccount;
    }

    /* Proof for /api/cancel-pickup-order that these details came from us.
       Without the secret, online cancellation is off (the store can still cancel). */
    const cancelToken = cancelSigningEnabled(env)
      ? await signCancellation(env, { reference, email: details.customerEmail, pickupStore: details.pickupStore, placedAt: placedAt.toISOString() })
      : null;

    return json({
      success: true,
      orderReference: reference,
      pickupStore: details.pickupStore,
      pickupAddress: store.address,
      storePhone: store.phone,
      placedAt: placedAt.toISOString(),
      cancelBy: cancelBy.toISOString(),
      cancelToken,
      customerEmailSent,
      paid: false,
      messageIds: [storeResult?.messageId, customerResult?.messageId].filter(Boolean)
    });
  } catch (error) {
    console.error('Pickup email delivery failed', reference, error?.code, error?.message, error?.providerError);
    const errorCode = /^RESEND_(HTTP_\d{3}|INVALID_RESPONSE)$/.test(error?.code || '')
      ? error.code : 'EMAIL_SEND_FAILED';
    /* The store never got this order and the customer was told to call. Every
       one is sent, with the full order, so it can be passed on by hand. */
    await alertOwner(env, waitUntil, {
      kind: 'order-email-failed',
      throttle: false,
      subject: `ORDER NOT DELIVERED to ${details.pickupStore} — ${reference}`,
      details: `The store notification failed (${errorCode}${error?.providerError ? `: ${error.providerError}` : ''}), so ${details.pickupStore} did not receive this order. The customer was asked to call the store.\n\n${buildOrderEmails({ ...details, paid: false }).storeText}`
    });
    return json({
      success: false,
      errorCode,
      message: `Unable to send your pickup request to the store. Please contact ${details.pickupStore} at ${store.phone}. (${errorCode})`
    }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
