import {
  onRequestPost as createPickupOrder
} from './functions/api/pickup-order.js';
import {
  onRequestPost as cancelPickupOrder
} from './functions/api/cancel-pickup-order.js';
import { onRequestPost as stripeWebhook } from './functions/api/stripe-webhook.js';
import { onRequestGet as checkoutStatus } from './functions/api/checkout-status.js';
import { onRequestGet as checkoutOptions } from './functions/api/checkout-options.js';
import { onRequestGet as staffOrders } from './functions/api/staff-orders.js';
import { onRequestPost as staffOrderAction } from './functions/api/staff-order-action.js';

import { rateLimited } from './lib/abuse-protection.js';

/* path → [method, handler, rate limited]. The Stripe webhook isn't rate
   limited: it comes from Stripe's few servers and is signature-checked. */
const API_ROUTES = new Map([
  ['/api/pickup-order', ['POST', createPickupOrder, true]],
  ['/api/cancel-pickup-order', ['POST', cancelPickupOrder, true]],
  ['/api/checkout-status', ['GET', checkoutStatus, true]],
  ['/api/checkout-options', ['GET', checkoutOptions, false]],   /* cacheable, no side effects */
  ['/api/stripe-webhook', ['POST', stripeWebhook, false]],
  ['/api/staff-orders', ['GET', staffOrders, true]],
  ['/api/staff-order-action', ['POST', staffOrderAction, true]]
]);

const tooManyRequests = () => new Response(
  JSON.stringify({ success: false, message: 'Too many requests. Please wait a minute and try again.' }),
  {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' }
  }
);

const methodNotAllowed = (allow) => new Response(
  JSON.stringify({ success: false, message: 'Method not allowed.' }),
  {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Allow: allow
    }
  }
);

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const route = API_ROUTES.get(pathname);
    if (!route) return env.ASSETS.fetch(request);

    const [method, handler, limited] = route;
    if (request.method !== method) return methodNotAllowed(method);
    if (limited && await rateLimited(env, request, pathname)) return tooManyRequests();
    return handler({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
  }
};
