/* ── STAFF DASHBOARD ──────────────────────────────────────────────
   Staff sign in with their site account (Supabase). Every order and action
   goes through /api/staff-orders and /api/staff-order-action, which check
   the staff table on the server, so this page decides nothing about access. */

const ST_SUPABASE_URL = 'https://bvffpffnyjfufprcdskb.supabase.co';
const ST_SUPABASE_KEY = 'sb_publishable_NGGc4fVDwCVlsInS2NT51g_ymNOYi7w';
const ST_SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const ST_REFRESH_MS = 60 * 1000;
const ST_TIMEOUT_MS = 15 * 1000;   /* give up on the sign-in service after this */

const STATUS_LABEL = {
  placed: 'Pay at pickup', paid: 'Paid', ready: 'Ready', shipped: 'Shipped',
  collected: 'Picked up', cancelled: 'Cancelled', refunded: 'Refunded'
};
const CARRIERS = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL' };

const $ = (id) => document.getElementById(id);
const state = { client: null, email: '', activity: null, updatedAt: null, view: 'open', type: 'all', orders: [], allStores: false, cancelWindowMs: 0, busy: new Set() };

const money = (amount) => `$${Number(amount).toFixed(2)}`;
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

async function loadOrders({ quiet = false } = {}) {
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
  renderOrders();
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

  const card = h('article', { class: `staff-order staff-order-${order.status}`, 'aria-busy': busy ? 'true' : null },
    h('header', { class: 'staff-order-head' },
      h('div', {},
        h('span', { class: 'staff-kind', text: shipping ? 'Shipping' : 'Pickup' }),
        h('h3', { class: 'staff-ref', text: order.reference })
      ),
      h('span', { class: `staff-badge staff-badge-${order.status}`, text: STATUS_LABEL[order.status] || order.status })
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

/* ── ORDER ACTIVITY (tiles + chart) ──────────────────── */

/* Series in fixed order, bottom of the stack first. Colors are CSS tokens
   (--chart-1..3 in styles.css), validated for both themes. */
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
  $('chartSubtitle').textContent = `Last ${state.activity.days} days, by where each order is now`;
  $('chartLegend').replaceChildren(...SERIES.map((series, index) => h('li', {},
    h('span', { class: 'staff-swatch', style: `background:var(--chart-${index + 1})` }), series.label)));

  const rows = activityDays();
  renderChart(rows, today);
  renderChartTable(rows);
}

function renderChart(rows, today) {
  const plot = $('chartPlot');
  const width = Math.max(plot.clientWidth, 280);
  const height = 220;
  const margin = { top: 12, right: 8, bottom: 28, left: 32 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  /* Clean integer ticks: 0 and three more, rounded up to a nice step. */
  const max = Math.max(...rows.map((row) => row.total), 1);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => s * 3 >= max) || Math.ceil(max / 3);
  const top = step * Math.max(1, Math.ceil(max / step));
  const y = (value) => margin.top + innerH - (value / top) * innerH;
  const band = innerW / rows.length;
  const barW = Math.min(24, band * 0.62);
  const labelEvery = Math.ceil(46 / band);   /* "Sep 27" needs ~46px */

  const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Orders placed per day for the last ${rows.length} days. ${rows.reduce((sum, row) => sum + row.total, 0)} orders in total. See the table below for each day.` });

  for (let value = 0; value <= top; value += step) {
    chart.append(svg('line', { class: value ? 'staff-grid' : 'staff-baseline', x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value) }));
    const tick = svg('text', { class: 'staff-axis', x: margin.left - 8, y: y(value) + 4, 'text-anchor': 'end' });
    tick.textContent = value;
    chart.append(tick);
  }

  rows.forEach((row, index) => {
    const cx = margin.left + band * index + band / 2;
    const group = svg('g', { class: 'staff-col', tabindex: '0',
      'aria-label': `${dayLabel(row.key, { weekday: 'long', month: 'long', day: 'numeric' })}: ${row.total} orders, ${row.completed} completed, ${row.progress} in progress, ${row.cancelled} cancelled` });
    group.append(svg('rect', { class: 'staff-col-hit', x: cx - band / 2, y: margin.top, width: band, height: innerH }));

    /* Stack from the baseline with a 2px gap between segments; only the
       top segment gets the 4px rounded end. */
    let base = 0;
    const filled = SERIES.map((series, s) => ({ s, value: row[series.key] })).filter((part) => part.value > 0);
    filled.forEach((part, i) => {
      const bottom = y(base) - (i > 0 ? 2 : 0);
      const y1 = y(base + part.value);
      const segH = Math.max(bottom - y1, 1);
      const isTop = i === filled.length - 1;
      const r = isTop ? Math.min(4, segH, barW / 2) : 0;
      const x0 = cx - barW / 2;
      const d = `M${x0},${bottom} V${y1 + r} Q${x0},${y1} ${x0 + r},${y1} H${x0 + barW - r} Q${x0 + barW},${y1} ${x0 + barW},${y1 + r} V${bottom} Z`;
      group.append(svg('path', { d, fill: `var(--chart-${part.s + 1})`, class: 'staff-seg' }));
      base += part.value;
    });

    const showLabel = (rows.length - 1 - index) % labelEvery === 0;
    if (showLabel) {
      const label = svg('text', { class: `staff-axis${row.key === today ? ' staff-axis-today' : ''}`, x: cx, y: height - 8, 'text-anchor': 'middle' });
      label.textContent = row.key === today ? 'Today' : dayLabel(row.key, { month: 'short', day: 'numeric' });
      group.append(label);
    }

    const show = () => showTooltip(row, cx, band, margin.top, group);
    group.addEventListener('pointerenter', show);
    group.addEventListener('focus', show);
    group.addEventListener('pointerleave', hideTooltip);
    group.addEventListener('blur', hideTooltip);
    chart.append(group);
  });

  const tooltip = h('div', { class: 'staff-tooltip', role: 'tooltip', hidden: true });
  plot.replaceChildren(chart, tooltip);
}

/* Beside the column (right if it fits, else left), so it never hides the bar. */
function showTooltip(row, x, band, top, group) {
  const tooltip = $('chartPlot').querySelector('.staff-tooltip');
  if (!tooltip) return;
  $('chartPlot').querySelectorAll('.staff-col-active').forEach((el) => el.classList.remove('staff-col-active'));
  group.classList.add('staff-col-active');
  tooltip.replaceChildren(
    h('strong', { text: dayLabel(row.key, { weekday: 'short', month: 'short', day: 'numeric' }) }),
    ...SERIES.slice().reverse().map((series) => h('div', { class: 'staff-tooltip-row' },
      h('span', { class: 'staff-swatch', style: `background:var(--chart-${SERIES.indexOf(series) + 1})` }),
      h('span', { text: series.label }),
      h('span', { class: 'staff-tooltip-value', text: String(row[series.key]) }))),
    h('div', { class: 'staff-tooltip-row staff-tooltip-total' },
      h('span'), h('span', { text: 'Sales' }), h('span', { class: 'staff-tooltip-value', text: money(row.sales) })));
  tooltip.hidden = false;
  const plotW = $('chartPlot').clientWidth;
  const tipW = tooltip.offsetWidth;
  const right = x + band / 2 + 6;
  const left = x - band / 2 - 6 - tipW;
  tooltip.style.left = `${right + tipW <= plotW ? right : Math.max(left, 0)}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  const tooltip = $('chartPlot').querySelector('.staff-tooltip');
  if (tooltip) tooltip.hidden = true;
  $('chartPlot').querySelectorAll('.staff-col-active').forEach((el) => el.classList.remove('staff-col-active'));
}

function renderChartTable(rows) {
  const head = h('tr', {}, h('th', { scope: 'col', text: 'Day' }),
    ...SERIES.map((series) => h('th', { scope: 'col', text: series.label })),
    h('th', { scope: 'col', text: 'Total' }), h('th', { scope: 'col', text: 'Sales' }));
  const body = rows.slice().reverse().map((row) => h('tr', {},
    h('th', { scope: 'row', text: dayLabel(row.key, { weekday: 'short', month: 'short', day: 'numeric' }) }),
    ...SERIES.map((series) => h('td', { text: String(row[series.key]) })),
    h('td', { text: String(row.total) }), h('td', { text: money(row.sales) })));
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
  $('ordersList').replaceChildren();
  showSignIn();
});

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

/* New orders appear on their own, but never while someone is mid-form. */
setInterval(() => {
  if (document.hidden || $('ordersView').hidden || state.busy.size) return;
  if (document.querySelector('.staff-inline-form')) return;
  loadOrders({ quiet: true });
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
