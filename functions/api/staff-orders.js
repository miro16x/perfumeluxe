// Staff dashboard: the signed-in staff member's orders, newest first.
// ?view=open (default) lists orders still to fulfil; ?view=done the rest.
// &activity=1 adds every order of the last ACTIVITY_DAYS (no customer
// details) for the activity chart, in the same request so the dashboard's
// refresh stays well inside the rate limit.
import { accountOrdersEnabled, listStaffOrders, ACTIVITY_FIELDS } from '../../lib/supabase.js';
import { getStaff, staffLookupFailure } from '../../lib/staff.js';
import { CANCEL_WINDOW_MS } from '../../lib/stores.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const VIEWS = {
  open: ['placed', 'paid', 'ready'],
  done: ['shipped', 'collected', 'cancelled', 'refunded']
};
const ACTIVITY_DAYS = 14;

export async function onRequestGet({ request, env, waitUntil }) {
  if (!accountOrdersEnabled(env)) return json({ success: false, message: 'The order database is not configured.' }, 503);

  let staff;
  try {
    staff = await getStaff(request, env);
  } catch (error) {
    return json(await staffLookupFailure(env, waitUntil, error), 502);
  }
  if (!staff) return json({ success: false, message: 'This account does not have staff access.' }, 403);

  const params = new URL(request.url).searchParams;
  const view = params.get('view') || 'open';
  if (!Object.hasOwn(VIEWS, view)) return json({ success: false, message: 'Unknown view.' }, 400);
  const withActivity = params.get('activity') === '1';

  /* A day of margin so the oldest day is complete in every time zone. */
  const since = new Date(Date.now() - (ACTIVITY_DAYS + 1) * 24 * 60 * 60 * 1000);
  try {
    const [orders, activity] = await Promise.all([
      listStaffOrders(env, { store: staff.store, statuses: VIEWS[view] }),
      withActivity
        ? listStaffOrders(env, { store: staff.store, since, fields: ACTIVITY_FIELDS, limit: 2000 })
        : null
    ]);
    return json({
      success: true,
      staff: { name: staff.name, store: staff.store },
      cancelWindowMs: CANCEL_WINDOW_MS,
      orders,
      ...(withActivity ? { activity: { days: ACTIVITY_DAYS, orders: activity } } : {})
    });
  } catch (error) {
    console.error('Staff order list failed', error?.message);
    return json({ success: false, message: 'Unable to load orders right now. Please try again.' }, 502);
  }
}

export function onRequest() {
  return json({ success: false, message: 'Method not allowed.' }, 405);
}
