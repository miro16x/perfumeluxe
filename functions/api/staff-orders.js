// Staff dashboard: the signed-in staff member's orders, newest first.
// ?view=open (default) lists orders still to fulfil; ?view=done the rest.
import { accountOrdersEnabled, listStaffOrders } from '../../lib/supabase.js';
import { getStaff } from '../../lib/staff.js';
import { CANCEL_WINDOW_MS } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const VIEWS = {
  open: ['placed', 'paid', 'ready'],
  done: ['shipped', 'collected', 'cancelled', 'refunded']
};

export async function onRequestGet({ request, env }) {
  if (!accountOrdersEnabled(env)) return json({ success: false, message: 'The order database is not configured.' }, 503);

  let staff;
  try {
    staff = await getStaff(request, env);
  } catch (error) {
    console.error('Staff lookup failed', error?.message);
    return json({ success: false, message: 'Unable to check staff access right now. Please try again.' }, 502);
  }
  if (!staff) return json({ success: false, message: 'This account does not have staff access.' }, 403);

  const view = new URL(request.url).searchParams.get('view') || 'open';
  if (!VIEWS[view]) return json({ success: false, message: 'Unknown view.' }, 400);

  try {
    const orders = await listStaffOrders(env, { store: staff.store, statuses: VIEWS[view] });
    return json({
      success: true,
      staff: { name: staff.name, store: staff.store },
      cancelWindowMs: CANCEL_WINDOW_MS,
      orders
    });
  } catch (error) {
    console.error('Staff order list failed', error?.message);
    return json({ success: false, message: 'Unable to load orders right now. Please try again.' }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
