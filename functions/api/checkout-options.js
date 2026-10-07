// Tells the cart what to offer: online payment, and shipping (which needs it).
import { paymentsEnabled } from '../../lib/stripe.js';
import { SHIPPING_STORE, FLAT_RATE, FREE_OVER, SHIPPING_STATES } from '../../lib/shipping.js';

export function onRequestGet({ env }) {
  const payments = paymentsEnabled(env);
  return new Response(JSON.stringify({
    payments,
    shipping: payments
      ? { fromStore: SHIPPING_STORE, flatRate: FLAT_RATE, freeOver: FREE_OVER, states: SHIPPING_STATES }
      : null
  }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
  });
}
