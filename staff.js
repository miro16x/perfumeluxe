/* ── STAFF DASHBOARD ──────────────────────────────────────────────
   Staff sign in with their site account (Supabase). Every order and action
   goes through /api/staff-orders and /api/staff-order-action, which check
   the staff table on the server, so this page decides nothing about access. */

const ST_SUPABASE_URL = 'https://bvffpffnyjfufprcdskb.supabase.co';
const ST_SUPABASE_KEY = 'sb_publishable_NGGc4fVDwCVlsInS2NT51g_ymNOYi7w';
const ST_SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const ST_REFRESH_MS = 60 * 1000;

const STATUS_LABEL = {
  placed: 'Pay at pickup', paid: 'Paid', ready: 'Ready', shipped: 'Shipped',
  collected: 'Picked up', cancelled: 'Cancelled', refunded: 'Refunded'
};
const CARRIERS = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL' };

const $ = (id) => document.getElementById(id);
const state = { client: null, view: 'open', type: 'all', orders: [], allStores: false, cancelWindowMs: 0, busy: new Set() };

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
  for (const view of ['signInView', 'noAccessView', 'ordersView']) $(view).hidden = view !== id;
}

/* ── API ─────────────────────────────────────────────── */

async function api(path, options = {}) {
  const { data } = await state.client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 401, body: { success: false } };
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const body = await response.json().catch(() => ({ success: false, message: 'Unexpected response from the server.' }));
  return { status: response.status, body };
}

async function loadOrders({ quiet = false } = {}) {
  if (!quiet) flash('Loading orders…');
  let result;
  try {
    result = await api(`/api/staff-orders?view=${state.view}`);
  } catch {
    flash('Unable to reach the server. Check your connection and refresh.', true);
    return;
  }
  const { status, body } = result;
  if (status === 401) return showSignIn();
  if (status === 403) {
    $('noAccessText').textContent = body.message || "This account isn't set up for the staff dashboard.";
    showView('noAccessView');
    return;
  }
  if (!body.success) {
    flash(body.message || 'Unable to load orders.', true);
    return;
  }
  if (!quiet) flash('');
  state.orders = body.orders;
  state.allStores = !body.staff.store;
  state.cancelWindowMs = body.cancelWindowMs;
  $('staffTitle').textContent = body.staff.store ? `${body.staff.store} orders` : 'All store orders';
  $('staffName').textContent = body.staff.name;
  $('staffWho').hidden = false;
  showView('ordersView');
  renderOrders();
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

/* ── SIGN IN ─────────────────────────────────────────── */

function showSignIn() {
  $('staffWho').hidden = true;
  $('staffTitle').textContent = 'Orders';
  showView('signInView');
}

$('staffSignInForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('signInError');
  const submit = form.querySelector('button[type="submit"]');
  error.hidden = true;
  submit.disabled = true;
  const { error: signInError } = await state.client.auth.signInWithPassword({
    email: form.email.value.trim(),
    password: form.password.value
  });
  submit.disabled = false;
  if (signInError) {
    error.textContent = signInError.message === 'Invalid login credentials' ? 'Incorrect email or password.' : signInError.message;
    error.hidden = false;
    return;
  }
  form.reset();
  loadOrders();
});

$('signOutBtn').addEventListener('click', async () => {
  await state.client.auth.signOut();
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

(function start() {
  const script = document.createElement('script');
  script.src = ST_SUPABASE_SDK;
  script.onload = async () => {
    state.client = window.supabase.createClient(ST_SUPABASE_URL, ST_SUPABASE_KEY);
    const { data } = await state.client.auth.getSession();
    if (data.session) loadOrders();
    else showSignIn();
  };
  script.onerror = () => {
    $('ordersStatus').textContent = 'Unable to load the sign-in service. Check your connection and reload.';
    showView('ordersView');
  };
  document.head.append(script);
})();
