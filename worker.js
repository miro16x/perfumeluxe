import {
  onRequestPost as createPickupOrder
} from './functions/api/pickup-order.js';
import {
  onRequestPost as cancelPickupOrder
} from './functions/api/cancel-pickup-order.js';

import { rateLimited } from './lib/abuse-protection.js';

const API_ROUTES = new Set(['/api/pickup-order', '/api/cancel-pickup-order']);

const tooManyRequests = () => new Response(
  JSON.stringify({ success: false, message: 'Too many requests. Please wait a minute and try again.' }),
  {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' }
  }
);

const methodNotAllowed = () => new Response(
  JSON.stringify({ success: false, message: 'Method not allowed.' }),
  {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Allow: 'POST'
    }
  }
);

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (API_ROUTES.has(pathname) && request.method === 'POST' && await rateLimited(env, request, pathname)) {
      return tooManyRequests();
    }

    if (pathname === '/api/pickup-order') {
      return request.method === 'POST'
        ? createPickupOrder({ request, env, waitUntil: ctx.waitUntil.bind(ctx) })
        : methodNotAllowed();
    }

    if (pathname === '/api/cancel-pickup-order') {
      return request.method === 'POST'
        ? cancelPickupOrder({ request, env, waitUntil: ctx.waitUntil.bind(ctx) })
        : methodNotAllowed();
    }

    return env.ASSETS.fetch(request);
  }
};
