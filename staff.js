/* ── STAFF DASHBOARD ──────────────────────────────────────────────
   Staff sign in with their site account (Supabase). Every order and action
   goes through /api/staff-orders and /api/staff-order-action, which check
   the staff table on the server, so this page decides nothing about access. */

const ST_SUPABASE_URL = 'https://bvffpffnyjfufprcdskb.supabase.co';
const ST_SUPABASE_KEY = 'sb_publishable_NGGc4fVDwCVlsInS2NT51g_ymNOYi7w';
const ST_SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const ST_REFRESH_MS = 30 * 1000;   /* also how quickly new orders are noticed */
const ST_TIMEOUT_MS = 15 * 1000;   /* give up on the sign-in service after this */

const STATUS_LABEL = {
  placed: 'Pay at pickup', paid: 'Paid', ready: 'Ready', shipped: 'Shipped',
  collected: 'Picked up', cancelled: 'Cancelled', refunded: 'Refunded'
};
const CARRIERS = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL' };

const $ = (id) => document.getElementById(id);
const state = { client: null, email: '', activity: null, updatedAt: null, view: 'open', type: 'all', orders: [], allStores: false, cancelWindowMs: 0, busy: new Set() };

const money = (amount) => `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const astTime = (value) => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/St_Thomas'
}).format(new Date(value));

/* Builds an element. Text always goes in as textContent, never as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

function showView(id) {
  for (const view of ['signInView', 'errorView', 'noAccessView', 'ordersView']) $(view).hidden = view !== id;
}

/* Errors before the order list has ever shown get their own panel, so the
   page is never left blank; later ones go in the status line above the list. */
function showError(message) {
  if (!$('ordersView').hidden) return flash(message, true);
  $('errorText').textContent = message;
  $('staffWho').hidden = !state.email;
  if (state.email && !$('staffName').textContent) $('staffName').textContent = state.email;
  showView('errorView');
}

function withTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ST_TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const getSession = async () => {
  const { data } = await withTimeout(state.client.auth.getSession(), 'The sign-in service is not responding.');
  state.email = data.session?.user?.email || '';
  return data.session;
};

/* ── API ─────────────────────────────────────────────── */

async function api(path, options = {}) {
  const token = (await getSession())?.access_token;
  if (!token) return { status: 401, body: { success: false } };
  const response = await withTimeout(fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }), 'The server is not responding.');
  const body = await response.json().catch(() => ({ success: false, message: 'Unexpected response from the server.' }));
  return { status: response.status, body };
}

/* keepForms: a background refresh while someone is filling in a ship or
   refund form updates the counts and alerts but leaves the list alone. */
async function loadOrders({ quiet = false, keepForms = false } = {}) {
  if (!quiet) flash('Loading orders…');
  let result;
  try {
    result = await api(`/api/staff-orders?view=${state.view}&activity=1`);
  } catch (error) {
    console.warn('Staff orders failed to load:', error);
    showError(`${error?.message?.endsWith('not responding.') ? error.message : 'Unable to reach the server.'} Check your connection and try again.`);
    return;
  }
  const { status, body } = result;
  if (status === 401) return showSignIn();
  if (status === 403) {
    /* Signed in, but not in the staff table yet (or removed from it). */
    const email = state.email;
    $('noAccessEmail').textContent = email;
    $('staffName').textContent = email;
    $('staffWho').hidden = false;
    $('staffTitle').textContent = 'Orders';
    showView('noAccessView');
    return;
  }
  if (!body.success) {
    showError(status === 429
      ? 'Too many requests from this network. Wait a minute, then try again.'
      : body.message || `Unable to load orders (error ${status}).`);
    return;
  }
  if (!quiet) flash('');
  state.orders = body.orders;
  state.allStores = !body.staff.store;
  state.cancelWindowMs = body.cancelWindowMs;
  state.activity = body.activity || null;
  state.updatedAt = new Date();
  $('staffTitle').textContent = body.staff.store ? `${body.staff.store} orders` : 'All store orders';
  $('staffName').textContent = body.staff.name;
  $('staffWho').hidden = false;
  showView('ordersView');
  checkNewOrders();
  if (!(keepForms && document.querySelector('.staff-inline-form'))) renderOrders();
  renderActivity();
}

async function runAction(order, action, extra = {}) {
  state.busy.add(order.reference);
  renderOrders();
  let result;
  try {
    result = await api('/api/staff-order-action', {
      method: 'POST',
      body: JSON.stringify({ reference: order.reference, action, ...extra })
    });
  } catch {
    result = { status: 0, body: { success: false, message: 'Unable to reach the server. Nothing was changed.' } };
  }
  state.busy.delete(order.reference);
  const { status, body } = result;
  if (status === 401) return showSignIn();

  if (body.success) {
    markSeen([order.reference]);
    const done = {
      ready: 'Marked ready for pickup.',
      collected: 'Marked picked up.',
      shipped: 'Marked shipped.',
      refund: body.refunded ? `Cancelled and refunded ${money(body.refunded)}.` : 'Cancelled.'
    }[action];
    const emailNote = {
      true: ' The customer has been emailed.',
      false: ' The customer email could not be sent, so please contact them directly.'
    }[body.customerEmailed] || '';
    flash(`${order.reference}: ${done}${emailNote}`, body.customerEmailed === false);
    await loadOrders({ quiet: true });
  } else {
    flash(`${order.reference}: ${body.message || 'That did not work.'}`, true);
    if (status === 409) await loadOrders({ quiet: true });
    else renderOrders();
  }
}

function flash(message, error = false) {
  const el = $('ordersStatus');
  el.textContent = message;
  el.classList.toggle('staff-status-error', error);
}

/* ── RENDERING ───────────────────────────────────────── */

function renderOrders() {
  const list = $('ordersList');
  const orders = state.orders.filter((order) => state.type === 'all' || order.fulfillment === state.type);
  list.replaceChildren(...orders.map(renderOrder));
  if (!orders.length) {
    list.append(h('p', { class: 'staff-empty', text: state.view === 'open' ? 'No orders waiting. You are all caught up.' : 'No finished orders yet.' }));
  }
}

function detailRow(label, ...value) {
  return h('div', { class: 'staff-detail' }, h('dt', { text: label }), h('dd', {}, ...value));
}

function renderOrder(order) {
  const shipping = order.fulfillment === 'shipping';
  const busy = state.busy.has(order.reference);
  const cancelUntil = new Date(new Date(order.placed_at).getTime() + state.cancelWindowMs);
  const withinWindow = Date.now() < cancelUntil.getTime();
  const address = order.shipping_address;

  const items = h('ul', { class: 'staff-items' }, (order.items || []).map((item) => h('li', {},
    h('span', { class: 'staff-item-qty', text: `${item.qty}×` }),
    h('span', { class: 'staff-item-name', text: [item.brand, item.name, item.size].filter(Boolean).join(' · ') }),
    h('span', { class: 'staff-item-price', text: money(item.price * item.qty) })
  )));

  const details = h('dl', { class: 'staff-details' },
    detailRow('Customer', order.customer_name || '—'),
    order.phone ? detailRow('Phone', h('a', { href: `tel:${order.phone}`, text: order.phone })) : null,
    detailRow('Email', h('a', { href: `mailto:${order.email}`, text: order.email })),
    shipping
      ? detailRow('Ship to', h('span', { class: 'staff-address', text: address ? [address.line1, address.line2, `${address.city}, ${address.state} ${address.zip}`].filter(Boolean).join('\n') : '—' }))
      : detailRow('Pickup', [order.pickup_date, order.pickup_time].filter(Boolean).join(' at ') || '—'),
    state.allStores ? detailRow('Store', order.pickup_store) : null,
    detailRow('Placed', astTime(order.placed_at)),
    order.tracking_number ? detailRow('Tracking', `${CARRIERS[order.tracking_carrier] || order.tracking_carrier} ${order.tracking_number}`) : null,
    detailRow('Total', h('strong', { text: money(order.total) }), shipping ? ` (incl. ${Number(order.shipping_cost) ? money(order.shipping_cost) : 'free'} shipping)` : '')
  );

  let note = null;
  if (['placed', 'paid', 'ready'].includes(order.status) && withinWindow) {
    note = h('p', { class: 'staff-note', text: shipping
      ? `Customer can cancel until ${astTime(cancelUntil)}. Ship after that.`
      : `Customer can cancel online until ${astTime(cancelUntil)}.` });
  }

  const isNew = alerts.unseen.has(order.reference);
  const card = h('article', { class: `staff-order staff-order-${order.status}${isNew ? ' staff-order-new' : ''}`, 'aria-busy': busy ? 'true' : null },
    h('header', { class: 'staff-order-head' },
      h('div', {},
        h('span', { class: 'staff-kind', text: shipping ? 'Shipping' : 'Pickup' }),
        h('h3', { class: 'staff-ref', text: order.reference })
      ),
      h('div', { class: 'staff-order-badges' },
        isNew ? h('button', { type: 'button', class: 'staff-new-badge', text: 'New', title: 'Mark as seen',
          'aria-label': `New order. Mark ${order.reference} as seen`, onclick: () => markSeen([order.reference]) }) : null,
        h('span', { class: `staff-badge staff-badge-${order.status}`, text: STATUS_LABEL[order.status] || order.status }))
    ),
    details,
    items,
    note
  );
  card.append(renderActions(order, { busy, withinWindow }));
  return card;
}

function renderActions(order, { busy, withinWindow }) {
  const shipping = order.fulfillment === 'shipping';
  const actions = h('div', { class: 'staff-actions' });
  const button = (label, onclick, kind = 'btn-gold') =>
    h('button', { type: 'button', class: `${kind} staff-action`, disabled: busy, onclick, text: label });

  if (!shipping && ['placed', 'paid'].includes(order.status)) {
    actions.append(button('Ready for pickup', () => runAction(order, 'ready')));
  }
  if (!shipping && ['placed', 'paid', 'ready'].includes(order.status)) {
    actions.append(button('Picked up', () => {
      if (confirm(`Mark ${order.reference} as picked up by ${order.customer_name || 'the customer'}?`)) runAction(order, 'collected');
    }, order.status === 'ready' ? 'btn-gold' : 'btn-ghost'));
  }
  if (shipping && order.status === 'paid') {
    const shipButton = button('Mark shipped', () => openShipForm(actions, order));
    if (withinWindow) shipButton.title = 'Available once the 24-hour cancellation window closes';
    actions.append(shipButton);
  }
  if (['placed', 'paid', 'ready'].includes(order.status)) {
    const paid = order.status !== 'placed';
    actions.append(button(paid ? 'Cancel & refund' : 'Cancel order', () => openRefundForm(actions, order, paid), 'btn-ghost staff-danger'));
  }
  if (busy) actions.append(h('span', { class: 'staff-muted', text: 'Working…' }));
  return actions;
}

function openShipForm(container, order) {
  const carrier = h('select', { name: 'carrier', required: true },
    h('option', { value: '', text: 'Carrier' }),
    Object.entries(CARRIERS).map(([value, label]) => h('option', { value, text: label })));
  const tracking = h('input', { name: 'tracking', type: 'text', inputmode: 'text', autocomplete: 'off', placeholder: 'Tracking number', required: true });
  const form = h('form', { class: 'staff-inline-form', onsubmit: (event) => {
    event.preventDefault();
    if (!carrier.value || !tracking.value.trim()) return flash('Choose a carrier and enter the tracking number.', true);
    runAction(order, 'shipped', { carrier: carrier.value, trackingNumber: tracking.value });
  } },
    h('label', { class: 'account-field' }, h('span', { text: 'Carrier' }), carrier),
    h('label', { class: 'account-field' }, h('span', { text: 'Tracking number' }), tracking),
    h('div', { class: 'staff-actions' },
      h('button', { type: 'submit', class: 'btn-gold staff-action', text: 'Ship & email customer' }),
      h('button', { type: 'button', class: 'btn-ghost staff-action', text: 'Back', onclick: renderOrders })));
  container.replaceChildren(form);
  carrier.focus();
}

function openRefundForm(container, order, paid) {
  const reason = h('input', { name: 'reason', type: 'text', maxlength: '200', placeholder: 'e.g. Out of stock (optional)' });
  const form = h('form', { class: 'staff-inline-form', onsubmit: (event) => {
    event.preventDefault();
    runAction(order, 'refund', { reason: reason.value });
  } },
    h('p', { class: 'staff-warning', text: paid
      ? `This refunds ${money(order.total)} to the customer's card and emails them. It can't be undone.`
      : 'This cancels the order and emails the customer. It can\'t be undone.' }),
    h('label', { class: 'account-field' }, h('span', { text: 'Reason shown to the customer' }), reason),
    h('div', { class: 'staff-actions' },
      h('button', { type: 'submit', class: 'btn-ghost staff-action staff-danger staff-danger-solid', text: paid ? `Refund ${money(order.total)}` : 'Cancel order' }),
      h('button', { type: 'button', class: 'btn-ghost staff-action', text: 'Back', onclick: renderOrders })));
  container.replaceChildren(form);
  reason.focus();
}

/* ── ORDER ACTIVITY (tiles + sales chart) ────────────── */

/* Where each order is now. Cancelled and refunded orders don't count as sales. */
const SERIES = [
  { key: 'completed', label: 'Completed', statuses: ['shipped', 'collected'] },
  { key: 'progress', label: 'In progress', statuses: ['placed', 'paid', 'ready'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled', 'refunded'] }
];
const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 24 * 60 * 60 * 1000;

/* Store days run on St. Thomas time (AST, no daylight saving). */
const dayKey = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Thomas' }).format(new Date(value));
const dayLabel = (key, options) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
const seriesOf = (status) => SERIES.find((series) => series.statuses.includes(status))?.key;
const wholeMoney = (amount) => `$${Math.round(amount).toLocaleString('en-US')}`;

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/* One row per day, oldest first, ending today. */
function activityDays() {
  const { days, orders } = state.activity;
  const now = Date.now();
  const rows = Array.from({ length: days }, (_, index) => {
    const key = dayKey(now - (days - 1 - index) * DAY_MS);
    return { key, completed: 0, progress: 0, cancelled: 0, total: 0, sales: 0 };
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const order of orders) {
    const row = byKey.get(dayKey(order.placed_at));
    const series = seriesOf(order.status);
    if (!row || !series) continue;
    row[series] += 1;
    row.total += 1;
    if (series !== 'cancelled') row.sales += Number(order.total) || 0;
  }
  return rows;
}

/* Percent change, or null when there's nothing to compare against. */
const percentChange = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);

const TREND_UP = 'M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6';
const TREND_DOWN = 'M22 17 13.5 8.5 8.5 13.5 2 7M16 17h6v-6';

/* "▲ +12.7%" style change, with an icon and sign so it never relies on color. */
function trendBadge(change, suffix = '', emptyText = '') {
  if (change === null) return emptyText ? h('span', { class: 'staff-trend staff-trend-flat', text: emptyText }) : null;
  const up = change >= 0;
  const icon = svg('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  icon.append(svg('path', { d: up ? TREND_UP : TREND_DOWN }));
  return h('span', { class: `staff-trend ${up ? 'staff-trend-up' : 'staff-trend-down'}` },
    icon, h('span', { text: `${up ? '+' : '−'}${Math.abs(change).toFixed(1)}%` }),
    suffix ? h('span', { class: 'staff-trend-note', text: suffix }) : null);
}

function renderActivity() {
  if (!state.activity) return;
  const today = dayKey(Date.now());
  const orders = state.activity.orders;
  const count = (test) => orders.filter(test).length;

  const tiles = [
    { label: 'To prepare', value: count((o) => o.fulfillment === 'pickup' && ['placed', 'paid'].includes(o.status)), note: 'Pickup orders not ready yet' },
    { label: 'Ready for pickup', value: count((o) => o.status === 'ready'), note: 'Waiting for the customer' },
    { label: 'To ship', value: count((o) => o.fulfillment === 'shipping' && o.status === 'paid'), note: 'Paid shipping orders' },
    { label: 'Completed today', value: count((o) => [o.shipped_at, o.collected_at].some((at) => at && dayKey(at) === today)), note: 'Picked up or shipped' }
  ];
  $('activityTiles').replaceChildren(...tiles.map((tile) => h('div', { class: 'staff-tile' },
    h('span', { class: 'staff-tile-label', text: tile.label }),
    h('span', { class: 'staff-tile-value', text: String(tile.value) }),
    h('span', { class: 'staff-tile-note', text: tile.note }))));

  $('activityUpdatedText').textContent = `Live · updated ${new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: 'America/St_Thomas' }).format(state.updatedAt)}`;

  const rows = activityDays();
  const sum = (list) => list.reduce((total, row) => total + row.sales, 0);
  const lastWeek = sum(rows.slice(-7));
  const weekBefore = sum(rows.slice(-14, -7));
  const todayRow = rows[rows.length - 1];
  const yesterday = rows[rows.length - 2];
  const best = rows.reduce((a, b) => (b.sales > a.sales ? b : a));
  const slowest = rows.reduce((a, b) => (b.sales < a.sales ? b : a));

  $('salesTotal').textContent = money(lastWeek);
  $('salesTrend').replaceChildren(...[trendBadge(percentChange(lastWeek, weekBefore), 'vs previous 7 days', 'No sales in the previous 7 days to compare')].filter(Boolean));
  $('todaySales').textContent = money(todayRow.sales);
  $('todayTrend').replaceChildren(...[trendBadge(percentChange(todayRow.sales, yesterday.sales))].filter(Boolean));
  $('todayOrders').textContent = `${todayRow.total} order${todayRow.total === 1 ? '' : 's'}`;
  $('salesHigh').textContent = `${money(best.sales)} · ${dayLabel(best.key, { month: 'short', day: 'numeric' })}`;
  $('salesLow').textContent = `${money(slowest.sales)} · ${dayLabel(slowest.key, { month: 'short', day: 'numeric' })}`;
  $('salesOrders').textContent = String(rows.reduce((total, row) => total + row.total, 0));

  renderChart(rows, today);
  renderChartTable(rows);
}

/* Monotone cubic (Fritsch–Carlson): smooth, but never overshoots a day's
   value, so the line can't dip below $0 or invent a peak. */
function monotonePath(points) {
  const n = points.length;
  if (n < 2) return points.length ? `M${points[0].x},${points[0].y}` : '';
  const dx = [], slope = [], tangent = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = (points[i + 1].y - points[i].y) / dx[i];
  }
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i];
    const length = a * a + b * b;
    if (length > 9) {
      const t = 3 / Math.sqrt(length);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d += ` C${points[i].x + third},${points[i].y + tangent[i] * third} ${points[i + 1].x - third},${points[i + 1].y - tangent[i + 1] * third} ${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}

function renderChart(rows, today) {
  const plot = $('chartPlot');
  const width = Math.max(plot.clientWidth, 280);
  const height = width < 520 ? 240 : 300;

  /* $0–$200 in $50 steps. A bigger day raises the top in $50 steps, and past
     six ticks the step widens, so the line never leaves the chart. */
  const max = Math.max(...rows.map((row) => row.sales));
  const step = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]
    .find((s) => Math.ceil(max / s) <= 6) || Math.ceil(max / 6);
  const top = Math.max(200, step * Math.ceil(max / step));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const margin = { top: 20, right: 14, bottom: 36, left: 22 + wholeMoney(top).length * 7 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const x = (index) => margin.left + (rows.length === 1 ? innerW / 2 : (index / (rows.length - 1)) * innerW);
  const y = (value) => margin.top + innerH - (value / top) * innerH;
  const points = rows.map((row, index) => ({ x: x(index), y: y(row.sales) }));
  const bottom = margin.top + innerH;

  const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'staff-sales-chart', tabindex: '0', role: 'img',
    'aria-label': `Sales per day for the last ${rows.length} days. Use the left and right arrow keys to read each day, or open the table below.` });

  const defs = svg('defs');
  const gradient = svg('linearGradient', { id: 'salesArea', x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(svg('stop', { offset: '0%', style: 'stop-color:var(--chart-line);stop-opacity:.16' }),
    svg('stop', { offset: '100%', style: 'stop-color:var(--chart-line);stop-opacity:0' }));
  const dots = svg('pattern', { id: 'salesDotGrid', x: 0, y: 0, width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  dots.append(svg('circle', { cx: 10, cy: 10, r: 1, class: 'staff-dot-grid' }));
  const glow = svg('filter', { id: 'salesGlow', x: '-10%', y: '-40%', width: '120%', height: '200%' });
  glow.append(svg('feDropShadow', { dx: 0, dy: 6, stdDeviation: 8, style: 'flood-color:var(--chart-line);flood-opacity:.45' }));
  const dotShadow = svg('filter', { id: 'salesDotShadow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  dotShadow.append(svg('feDropShadow', { dx: 1, dy: 2, stdDeviation: 2, style: 'flood-color:#000;flood-opacity:.45' }));
  defs.append(gradient, dots, glow, dotShadow);
  chart.append(defs);

  chart.append(svg('rect', { x: margin.left, y: margin.top, width: innerW, height: innerH, fill: 'url(#salesDotGrid)', 'pointer-events': 'none' }));

  for (const value of ticks) {
    chart.append(svg('line', { class: 'staff-grid-dashed', x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value) }));
    const tick = svg('text', { class: 'staff-axis-line', x: margin.left - 12, y: y(value) + 4, 'text-anchor': 'end' });
    tick.textContent = wholeMoney(value);
    chart.append(tick);
  }

  /* Date ticks at an even step counted back from today, as many as fit. */
  const fits = Math.max(2, Math.floor(innerW / 64));
  const every = Math.ceil(rows.length / fits);
  const dateTicks = [];
  for (let index = rows.length - 1; index >= 0; index -= every) dateTicks.push(index);
  for (const index of dateTicks) {
    const row = rows[index];
    const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle';
    const label = svg('text', { class: `staff-axis-line${row.key === today ? ' staff-axis-strong' : ''}`, x: x(index), y: height - 10, 'text-anchor': anchor });
    label.textContent = row.key === today ? 'Today' : dayLabel(row.key, { month: 'short', day: 'numeric' });
    chart.append(label);
  }

  const todayIndex = rows.findIndex((row) => row.key === today);
  if (todayIndex >= 0) {
    chart.append(svg('line', { class: 'staff-reference', x1: x(todayIndex), x2: x(todayIndex), y1: margin.top, y2: bottom }));
  }

  const line = monotonePath(points);
  chart.append(svg('path', { d: `${line} L${points[points.length - 1].x},${bottom} L${points[0].x},${bottom} Z`, fill: 'url(#salesArea)', 'pointer-events': 'none' }));
  chart.append(svg('path', { d: line, class: 'staff-sales-line', filter: 'url(#salesGlow)' }));

  /* Highlight today, the best day and the slowest day. */
  const maxIndex = rows.findIndex((row) => row.sales === max);
  const minValue = Math.min(...rows.map((row) => row.sales));
  const minIndex = rows.findIndex((row) => row.sales === minValue);
  for (const index of new Set([todayIndex, maxIndex, minIndex].filter((i) => i >= 0))) {
    chart.append(svg('circle', { class: 'staff-sales-dot', cx: points[index].x, cy: points[index].y, r: 6, filter: 'url(#salesDotShadow)' }));
  }

  /* Hover layer: dashed crosshair, active dot and tooltip on the nearest day. */
  const cursor = svg('line', { class: 'staff-cursor', x1: 0, x2: 0, y1: margin.top, y2: bottom, visibility: 'hidden' });
  const active = svg('circle', { class: 'staff-sales-dot', r: 6, filter: 'url(#salesDotShadow)', visibility: 'hidden' });
  const hit = svg('rect', { class: 'staff-hit', x: margin.left - 10, y: 0, width: innerW + 20, height });
  chart.append(cursor, active, hit);

  const tooltip = h('div', { class: 'staff-tooltip staff-sales-tooltip', role: 'tooltip', hidden: true });
  let current = null;
  const showDay = (index) => {
    current = index;
    const row = rows[index];
    const { x: px, y: py } = points[index];
    for (const [key, value] of [['x1', px], ['x2', px]]) cursor.setAttribute(key, value);
    cursor.setAttribute('visibility', 'visible');
    active.setAttribute('cx', px);
    active.setAttribute('cy', py);
    active.setAttribute('visibility', 'visible');
    const change = index > 0 ? percentChange(row.sales, rows[index - 1].sales) : null;
    tooltip.replaceChildren(
      h('span', { class: 'staff-tooltip-date', text: row.key === today ? `Today, ${dayLabel(row.key, { month: 'short', day: 'numeric' })}` : dayLabel(row.key, { weekday: 'short', month: 'short', day: 'numeric' }) }),
      h('span', { class: 'staff-tooltip-headline' }, h('strong', { text: money(row.sales) }), change === null ? null : trendBadge(change)),
      h('span', { class: 'staff-tooltip-sub', text: `${row.total} order${row.total === 1 ? '' : 's'}${row.cancelled ? ` · ${row.cancelled} cancelled` : ''}` }));
    tooltip.hidden = false;
    const tipW = tooltip.offsetWidth;
    const tipH = tooltip.offsetHeight;
    const left = px + 14 + tipW <= width ? px + 14 : px - 14 - tipW;
    tooltip.style.left = `${Math.max(left, 0)}px`;
    tooltip.style.top = `${Math.min(Math.max(py - tipH - 12, 0), height - tipH)}px`;
  };
  const hideDay = () => {
    current = null;
    cursor.setAttribute('visibility', 'hidden');
    active.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  const nearest = (event) => {
    const box = chart.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    return Math.min(rows.length - 1, Math.max(0, Math.round(((px - margin.left) / innerW) * (rows.length - 1))));
  };
  hit.addEventListener('pointermove', (event) => showDay(nearest(event)));
  hit.addEventListener('pointerdown', (event) => showDay(nearest(event)));
  hit.addEventListener('pointerleave', hideDay);
  chart.addEventListener('focus', () => showDay(current ?? rows.length - 1));
  chart.addEventListener('blur', hideDay);
  chart.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const from = current ?? rows.length - 1;
    showDay({ ArrowLeft: Math.max(from - 1, 0), ArrowRight: Math.min(from + 1, rows.length - 1), Home: 0, End: rows.length - 1 }[event.key]);
  });

  plot.replaceChildren(chart, tooltip);
}

function renderChartTable(rows) {
  const head = h('tr', {}, h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', text: 'Sales' }),
    h('th', { scope: 'col', text: 'Orders' }),
    ...SERIES.map((series) => h('th', { scope: 'col', text: series.label })));
  const body = rows.slice().reverse().map((row) => h('tr', {},
    h('th', { scope: 'row', text: dayLabel(row.key, { weekday: 'short', month: 'short', day: 'numeric' }) }),
    h('td', { text: money(row.sales) }), h('td', { text: String(row.total) }),
    ...SERIES.map((series) => h('td', { text: String(row[series.key]) }))));
  $('chartTable').replaceChildren(h('table', { class: 'staff-table' }, h('thead', {}, head), h('tbody', {}, body)));
}

/* Redraw at the new width (phone rotation, window resize). */
if ('ResizeObserver' in window) {
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === lastWidth || !state.activity) return;
    lastWidth = width;
    renderChart(activityDays(), dayKey(Date.now()));
  }).observe($('chartPlot'));
}

/* ── THEME ───────────────────────────────────────────── */

/* Shares the shop's saved choice (ul-theme), so both match. */
(function initTheme() {
  const html = document.documentElement;
  const button = $('themeToggle');
  function apply(theme, save) {
    html.setAttribute('data-theme', theme);
    if (save) { try { localStorage.setItem('ul-theme', theme); } catch (e) {} }
    const dark = theme === 'dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $('themeLabel').textContent = dark ? 'Dark' : 'Light';
  }
  let saved = null;
  try { saved = localStorage.getItem('ul-theme'); } catch (e) {}
  apply(saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'), false);
  button.addEventListener('click', () => apply(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    try { if (localStorage.getItem('ul-theme')) return; } catch (e) {}
    apply(event.matches ? 'dark' : 'light', false);
  });
})();

/* ── SIGN IN / CREATE ACCOUNT ────────────────────────── */

const AUTH_UNAVAILABLE = 'Accounts are unavailable right now. Check your connection and try again.';

function showSignIn() {
  $('staffWho').hidden = true;
  $('staffTitle').textContent = 'Orders';
  showView('signInView');
}

function showAuthMessage(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function switchAuthTab(tab) {
  const signIn = tab === 'signin';
  $('tabStaffSignIn').setAttribute('aria-selected', String(signIn));
  $('tabStaffSignUp').setAttribute('aria-selected', String(!signIn));
  $('staffSignInForm').hidden = !signIn;
  $('staffSignUpForm').hidden = signIn;
  showAuthMessage('signInError', '');
  showAuthMessage('signUpError', '');
}

$('tabStaffSignIn').addEventListener('click', () => { showAuthMessage('authNotice', ''); switchAuthTab('signin'); });
$('tabStaffSignUp').addEventListener('click', () => { showAuthMessage('authNotice', ''); switchAuthTab('signup'); });

/* The confirmation link returns here, not to the shop, and signs them in. */
$('staffSignUpForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  showAuthMessage('signUpError', '');
  if (!name || !email) return showAuthMessage('signUpError', 'Please fill in every field.');
  if (password.length < 6) return showAuthMessage('signUpError', 'Password must be at least 6 characters.');
  if (!state.client) return showAuthMessage('signUpError', AUTH_UNAVAILABLE);

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: `${location.origin}/staff.html` }
    });
    if (error) {
      return showAuthMessage('signUpError', /already registered/i.test(error.message)
        ? 'An account with this email already exists. Sign in instead.'
        : /password/i.test(error.message) ? error.message : 'Unable to create your account right now. Please try again.');
    }
    /* With email confirmation on, Supabase hides whether an email is taken:
       it returns a user with no identities instead of an error. */
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return showAuthMessage('signUpError', 'An account with this email already exists. Sign in instead.');
    }
    form.reset();
    if (data.session) return loadOrders();
    switchAuthTab('signin');
    $('staffSignInForm').email.value = email;
    showAuthMessage('authNotice', `Almost there. We sent a confirmation link to ${email}. Open it to finish creating your account. Didn't get it? Check your spam folder.`);
  } catch (error) {
    console.warn('Staff sign up failed:', error);
    showAuthMessage('signUpError', AUTH_UNAVAILABLE);
  } finally {
    submit.disabled = false;
  }
});

$('staffSignInForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('signInError');
  const submit = form.querySelector('button[type="submit"]');
  error.hidden = true;
  showAuthMessage('authNotice', '');
  if (!state.client) return showAuthMessage('signInError', AUTH_UNAVAILABLE);
  submit.disabled = true;
  let signInError;
  try {
    ({ error: signInError } = await withTimeout(state.client.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.password.value
    }), 'The sign-in service is not responding. Please try again.'));
  } catch (failure) {
    signInError = failure;
  } finally {
    submit.disabled = false;
  }
  if (signInError) {
    error.textContent = signInError.message === 'Invalid login credentials'
      ? 'Incorrect email or password.'
      : /not confirmed/i.test(signInError.message)
        ? 'Please confirm your email first. Open the link we sent you, then sign in.'
        : signInError.message;
    error.hidden = false;
    return;
  }
  form.reset();
  loadOrders();
});

$('checkAccessBtn').addEventListener('click', () => loadOrders());
$('retryBtn').addEventListener('click', async () => {
  const button = $('retryBtn');
  button.disabled = true;
  button.textContent = 'Checking…';
  $('errorText').textContent = '';
  await start();
  button.disabled = false;
  button.textContent = 'Try again';
});

$('signOutBtn').addEventListener('click', async () => {
  /* Local scope: signs out here even if the sign-in service is unreachable. */
  await state.client?.auth.signOut({ scope: 'local' }).catch(() => {});
  state.email = '';
  $('staffName').textContent = '';
  state.orders = [];
  alerts.owner = null;
  updateAlertBadges();
  $('ordersList').replaceChildren();
  showSignIn();
});

/* ── NEW-ORDER ALERTS ─────────────────────────────────── */

/* An order is new until someone acts on it, clicks its New badge or marks
   all as seen. What each person has seen is remembered in this browser, so a
   reload doesn't alert again; the very first visit treats everything already
   there as seen rather than sounding off for every existing order. */
const alerts = {
  owner: null,               /* email the sets below belong to */
  seen: new Set(),
  unseen: new Set(),
  on: true,
  audio: null
};
const ALERT_STATUSES = ['placed', 'paid'];
const SEEN_LIMIT = 1000;

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
try { alerts.on = localStorage.getItem('ul-staff-alerts') !== 'off'; } catch (e) {}

function saveAlertState() {
  if (!alerts.owner) return;
  writeStore(`ul-staff-seen:${alerts.owner}`, [...alerts.seen].slice(-SEEN_LIMIT));
  writeStore(`ul-staff-unseen:${alerts.owner}`, [...alerts.unseen]);
}

function checkNewOrders() {
  const incoming = (state.activity?.orders || []).filter((order) => order.reference && ALERT_STATUSES.includes(order.status));
  if (alerts.owner !== state.email) {
    alerts.owner = state.email;
    const seen = readStore(`ul-staff-seen:${alerts.owner}`);
    alerts.unseen = new Set(readStore(`ul-staff-unseen:${alerts.owner}`) || []);
    if (!Array.isArray(seen)) {
      alerts.seen = new Set(incoming.map((order) => order.reference));
      saveAlertState();
      updateAlertBadges();
      return;
    }
    alerts.seen = new Set(seen);
  }

  const fresh = incoming.filter((order) => !alerts.seen.has(order.reference));
  for (const order of fresh) {
    alerts.seen.add(order.reference);
    alerts.unseen.add(order.reference);
  }
  /* Drop ones that someone (here or at another computer) has since handled. */
  const waiting = new Set(incoming.map((order) => order.reference));
  for (const reference of alerts.unseen) if (!waiting.has(reference)) alerts.unseen.delete(reference);

  saveAlertState();
  updateAlertBadges();
  if (fresh.length) announce(fresh);
}

function markSeen(references) {
  let changed = false;
  for (const reference of references) changed = alerts.unseen.delete(reference) || changed;
  if (!changed) return;
  saveAlertState();
  updateAlertBadges();
  renderOrders();
}

function updateAlertBadges() {
  const count = alerts.owner ? alerts.unseen.size : 0;
  const base = $('ordersView').hidden ? 'Staff Orders' : $('staffTitle').textContent;
  document.title = `${count ? `(${count}) ` : ''}${base} | Luxe Perfume`;
  $('newOrdersBanner').hidden = !count;
  $('newOrdersText').textContent = `${count} new order${count === 1 ? '' : 's'}`;
}

function announce(fresh) {
  const total = fresh.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const kinds = fresh.map((order) => (order.fulfillment === 'shipping' ? 'shipping' : 'pickup'));
  const kind = kinds.every((k) => k === kinds[0]) ? `${kinds[0]} ` : '';
  const title = fresh.length === 1 ? `New ${kind}order · ${money(fresh[0].total)}` : `${fresh.length} new ${kind}orders · ${money(total)}`;
  const body = fresh.length === 1
    ? `${fresh[0].reference}${state.allStores ? ` · ${fresh[0].pickup_store}` : ''}`
    : fresh.map((order) => order.reference).join(', ');
  flash(`${title}. ${body}`);
  if (!alerts.on) return;
  playChime();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, { body, tag: 'ul-staff-new-orders', renotify: true });
      notification.onclick = () => { window.focus(); notification.close(); };
    } catch (e) {}
  }
}

/* A short two-note chime, made in the browser so there's no sound file. */
function playChime() {
  const ctx = alerts.audio;
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  [[880, 0], [1318.5, 0.16]].forEach(([frequency, delay]) => {
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.45);
    tone.connect(gain).connect(ctx.destination);
    tone.start(start + delay);
    tone.stop(start + delay + 0.5);
  });
}

/* Browsers only allow sound after the person has clicked or typed on the
   page, so the audio is switched on at the first interaction. */
function unlockAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  alerts.audio ??= new AudioCtor();
  if (alerts.audio.state === 'suspended') alerts.audio.resume().catch(() => {});
}
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, unlockAudio, { capture: true }));

function renderAlertsButton() {
  const button = $('alertsBtn');
  button.setAttribute('aria-pressed', String(alerts.on));
  $('alertsLabel').textContent = alerts.on ? 'Alerts on' : 'Alerts off';
}

$('alertsBtn').addEventListener('click', async () => {
  alerts.on = !alerts.on;
  try { localStorage.setItem('ul-staff-alerts', alerts.on ? 'on' : 'off'); } catch (e) {}
  renderAlertsButton();
  if (!alerts.on) return flash('New-order alerts are off. New orders still show a New badge and the count in the tab title.');
  unlockAudio();
  setTimeout(playChime, 50);   /* a preview, so staff know what to listen for */
  if (!('Notification' in window)) return flash('Alerts are on. This browser does not support notifications, so you will hear the chime instead.');
  if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  flash(Notification.permission === 'granted'
    ? 'Alerts are on: a chime, plus a notification when this tab is in the background.'
    : 'Alerts are on with the chime. Notifications are blocked in this browser\'s site settings; allow them there to get pop-up alerts.');
});

$('markAllSeenBtn').addEventListener('click', () => markSeen([...alerts.unseen]));
$('showNewBtn').addEventListener('click', () => {
  if (state.view !== 'open') document.querySelector('.staff-tab[data-view="open"]').click();
  if (state.type !== 'all') document.querySelector('.staff-chip[data-type="all"]').click();
  document.querySelector('.staff-order-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

renderAlertsButton();

/* ── TABS, FILTERS, REFRESH ──────────────────────────── */

document.querySelectorAll('.staff-tab').forEach((tab) => tab.addEventListener('click', () => {
  state.view = tab.dataset.view;
  document.querySelectorAll('.staff-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  flash('');
  loadOrders();
}));

document.querySelectorAll('.staff-chip').forEach((chip) => chip.addEventListener('click', () => {
  state.type = chip.dataset.type;
  document.querySelectorAll('.staff-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  renderOrders();
}));

$('refreshBtn').addEventListener('click', () => { flash(''); loadOrders(); });

/* Keeps checking in a background tab too, so new-order alerts still arrive
   (browsers slow hidden-tab timers to about once a minute). */
setInterval(() => {
  if ($('ordersView').hidden || state.busy.size) return;
  loadOrders({ quiet: true, keepForms: true });
}, ST_REFRESH_MS);

/* ── START ───────────────────────────────────────────── */

/* The sign-in form shows straight away; once the sign-in service has loaded,
   a returning staff member goes on to their orders. */
function loadSdk() {
  if (window.supabase?.createClient) return Promise.resolve();
  return withTimeout(new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ST_SUPABASE_SDK;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('The sign-in service could not be loaded.')); };
    document.head.append(script);
  }), 'The sign-in service is taking too long to load.');
}

async function start() {
  try {
    await loadSdk();
    state.client ??= window.supabase.createClient(ST_SUPABASE_URL, ST_SUPABASE_KEY);
    if (await getSession()) await loadOrders();
    else showSignIn();
  } catch (error) {
    console.warn('Staff page failed to start:', error);
    showError(`${error?.message || 'Something went wrong.'} Check your connection (or turn off content blockers for this site) and try again.`);
  }
}

start();
