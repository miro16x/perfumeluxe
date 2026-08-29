/* ── SCROLL REVEAL ──────────────────────────────────── */
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

/* ── NAV SCROLL ─────────────────────────────────────── */
const nav = document.getElementById('mainNav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ── MOBILE MENU ────────────────────────────────────── */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

function closeMobileMenu() {
  mobileMenu.classList.remove('open');
  hamburger.classList.remove('open');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.setAttribute('aria-label', 'Open menu');
}

hamburger.addEventListener('click', () => {
  const opening = !mobileMenu.classList.contains('open');
  mobileMenu.classList.toggle('open', opening);
  hamburger.classList.toggle('open', opening);
  hamburger.setAttribute('aria-expanded', opening);
  hamburger.setAttribute('aria-label', opening ? 'Close menu' : 'Open menu');
});

mobileMenu.querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', closeMobileMenu);
});

/* Close on Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileMenu();
});

/* ── CART ───────────────────────────────────────────── */
const cartBtn     = document.getElementById('cartBtn');
const cartClose   = document.getElementById('cartClose');
const cartOverlay = document.getElementById('cartOverlay');
const cartSidebar = document.getElementById('cartSidebar');
const cartBadge   = document.getElementById('cartBadge');
const cartBody    = document.getElementById('cartBody');
const cartFooter  = document.getElementById('cartFooter');
const cartTotalEl = document.getElementById('cartTotal');
let pickupToggle = document.getElementById('pickupToggle');
let pickupDetails = document.getElementById('pickupDetails');
let pickupDay = document.getElementById('pickupDay');
let pickupTime = document.getElementById('pickupTime');
let pickupName = document.getElementById('pickupName');
let pickupPhone = document.getElementById('pickupPhone');
let pickupEmail = document.getElementById('pickupEmail');
let pickupError = document.getElementById('pickupError');
const checkoutBtn = document.getElementById('checkoutBtn');

let cart = [];

function prefillPickupFromAccount() {
  if (!pickupName || !pickupEmail) return;

  let user = null;
  try {
    if (typeof ulCurrentUser === 'function') {
      user = ulCurrentUser();
    } else {
      const sessionEmail = localStorage.getItem('ul-session');
      const users = JSON.parse(localStorage.getItem('ul-users') || '[]');
      user = sessionEmail && Array.isArray(users)
        ? users.find((candidate) => String(candidate.email || '').toLowerCase() === sessionEmail.toLowerCase())
        : null;
    }
  } catch (error) {
    console.warn('Unable to prefill pickup information:', error);
  }

  if (!user) return;
  if (!pickupName.value.trim() && user.name) pickupName.value = user.name;
  if (!pickupEmail.value.trim() && user.email) pickupEmail.value = user.email;
}

/* Product and collection pages use a compact cart, so supply the pickup form there. */
if (checkoutBtn && !pickupDetails) {
  cartFooter.insertAdjacentHTML('afterbegin', `
    <section class="pickup-panel" aria-labelledby="pickupTitle">
      <div class="pickup-heading">
        <div><span class="pickup-kicker">Complimentary store pickup</span><h3 id="pickupTitle">Pick up in St. Thomas</h3></div>
      </div>
      <fieldset class="pickup-locations">
        <legend>Choose a pickup location</legend>
        <label class="pickup-location">
          <input type="radio" name="pickupLocation" value="Luxe Fragrances" checked>
          <span><strong>Luxe Fragrances</strong><small>9001 Havensight Mall, Suite A &amp; B</small><a href="tel:+13406930039">340-693-0039</a></span>
        </label>
        <label class="pickup-location">
          <input type="radio" name="pickupLocation" value="Perfume World">
          <span><strong>Perfume World</strong><small>4605 Tutu Park Mall, St. Thomas, VI 00802</small><a href="tel:+13407775504">340-777-5504</a></span>
        </label>
      </fieldset>
      <button type="button" class="pickup-toggle" id="pickupToggle" aria-expanded="false" aria-controls="pickupDetails">
        Enter pickup details <span aria-hidden="true">+</span>
      </button>
      <div class="pickup-details" id="pickupDetails" hidden>
        <div class="pickup-fields pickup-fields-split">
          <label><span>Pickup day</span><input id="pickupDay" type="date" required></label>
          <label><span>Pickup time</span><select id="pickupTime" required></select></label>
        </div>
        <div class="pickup-fields">
          <label><span>Pickup name</span><input id="pickupName" type="text" autocomplete="name" placeholder="Full name"></label>
          <label><span>Mobile number</span><input id="pickupPhone" type="tel" autocomplete="tel" placeholder="(340) 555-0123"></label>
          <label><span>Email address</span><input id="pickupEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
        </div>
        <p class="pickup-error" id="pickupError" role="alert" hidden></p>
        <p class="pickup-note">Cancellation requests are available for 24 hours after ordering.</p>
      </div>
    </section>`);

  pickupToggle = document.getElementById('pickupToggle');
  pickupDetails = document.getElementById('pickupDetails');
  pickupDay = document.getElementById('pickupDay');
  pickupTime = document.getElementById('pickupTime');
  pickupName = document.getElementById('pickupName');
  pickupPhone = document.getElementById('pickupPhone');
  pickupEmail = document.getElementById('pickupEmail');
  pickupError = document.getElementById('pickupError');
}

function setupPickupDays() {
  if (!pickupDay || !pickupTime) return;

  const localDateValue = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const today = new Date();
  const latestDate = new Date(today);
  latestDate.setDate(latestDate.getDate() + 30);
  pickupDay.min = localDateValue(today);
  pickupDay.max = localDateValue(latestDate);
  pickupDay.value = localDateValue(today);

  const times = [];
  for (let minutes = 11 * 60; minutes <= 18 * 60; minutes += 30) {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    times.push(`${hour12}:${String(minute).padStart(2, '0')} ${suffix}`);
  }
  pickupTime.innerHTML = times.map((time) => `<option value="${time}">${time}</option>`).join('');
}
setupPickupDays();
prefillPickupFromAccount();

if (pickupToggle && pickupDetails) {
  pickupToggle.addEventListener('click', () => {
    prefillPickupFromAccount();
    const open = pickupDetails.hidden;
    pickupDetails.hidden = !open;
    pickupToggle.setAttribute('aria-expanded', String(open));
    if (open) pickupName?.focus();
  });
}

if (checkoutBtn) checkoutBtn.addEventListener('click', async () => {
  if (!pickupDetails || !pickupToggle) return;

  prefillPickupFromAccount();

  if (pickupDetails.hidden) {
    pickupToggle.click();
    return;
  }
  const phoneDigits = pickupPhone.value.replace(/\D/g, '');
  const emailIsValid = pickupEmail?.checkValidity() && pickupEmail.value.trim().length > 0;
  if (!pickupDay.value || !pickupTime.value || pickupName.value.trim().length < 2 || phoneDigits.length < 10 || !emailIsValid) {
    pickupError.textContent = !pickupDay.value
      ? 'Choose a pickup date from the calendar.'
      : !pickupTime.value
        ? 'Choose a pickup time.'
        : pickupName.value.trim().length < 2
          ? 'Enter the pickup person’s full name.'
          : phoneDigits.length < 10
            ? 'Enter a valid mobile number.'
            : 'Enter a valid email address.';
    pickupError.hidden = false;
    (!pickupDay.value ? pickupDay
      : !pickupTime.value ? pickupTime
        : pickupName.value.trim().length < 2 ? pickupName
          : phoneDigits.length < 10 ? pickupPhone
            : pickupEmail).focus();
    return;
  }
  pickupError.hidden = true;
  const selectedDate = new Date(`${pickupDay.value}T12:00:00`);
  const selectedDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(selectedDate);
  const selectedLocation = document.querySelector('input[name="pickupLocation"]:checked').value;
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const orderTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  checkoutBtn.textContent = 'Sending Order…';
  checkoutBtn.disabled = true;

  try {
    const response = await fetch('/api/pickup-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        customerName: pickupName.value.trim(),
        phone: pickupPhone.value.trim(),
        email: pickupEmail.value.trim(),
        pickupStore: selectedLocation,
        pickupDate: pickupDay.value,
        pickupDateLabel: selectedDay,
        pickupTime: pickupTime.value,
        items: cart.map(({ id, name, price, qty }) => ({ id, name, price, qty })),
        itemCount,
        orderTotal,
        sourcePage: window.location.href
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new Error(result.message || `Order email failed with status ${response.status}`);
    }

    const confirmedReference = result.orderReference;
    const savedOrder = {
      orderReference: confirmedReference,
      email: pickupEmail.value.trim(),
      pickupStore: result.pickupStore,
      placedAt: result.placedAt,
      cancelBy: result.cancelBy,
      status: 'active'
    };
    try {
      localStorage.setItem('ul-latest-pickup-order', JSON.stringify(savedOrder));
    } catch (error) {
      console.warn('Unable to save pickup order on this device:', error);
    }
    const cancelDeadline = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/St_Thomas', timeZoneName: 'short'
    }).format(new Date(result.cancelBy));
    checkoutBtn.textContent = 'Pickup Order Sent ✓';
    showToast('Pickup order sent', `${confirmedReference} · ${selectedLocation} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${selectedDay}, ${pickupTime.value}`);
    cart = [];
    updateCart();
    cartBody.innerHTML = `
      <div class="cart-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 2.5 2.5L16 9"/></svg>
        <p>Pickup request received</p>
        <span>YOUR PICKUP REFERENCE</span>
        <strong style="font-family:var(--font-serif);font-size:24px;color:var(--gold);letter-spacing:.06em">${confirmedReference}</strong>
        <span>Show this reference when collecting your order.</span>
        <span><strong>${result.pickupStore}</strong><br>${result.pickupAddress}<br>${result.storePhone}</span>
        <span>A confirmation was sent to ${pickupEmail.value.trim()}.</span>
        <div class="pickup-cancel-box" id="pickupCancelBox">
          <span>You may request cancellation until <strong>${cancelDeadline}</strong>.</span>
          <button type="button" class="btn-cancel-pickup" id="cancelPickupBtn">Cancel Pickup Order</button>
          <span class="pickup-cancel-status" id="pickupCancelStatus" role="status"></span>
        </div>
      </div>`;
    document.getElementById('cancelPickupBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = document.getElementById('pickupCancelStatus');
      if (!window.confirm(`Cancel pickup order ${confirmedReference}?`)) return;
      button.disabled = true;
      button.textContent = 'Sending Cancellation…';
      try {
        const cancelResponse = await fetch('/api/cancel-pickup-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(savedOrder)
        });
        const cancelResult = await cancelResponse.json().catch(() => ({}));
        if (!cancelResponse.ok || cancelResult.success === false) {
          throw new Error(cancelResult.message || 'Unable to cancel this pickup order.');
        }
        savedOrder.status = 'cancelled';
        savedOrder.cancelledAt = new Date().toISOString();
        try { localStorage.setItem('ul-latest-pickup-order', JSON.stringify(savedOrder)); } catch (_) {}
        button.textContent = 'Cancellation Requested ✓';
        status.textContent = 'The store has been notified and a confirmation email has been sent.';
        showToast('Cancellation requested', `${confirmedReference} · ${result.pickupStore}`);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Try Cancellation Again';
        status.textContent = error.message;
      }
    });
    checkoutBtn.textContent = 'Place Pick-Up Order';
    checkoutBtn.disabled = false;
  } catch (error) {
    console.error('Unable to send pickup order:', error);
    pickupError.textContent = 'We could not send your order. Check your connection and try again.';
    pickupError.hidden = false;
    checkoutBtn.textContent = 'Place Pick-Up Order';
    checkoutBtn.disabled = false;
  }
});

function openCart() {
  cartSidebar.classList.add('open');
  cartOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  cartSidebar.classList.remove('open');
  cartOverlay.classList.remove('active');
  document.body.style.overflow = '';
}
cartBtn.addEventListener('click', openCart);
cartClose.addEventListener('click', closeCart);
cartOverlay.addEventListener('click', closeCart);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });

function addToCart(id, name, price, btn) {
  const product = typeof PRODUCTS !== 'undefined' ? PRODUCTS.find((item) => item.id === id) : null;
  const existing = cart.find((i) => i.id === id);
  if (existing) {
    existing.qty += 1;
    if (!existing.img && product?.img) existing.img = product.img;
  } else {
    cart.push({ id, name, price, qty: 1, img: product?.img || '' });
  }
  updateCart();
  openCart();

  /* pulse the add button */
  if (btn) {
    btn.textContent = 'Added!';
    btn.style.background = 'rgba(201,168,76,0.15)';
    btn.style.borderColor = 'var(--gold)';
    btn.style.color = 'var(--gold)';
    setTimeout(() => {
      btn.textContent = 'Add to Cart';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 1600);
  }
}
window.addToCart = addToCart;

function removeFromCart(id) {
  cart = cart.filter((i) => i.id !== id);
  updateCart();
}
window.removeFromCart = removeFromCart;

function changeQty(id, delta) {
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromCart(id);
  else updateCart();
}
window.changeQty = changeQty;

function updateCart() {
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const count = cart.reduce((s, i) => s + i.qty, 0);

  cartBadge.textContent = count;
  cartBtn.setAttribute('aria-label', `Shopping cart, ${count} ${count === 1 ? 'item' : 'items'}`);
  cartTotalEl.textContent = `$${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  cartFooter.style.display = cart.length ? 'block' : 'none';

  if (cart.length === 0) {
    cartBody.innerHTML = `
      <div class="cart-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <p>Your cart is empty</p>
        <span>Discover our exquisite collection</span>
      </div>`;
    return;
  }

  cartBody.innerHTML = cart.map((item) => `
    <div class="cart-item">
      <div class="cart-item-img">
        ${item.img ? `<img src="${item.img}" alt="${item.name}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ''}
        <svg ${item.img ? 'hidden' : ''} width="20" height="28" viewBox="0 0 20 28" fill="none" stroke="rgba(201,168,76,0.4)" stroke-width="1" aria-hidden="true">
          <rect x="4" y="10" width="12" height="16" rx="2"/>
          <rect x="8" y="6" width="4" height="5"/>
          <rect x="7" y="4" width="6" height="3" rx="1"/>
        </svg>
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">$${item.price.toLocaleString()}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id},-1)" aria-label="Decrease">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)" aria-label="Increase">+</button>
          <button class="cart-item-remove" onclick="removeFromCart(${item.id})">Remove</button>
        </div>
      </div>
    </div>`).join('');
}

/* ── CONTINUOUS TESTIMONIAL COLUMNS ──────────────────── */
(function initTestimonialColumns() {
  document.querySelectorAll('.testimonial-column-track').forEach((track) => {
    const group = track.querySelector('.testimonial-group');
    if (!group || track.querySelectorAll('.testimonial-group').length > 1) return;
    const duplicate = group.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    track.appendChild(duplicate);
  });
})();

/* ── ABOUT US STORE GALLERY ──────────────────────────── */
(function initStoryStoreGallery() {
  const gallery = document.getElementById('storyStoreGallery');
  const previous = document.getElementById('storyGalleryPrev');
  const next = document.getElementById('storyGalleryNext');
  const dots = [...document.querySelectorAll('#storyGalleryDots button')];
  if (!gallery || !previous || !next || !dots.length) return;

  const slides = [...gallery.querySelectorAll('.story-store-photo')];
  let activeIndex = 0;

  function update(index) {
    activeIndex = Math.max(0, Math.min(slides.length - 1, index));
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === activeIndex;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-current', String(active));
    });
  }

  function show(index) {
    update(index);
    gallery.scrollTo({ left: gallery.clientWidth * activeIndex, behavior: 'smooth' });
  }

  previous.addEventListener('click', () => show(activeIndex - 1));
  next.addEventListener('click', () => show(activeIndex + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => show(index)));
  gallery.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    show(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
  });
  gallery.addEventListener('scroll', () => {
    requestAnimationFrame(() => update(Math.round(gallery.scrollLeft / Math.max(gallery.clientWidth, 1))));
  }, { passive: true });
  window.addEventListener('resize', () => gallery.scrollTo({ left: gallery.clientWidth * activeIndex }));
  update(0);
})();

/* ── CUSTOMER SUPPORT PANELS ─────────────────────────── */
(function initSupportPanels() {
  const triggers = [...document.querySelectorAll('[data-support-panel]')];
  if (!triggers.length) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="support-overlay" id="supportOverlay"></div>
    <section class="support-modal" id="supportModal" role="dialog" aria-modal="true" aria-labelledby="supportTitle" aria-hidden="true">
      <button type="button" class="support-close" id="supportClose" aria-label="Close information panel">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="support-modal-content" id="supportContent"></div>
    </section>`);

  const overlay = document.getElementById('supportOverlay');
  const modal = document.getElementById('supportModal');
  const closeButton = document.getElementById('supportClose');
  const content = document.getElementById('supportContent');
  let returnFocus = null;

  const panels = {
    help: `
      <p class="support-kicker">Customer Care</p>
      <h2 id="supportTitle">Help &amp; FAQ</h2>
      <p class="support-lead">Visit or call either St. Thomas location for product availability, fragrance guidance, and pickup assistance.</p>
      <div class="support-store-grid">
        <article class="support-store">
          <h3>Luxe Fragrances</h3>
          <p>9001 Havensight Mall, Suite A &amp; B<br>St. Thomas, VI 00802</p>
          <a href="tel:+13406930039">340-693-0039</a>
        </article>
        <article class="support-store">
          <h3>Perfume World</h3>
          <p>4605 Tutu Park Mall<br>St. Thomas, VI 00802</p>
          <a href="tel:+13407775504">340-777-5504</a>
        </article>
      </div>
      <div class="support-faq">
        <details><summary>How does store pickup work?</summary><p>Add your fragrances to the cart, select a store, and choose your preferred pickup date and time. We will contact you after availability is confirmed.</p></details>
        <details><summary>What should I bring to pickup?</summary><p>Bring a photo ID and the unique pickup reference shown on your confirmation.</p></details>
        <details><summary>Is my item reserved immediately?</summary><p>Your online request confirms receipt only. A store team member will confirm product availability and let you know when the order is ready.</p></details>
        <details><summary>Can I get help choosing a fragrance?</summary><p>Yes. Use our Fragrance Guide or visit either location for personalized assistance.</p></details>
      </div>
      <p class="support-contact">General assistance: <a href="mailto:luxefragrances.vi@gmail.com">luxefragrances.vi@gmail.com</a></p>`,
    pickup: `
      <p class="support-kicker">Store Policy</p>
      <h2 id="supportTitle">Pickup &amp; Returns</h2>
      <div class="support-policy-alert">
        <strong>All sales are final.</strong>
        <p>Returns and exchanges are not allowed.</p>
      </div>
      <div class="support-policy-list">
        <h3>Store pickup</h3>
        <ul>
          <li>Select Luxe Fragrances or Perfume World when placing your pickup request.</li>
          <li>Your request is not ready until the selected store confirms availability.</li>
          <li>Bring a photo ID and your unique pickup reference when collecting the order.</li>
          <li>The person named on the pickup request should collect the order.</li>
          <li>You may request cancellation within 24 hours of placing the order. Use the cancellation button shown after checkout, or contact the selected store with your pickup reference.</li>
          <li>Contact the selected store as soon as possible if your pickup date or time changes.</li>
        </ul>
        <h3>Final-sale policy</h3>
        <p>For product-integrity and hygiene reasons, purchased fragrances, body products, gift sets, and other merchandise cannot be returned or exchanged. Please confirm the fragrance, size, quantity, and pickup location before completing your purchase.</p>
      </div>
      <div class="support-store-grid support-store-grid-compact">
        <article class="support-store"><h3>Luxe Fragrances</h3><p>9001 Havensight Mall, Suite A &amp; B<br>St. Thomas, VI 00802</p><a href="tel:+13406930039">340-693-0039</a></article>
        <article class="support-store"><h3>Perfume World</h3><p>4605 Tutu Park Mall<br>St. Thomas, VI 00802</p><a href="tel:+13407775504">340-777-5504</a></article>
      </div>`,
    perfumers: `
      <p class="support-kicker">The Art Behind the Scent</p>
      <h2 id="supportTitle">The Perfumers</h2>
      <p class="support-lead">Every fragrance begins with a perfumer translating an idea, memory, place, or emotion into a composition that unfolds on skin.</p>
      <div class="support-policy-list support-document">
        <h3>Creators of fragrance</h3>
        <p>Perfumers balance natural extracts, aroma molecules, and carefully constructed accords across top, heart, and base notes. Their work combines creative direction, ingredient knowledge, technical precision, and repeated evaluation over time.</p>
        <h3>How a composition develops</h3>
        <ul><li><strong>Top notes</strong> create the opening impression and often feature citrus, aromatic, or bright fruity materials.</li><li><strong>Heart notes</strong> shape the fragrance’s central identity through florals, spices, fruits, or textured accords.</li><li><strong>Base notes</strong> provide depth and longevity with woods, amber, musk, vanilla, resins, and other lasting materials.</li></ul>
        <h3>Our curation</h3>
        <p>Luxe Perfume brings together work from established fragrance houses and distinctive contemporary brands. We curate the assortment; the respective brands and their credited perfumers create and own their compositions.</p>
        <h3>Discover your preferences</h3>
        <p>Explore product note profiles or use <a href="index.html#finder">Find Your Signature Scent</a> to identify the fragrance families and styles that suit you.</p>
      </div>`,
    sustainability: `
      <p class="support-kicker">Considered Choices</p>
      <h2 id="supportTitle">Sustainability</h2>
      <p class="support-lead">We believe a more thoughtful fragrance experience starts with practical choices, honest information, and avoiding unnecessary waste.</p>
      <div class="support-policy-list support-document">
        <h3>Local store pickup</h3>
        <p>Our pickup-first model consolidates orders at existing St. Thomas stores and avoids individual shipping packaging for local customers.</p>
        <h3>Right product, first time</h3>
        <p>Detailed scent notes, size choices, fragrance guidance, and in-store assistance help customers make considered selections. Because products are final sale, we encourage customers to confirm the scent and size before purchasing.</p>
        <h3>Packaging and disposal</h3>
        <p>Keep fragrance bottles away from heat and direct sunlight to extend their useful life. Empty glass bottles and clean paper packaging may be recyclable where local facilities accept them. Pumps, caps, mixed materials, and containers with remaining fragrance may require separate handling; check local guidance before disposal.</p>
        <h3>Brand information</h3>
        <p>Packaging, ingredient sourcing, refill programs, and environmental certifications are determined by each fragrance brand. Contact us if you need help locating a manufacturer’s current sustainability or ingredient information before purchasing.</p>
        <h3>Continuous improvement</h3>
        <p>We will continue reviewing practical opportunities to reduce avoidable materials and improve the information available to customers. We do not claim that every product or brand in our catalog meets the same environmental standard.</p>
      </div>`,
    media: `
      <p class="support-kicker">Press &amp; Partnerships</p>
      <h2 id="supportTitle">Press &amp; Media</h2>
      <p class="support-lead">For interviews, store features, product requests, partnerships, or permission to use Luxe Perfume materials, contact our team with your publication and deadline.</p>
      <div class="support-store-grid">
        <article class="support-store"><h3>Media inquiries</h3><p>Include your name, organization, request, intended use, and response deadline.</p><a href="mailto:luxefragrances.vi@gmail.com?subject=Luxe%20Perfume%20Media%20Inquiry">luxefragrances.vi@gmail.com</a></article>
        <article class="support-store"><h3>Telephone</h3><p>For time-sensitive local requests, contact Luxe Fragrances in Havensight Mall.</p><a href="tel:+13406930039">340-693-0039</a></article>
      </div>
      <div class="support-policy-list support-document">
        <h3>About Luxe Perfume</h3>
        <p>Luxe Perfume is a St. Thomas fragrance destination connecting customers with designer, niche, unisex, body-care, gift-set, and limited-edition selections through Luxe Fragrances and Perfume World.</p>
        <h3>Store locations</h3>
        <p><strong>Luxe Fragrances:</strong> 9001 Havensight Mall, Suite A &amp; B, St. Thomas, VI 00802.<br><strong>Perfume World:</strong> 4605 Tutu Park Mall, St. Thomas, VI 00802.</p>
        <h3>Images and trademarks</h3>
        <p>Please request written permission before reproducing Luxe Perfume website copy, original graphics, or store materials. Product names, packaging, and trademarks remain the property of their respective owners.</p>
      </div>`,
    privacy: `
      <p class="support-kicker">Last updated August 26, 2026</p>
      <h2 id="supportTitle">Privacy Policy</h2>
      <p class="support-lead">Luxe Perfume respects your privacy. This policy explains what information the website uses when you browse, save fragrances, or submit a store-pickup request.</p>
      <div class="support-policy-list support-document">
        <h3>Information we collect</h3>
        <p>When you request store pickup, we collect the name, phone number, email address, selected store, pickup date and time, requested products, quantities, and order reference needed to process the request. Basic technical information, such as the source page and service-delivery logs, may also be processed for security and troubleshooting.</p>
        <h3>How we use information</h3>
        <ul><li>Send the selected store your pickup request.</li><li>Send you a confirmation and contact you about availability or pickup.</li><li>Prevent fraud, diagnose errors, and protect the website.</li><li>Comply with legal obligations and resolve disputes.</li></ul>
        <h3>Who receives order information</h3>
        <p>The selected store receives the order details. An internal order administrator is privately notified of each request. Cloudflare processes the submission and delivers transactional emails on our behalf. We do not sell customer personal information.</p>
        <h3>Information stored in your browser</h3>
        <p>Your liked fragrances, theme choice, account preferences, and cookie choices may be stored locally on your device. You can remove local data through your browser settings. Clearing it may reset those preferences.</p>
        <h3>Retention and security</h3>
        <p>Order information is kept only as long as reasonably necessary to fulfill pickup requests, maintain business records, prevent abuse, and meet legal requirements. We use reasonable safeguards, but no internet transmission or storage system can be guaranteed completely secure.</p>
        <h3>Your choices</h3>
        <p>You may ask to access, correct, or delete personal information, subject to applicable recordkeeping requirements. You can also change optional cookie preferences at any time through Cookie Settings.</p>
        <h3>Contact</h3>
        <p>For privacy questions, email <a href="mailto:luxefragrances.vi@gmail.com">luxefragrances.vi@gmail.com</a> or call Luxe Fragrances at <a href="tel:+13406930039">340-693-0039</a>.</p>
      </div>`,
    terms: `
      <p class="support-kicker">Last updated August 26, 2026</p>
      <h2 id="supportTitle">Terms of Service</h2>
      <p class="support-lead">By using luxeperfume.com or submitting a pickup request, you agree to these terms.</p>
      <div class="support-policy-list support-document">
        <h3>Website information</h3>
        <p>We aim to keep product descriptions, images, prices, and availability accurate. Fragrance appearance and packaging may vary, and errors may be corrected without notice.</p>
        <h3>Pickup requests</h3>
        <p>An online submission is a request, not a guarantee of inventory or a completed sale. The selected store must confirm availability. Bring a photo ID and the unique order reference. We may contact you if an item, date, or time is unavailable.</p>
        <h3>Prices and payment</h3>
        <p>Displayed prices are in U.S. dollars and may change before the store completes the sale. Any applicable charges will be communicated at purchase. Do not submit false, misleading, or unauthorized customer information.</p>
        <h3>Returns and exchanges</h3>
        <div class="support-policy-alert"><strong>All sales are final.</strong><p>Returns and exchanges are not allowed. Confirm the product, size, quantity, and store before purchase.</p></div>
        <h3>Acceptable use</h3>
        <p>You may not misuse the website, interfere with its operation, attempt unauthorized access, submit fraudulent orders, scrape the catalog at disruptive volume, or use site content in violation of applicable law.</p>
        <h3>Intellectual property</h3>
        <p>The Luxe Perfume website design, copy, graphics, and original materials are protected by applicable intellectual-property laws. Product names and trademarks belong to their respective owners.</p>
        <h3>Service availability and liability</h3>
        <p>The site is provided on an “as available” basis. To the extent permitted by law, Luxe Perfume is not responsible for indirect or consequential losses caused by interrupted access, inaccurate third-party information, or events outside reasonable control. Nothing here limits rights that cannot legally be excluded.</p>
        <h3>Changes and contact</h3>
        <p>We may update these terms by posting a revised date. Questions may be sent to <a href="mailto:luxefragrances.vi@gmail.com">luxefragrances.vi@gmail.com</a>.</p>
      </div>`,
    cookies: `
      <p class="support-kicker">Your Privacy Choices</p>
      <h2 id="supportTitle">Cookie Settings</h2>
      <p class="support-lead">Choose which optional technologies Luxe Perfume may use. Essential storage remains active because it supports requested site functions.</p>
      <div class="cookie-options">
        <label class="cookie-option"><span><strong>Essential</strong><small>Supports core functions, security, pickup flow, theme, and saved likes. Always active.</small></span><input type="checkbox" checked disabled aria-label="Essential storage is always active"></label>
        <label class="cookie-option"><span><strong>Analytics</strong><small>Allows anonymous measurement of site usage so pages and navigation can be improved.</small></span><input type="checkbox" id="cookieAnalytics"></label>
        <label class="cookie-option"><span><strong>Marketing</strong><small>Allows optional technologies used to measure campaigns or personalize promotions.</small></span><input type="checkbox" id="cookieMarketing"></label>
      </div>
      <p class="cookie-note">The current site does not load optional analytics or marketing trackers. These preferences are saved for future integrations, which must check your choices before loading.</p>
      <button type="button" class="btn-gold" id="saveCookiePreferences">Save Preferences</button>
      <p class="pickup-error cookie-status" id="cookieStatus" role="status" hidden></p>`,
    accessibility: `
      <p class="support-kicker">Our Commitment</p>
      <h2 id="supportTitle">Accessibility</h2>
      <p class="support-lead">Luxe Perfume is committed to making its website and store-pickup experience usable by as many people as possible, including visitors who use assistive technologies.</p>
      <div class="support-policy-list support-document">
        <h3>Website features</h3>
        <ul><li>Keyboard-accessible navigation, dialogs, forms, and product controls.</li><li>Visible focus states and descriptive labels for interactive controls.</li><li>Semantic headings, alternative text, and status announcements where practical.</li><li>Light and dark display themes and support for reduced-motion preferences.</li><li>Responsive layouts for screen magnification and smaller devices.</li></ul>
        <h3>Ongoing improvement</h3>
        <p>Accessibility is an ongoing effort. We review the experience as content and features change and work to address barriers that are reported.</p>
        <h3>Request assistance</h3>
        <p>If you have difficulty using the site or placing a pickup request, tell us which page or feature caused the problem and what assistive technology or browser you were using, if you are comfortable sharing it.</p>
        <div class="support-store-grid support-store-grid-compact">
          <article class="support-store"><h3>Email assistance</h3><p><a href="mailto:luxefragrances.vi@gmail.com">luxefragrances.vi@gmail.com</a></p></article>
          <article class="support-store"><h3>Telephone assistance</h3><p><a href="tel:+13406930039">Luxe Fragrances: 340-693-0039</a><br><a href="tel:+13407775504">Perfume World: 340-777-5504</a></p></article>
        </div>
        <p>We will make reasonable efforts to provide the information, product guidance, or pickup assistance through an accessible alternative.</p>
      </div>`
  };

  function openPanel(type, trigger) {
    content.innerHTML = panels[type] || panels.help;
    if (type === 'cookies') {
      try {
        const preferences = JSON.parse(localStorage.getItem('luxe-perfume-cookie-preferences') || '{}');
        document.getElementById('cookieAnalytics').checked = preferences.analytics === true;
        document.getElementById('cookieMarketing').checked = preferences.marketing === true;
      } catch (error) {
        console.warn('Unable to load cookie preferences:', error);
      }
    }
    returnFocus = trigger;
    modal.classList.add('open');
    overlay.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeButton.focus();
  }

  function closePanel() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    overlay.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    returnFocus?.focus();
  }

  triggers.forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.preventDefault();
    openPanel(trigger.dataset.supportPanel, trigger);
  }));
  closeButton.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);
  content.addEventListener('click', (event) => {
    if (event.target.id !== 'saveCookiePreferences') return;
    const preferences = {
      essential: true,
      analytics: document.getElementById('cookieAnalytics').checked,
      marketing: document.getElementById('cookieMarketing').checked,
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem('luxe-perfume-cookie-preferences', JSON.stringify(preferences));
      const status = document.getElementById('cookieStatus');
      status.textContent = 'Your cookie preferences have been saved.';
      status.hidden = false;
    } catch (error) {
      console.warn('Unable to save cookie preferences:', error);
    }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanel(); });
})();

/* ── WISHLIST TOGGLE ────────────────────────────────── */
const WISHLIST_STORAGE_KEY = 'luxe-perfume-wishlist';
let wishlist = new Set();

try {
  const savedWishlist = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY) || '[]');
  if (Array.isArray(savedWishlist)) wishlist = new Set(savedWishlist.map(Number).filter(Number.isFinite));
} catch (error) {
  console.warn('Unable to load saved fragrances:', error);
}

document.body.insertAdjacentHTML('afterbegin', `
  <div class="cart-overlay wishlist-overlay" id="wishlistOverlay"></div>
  <aside class="cart-sidebar wishlist-sidebar" id="wishlistSidebar" aria-label="Liked fragrances" aria-hidden="true">
    <div class="cart-header">
      <span class="cart-title">Your Likes</span>
      <button type="button" class="cart-close" id="wishlistClose" aria-label="Close liked fragrances">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="cart-body wishlist-body" id="wishlistBody"></div>
  </aside>`);

const wishlistOverlay = document.getElementById('wishlistOverlay');
const wishlistSidebar = document.getElementById('wishlistSidebar');
const wishlistBody = document.getElementById('wishlistBody');
const wishlistClose = document.getElementById('wishlistClose');
const wishlistNavButtons = [...document.querySelectorAll('.nav-wishlist')];

wishlistNavButtons.forEach((button) => {
  button.type = 'button';
  button.setAttribute('aria-label', 'View liked fragrances');
  button.insertAdjacentHTML('beforeend', '<span class="cart-badge wishlist-badge">0</span>');
});

function wishlistProductId(button) {
  const cardId = button.closest('.product-card')?.dataset.id;
  if (cardId) return Number(cardId);
  if (button.id === 'pdpWish') return Number(new URLSearchParams(window.location.search).get('id'));
  return NaN;
}

function syncWishlistButtons() {
  document.querySelectorAll('.product-wish, .pdp-wish').forEach((button) => {
    const id = wishlistProductId(button);
    if (!Number.isFinite(id)) return;
    const active = wishlist.has(id);
    button.classList.toggle('wished', active);
    button.setAttribute('aria-pressed', String(active));
    const product = typeof PRODUCTS !== 'undefined' ? PRODUCTS.find((item) => item.id === id) : null;
    button.setAttribute('aria-label', `${active ? 'Remove' : 'Add'} ${product?.name || 'fragrance'} ${active ? 'from' : 'to'} likes`);
    const path = button.querySelector('svg path');
    if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
  });
}

function renderWishlist() {
  const products = typeof PRODUCTS === 'undefined'
    ? []
    : [...wishlist].map((id) => PRODUCTS.find((product) => product.id === id)).filter(Boolean);

  document.querySelectorAll('.wishlist-badge').forEach((badge) => {
    badge.textContent = products.length;
    badge.classList.toggle('visible', products.length > 0);
  });

  if (!products.length) {
    wishlistBody.innerHTML = `
      <div class="cart-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <p>No liked fragrances yet</p>
        <span>Tap a heart to save a fragrance here.</span>
      </div>`;
    return;
  }

  wishlistBody.innerHTML = products.map((product) => {
    const price = product.sizes?.[0]?.price ?? product.price;
    return `
      <article class="wishlist-item">
        <a class="wishlist-item-img" href="product.html?id=${product.id}" aria-label="View ${product.name}">
          ${product.img ? `<img src="${product.img}" alt="${product.name}" loading="lazy">` : ''}
        </a>
        <div class="wishlist-item-info">
          <span class="wishlist-item-brand">${product.brand}</span>
          <a class="wishlist-item-name" href="product.html?id=${product.id}">${product.name}</a>
          <span class="wishlist-item-price">From $${Number(price).toFixed(2)}</span>
          <div class="wishlist-item-actions">
            <button type="button" data-wishlist-cart="${product.id}">Add to Cart</button>
            <button type="button" data-wishlist-remove="${product.id}">Remove</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function saveWishlist() {
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify([...wishlist]));
  } catch (error) {
    console.warn('Unable to save liked fragrances:', error);
  }
  syncWishlistButtons();
  renderWishlist();
}

function toggleWishlist(id) {
  const product = typeof PRODUCTS !== 'undefined' ? PRODUCTS.find((item) => item.id === id) : null;
  if (!product) return;
  const removing = wishlist.has(id);
  removing ? wishlist.delete(id) : wishlist.add(id);
  saveWishlist();
  showToast(removing ? 'Removed from likes' : 'Saved to your likes', product.name, removing ? 'info' : 'success');
}

function openWishlist() {
  renderWishlist();
  wishlistSidebar.classList.add('open');
  wishlistOverlay.classList.add('active');
  wishlistSidebar.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeWishlist() {
  wishlistSidebar.classList.remove('open');
  wishlistOverlay.classList.remove('active');
  wishlistSidebar.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* Capture heart clicks before legacy carousel/grid handlers can toggle them twice. */
document.addEventListener('click', (event) => {
  const heartButton = event.target.closest('.product-wish, .pdp-wish');
  if (!heartButton) return;
  const id = wishlistProductId(heartButton);
  if (!Number.isFinite(id)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleWishlist(id);
}, true);

wishlistNavButtons.forEach((button) => button.addEventListener('click', openWishlist));
wishlistClose.addEventListener('click', closeWishlist);
wishlistOverlay.addEventListener('click', closeWishlist);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeWishlist(); });

wishlistBody.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-wishlist-remove]');
  if (removeButton) {
    toggleWishlist(Number(removeButton.dataset.wishlistRemove));
    return;
  }
  const cartButton = event.target.closest('[data-wishlist-cart]');
  if (cartButton) {
    const product = PRODUCTS.find((item) => item.id === Number(cartButton.dataset.wishlistCart));
    if (!product) return;
    const size = product.sizes[0];
    closeWishlist();
    addToCart(product.id, size?.size ? `${product.name} · ${size.size}` : product.name, size?.price ?? product.price, cartButton);
  }
});

const wishlistDomObserver = new MutationObserver(() => syncWishlistButtons());
wishlistDomObserver.observe(document.body, { childList: true, subtree: true });
syncWishlistButtons();
renderWishlist();

/* ── SMOOTH ANCHOR SCROLL ───────────────────────────── */
/* Two things stand between an anchor link and the section it names:
   1) The shop grid lazy-loads product cards in batches as it nears the
      viewport, so its final height isn't known until fully rendered.
   2) Sections below the hero use content-visibility:auto to skip layout
      while off-screen (see styles.css), so an unvisited section's true
      height is unknown too — worst of all the shop grid's own skipped
      placeholder (900px), nowhere near its real height once hundreds of
      product cards are in the DOM.
   Either way, a single scrollIntoView() targets a pixel offset computed
   from whatever's currently measured, so anchors past the shop grid
   (Collections, About, Contact) land short — and since the current scroll
   position can itself sit past unresolved sections (e.g. a footer link
   back up to Collections), it's not just sections "before" the target that
   need fixing. Force real rendering — full catalogue plus real layout on
   every skipped section on the page — before computing the jump, then let
   whichever end up off-screen go back to being skipped once painted. */
const CV_SECTIONS = '.collections,.brands,.new-arrivals,.ai-finder,.bestsellers,.shop-browse,.story,.process,.testimonials,.newsletter,.footer';

function scrollToTarget(target) {
  const shop = document.getElementById('shop');
  const pastShop = shop && (target === shop || shop.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (pastShop) window.ensureShopFullyRendered?.();

  const revealed = Array.from(document.querySelectorAll(CV_SECTIONS));
  revealed.forEach((s) => { s.style.contentVisibility = 'visible'; });
  /* Force the browser to fully commit the layout those reveals just
     unlocked before reading positions off of it — otherwise scrollIntoView
     can still compute against a layout pass that hasn't settled yet. */
  void document.body.offsetHeight;

  /* A smooth scroll across the fully-rendered catalogue spans an enormous
     distance — 'auto' still defers to the page's global smooth-scroll CSS,
     so force an instant jump instead. */
  target.scrollIntoView({ behavior: pastShop ? 'instant' : 'smooth', block: 'start' });

  setTimeout(() => {
    revealed.forEach((s) => { s.style.contentVisibility = ''; });
  }, 700);
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    scrollToTarget(target);
  });
});

/* Hero glass shards: explicit section navigation with URL state. */
document.querySelector('.shard-stage')?.addEventListener('click', (event) => {
  const link = event.target.closest('.nav-shard[href^="#"]');
  if (!link) return;
  const hash = link.getAttribute('href');
  const target = hash && document.querySelector(hash);
  if (!target) return;
  event.preventDefault();
  scrollToTarget(target);
  history.pushState(null, '', hash);
});

/* ── FEATURED COLLECTION SPOTLIGHT ─────────────────── */
(function initCollectionSpotlights() {
  document.querySelectorAll('.spotlight-card[data-glow]').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hue = Number(card.style.getPropertyValue('--base') || 35)
        + (event.clientX / window.innerWidth) * Number(card.style.getPropertyValue('--spread') || 60);
      card.style.setProperty('--local-x', `${x}px`);
      card.style.setProperty('--local-y', `${y}px`);
      card.style.setProperty('--hue', hue.toFixed(2));
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--local-x');
      card.style.removeProperty('--local-y');
    });
  });
})();

/* ── IMAGE STREAM HERO ──────────────────────────────── */
(function initImageStreamHero() {
  const corridor = document.getElementById('streamCorridor');
  if (!corridor) return;

  const images = [
    ['images/pradaparadoxeintense2.jpg.webp', 'Prada Paradoxe Intense'],
    ['images/jadoreedp2.jpg.webp', 'Dior J’adore'],
    ['images/floragardenia2.jpg', 'Gucci Flora Gorgeous Gardenia'],
    ['images/chanceeautendreedt2.jpg', 'Chanel Chance Eau Tendre'],
    ['images/n5edp2.jpg', 'Chanel N°5'],
    ['images/libreleparfum2.jpg', 'Yves Saint Laurent Libre'],
    ['images/valentinouomobiredt2.jpg.webp', 'Valentino Uomo Born in Roma'],
    ['images/muglerangelstellar2.webp', 'Mugler Angel Stellar'],
    ['images/kenzofloweredp2.jpg', 'Kenzo Flower']
  ];
  const path = { perspective:30, cardWidth:18, cardHeight:25, birthHeight:2.6, exitHeight:46, railBirth:-11, railExit:44, fan:3.3, turnBirth:6, turnExit:28 };
  const cards = 9;
  const duration = 18000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const streamCards = [];
  const imageReady = [];

  [-1, 1].forEach((direction) => {
    images.forEach(([src, alt], index) => {
      const card = document.createElement('figure');
      card.className = 'stream-card';
      card.style.cssText = `width:${path.cardWidth}cqw;height:${path.cardHeight}cqw;margin-left:${-path.cardWidth / 2}cqw;margin-top:${-path.cardHeight / 2}cqw`;
      card.innerHTML = `<img src="${src}" alt="${alt}" loading="eager" decoding="async">`;
      const image = card.querySelector('img');
      image.addEventListener('error', () => {
        image.src = 'images/n5edp2.jpg';
        image.alt = 'Chanel N°5';
      }, { once:true });
      imageReady.push(image.decode ? image.decode().catch(() => undefined) : Promise.resolve());
      corridor.appendChild(card);

      streamCards.push({ card, direction, index });
    });
  });

  function renderStream(elapsed) {
    streamCards.forEach(({ card, direction, index }) => {
      const u = ((elapsed / duration) + (index / cards)) % 1;
      const scale = (path.birthHeight / path.cardHeight) * Math.pow(path.exitHeight / path.birthHeight, u);
      const z = path.perspective * (1 - 1 / scale);
      const rail = path.railExit - (path.railExit - path.railBirth) * Math.pow(1 - u, path.fan);
      const turn = path.turnBirth + (path.turnExit - path.turnBirth) * u;
      card.style.transform = `translate3d(${direction * rail}cqw,0,${z}cqw) rotateY(${-direction * turn}deg)`;
    });
  }

  Promise.all(imageReady).then(() => {
    renderStream(0);
    corridor.classList.add('stream-corridor-ready');
    if (reducedMotion) return;

    /* Every card is derived from this one clock, so spacing cannot drift or collapse. */
    let origin;
    function tick(now) {
      if (origin === undefined) origin = now;
      renderStream(now - origin);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
})();

/* ── BEST SELLERS CAROUSEL ─────────────────────────── */
(function initBestSellersCarousel() {
  const track = document.getElementById('productsGrid');
  const prev = document.getElementById('bestPrev');
  const next = document.getElementById('bestNext');
  const dots = document.getElementById('bestDots');
  if (!track || !prev || !next || !dots) return;

  if (typeof PRODUCTS !== 'undefined' && typeof renderProductCard !== 'undefined') {
    const bestSellers = PRODUCTS.filter((p) => p.badgeText === 'Best Seller');
    if (bestSellers.length) {
      track.innerHTML = bestSellers.map((p) => renderProductCard(p)).join('');
      track.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
      track.querySelectorAll('.product-wish').forEach((btn) => {
        btn.addEventListener('click', () => {
          const active = btn.classList.toggle('wished');
          const path = btn.querySelector('svg path');
          if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
          btn.style.color = active ? 'var(--gold)' : '';
          btn.style.borderColor = active ? 'var(--gold)' : '';
          btn.setAttribute('aria-pressed', active);
        });
      });
    }
  }

  const cards = Array.from(track.querySelectorAll('.product-card'));
  if (!cards.length) return;

  /* The shared coverflow controller below owns layout and navigation. */
  return;

  function cardsPerView() {
    if (window.matchMedia('(max-width: 480px)').matches) return 1;
    if (window.matchMedia('(max-width: 1100px)').matches) return 2;
    return 3;
  }

  function pageCount() {
    return Math.max(1, Math.ceil(cards.length / cardsPerView()));
  }

  function activePage() {
    const first = cards[0];
    const gap = parseFloat(getComputedStyle(track).columnGap || '0');
    const step = first.offsetWidth + gap;
    return Math.min(pageCount() - 1, Math.round(track.scrollLeft / (step * cardsPerView())));
  }

  function scrollToPage(page) {
    const perView = cardsPerView();
    const index = Math.min(cards.length - 1, page * perView);
    track.scrollTo({ left: cards[index].offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }

  function renderDots() {
    dots.innerHTML = Array.from({ length: pageCount() }, (_, i) =>
      `<button class="carousel-dot" type="button" aria-label="Show best sellers page ${i + 1}"></button>`
    ).join('');
    dots.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.addEventListener('click', () => scrollToPage(i));
    });
  }

  function updateControls() {
    const page = activePage();
    const pages = pageCount();
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    dots.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === page);
      dot.setAttribute('aria-current', i === page ? 'true' : 'false');
    });
  }

  prev.addEventListener('click', () => scrollToPage(Math.max(0, activePage() - 1)));
  next.addEventListener('click', () => scrollToPage(Math.min(pageCount() - 1, activePage() + 1)));
  track.addEventListener('scroll', () => requestAnimationFrame(updateControls), { passive: true });
  window.addEventListener('resize', () => {
    renderDots();
    updateControls();
  });

  renderDots();
  updateControls();
})();

/* ── MULTI-LAYER PARALLAX ───────────────────────────── */
const heroBottlesBg       = document.getElementById('heroBottlesBg');
const heroBottleFeatured  = document.getElementById('heroBottleFeatured');
const heroContentEl       = document.getElementById('heroContent');
const heroBackdrop        = document.querySelector('.hero-backdrop');
const reduceMotion        = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let ticking = false;
(heroBackdrop || heroBottlesBg || heroBottleFeatured || heroContentEl) && window.addEventListener('scroll', () => {
  if (reduceMotion) return;
  if (!ticking) {
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (y < window.innerHeight * 1.4) {
        if (heroBackdrop)
          heroBackdrop.style.transform = `scale(1.04) translateY(${y * 0.05}px)`;
        /* Layer 1 — side bottles drift upward slowly (depth illusion) */
        if (heroBottlesBg)
          heroBottlesBg.style.transform = `translateY(${y * 0.28}px)`;
        /* Layer 2 — featured centre bottle moves at medium speed */
        if (heroBottleFeatured)
          heroBottleFeatured.style.transform =
            `translateX(-50%) translateY(${y * 0.18}px)`;
        /* Layer 3 — content text lifts slightly (foreground) */
        if (heroContentEl)
          heroContentEl.style.transform = `translateY(${y * 0.08}px)`;
        /* Orbs drift in alternating directions */
        document.querySelectorAll('.hero-orb').forEach((orb, i) => {
          orb.style.transform = `translateY(${y * (i % 2 === 0 ? 0.12 : -0.09)}px)`;
        });
      }
      ticking = false;
    });
    ticking = true;
  }
}, { passive: true });

/* ── GOLD PARTICLE GENERATOR ────────────────────────── */
(function spawnParticles() {
  const container = document.getElementById('heroParticles');
  if (!container) return;
  const COUNT = 22;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size   = Math.random() * 3 + 1;           /* 1–4 px */
    const left   = Math.random() * 100;             /* 0–100 vw */
    const dur    = Math.random() * 14 + 10;         /* 10–24 s */
    const delay  = -(Math.random() * dur);          /* stagger start */
    const drift  = (Math.random() - 0.5) * 120;    /* ±60 px horizontal */
    p.style.cssText = `
      width:${size}px;height:${size}px;
      left:${left}%;
      animation-duration:${dur}s;
      animation-delay:${delay}s;
      --drift:${drift}px;
      opacity:0;
    `;
    container.appendChild(p);
  }
})();

/* ── GENDER PILL ACTIVE STATE ────────────────────────── */
document.querySelectorAll('.gender-pill').forEach((pill) => {
  pill.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.gender-pill').forEach((p) =>
      p.classList.remove('gender-pill-active')
    );
    pill.classList.add('gender-pill-active');
  });
});

/* ═══════════════════════════════════════════════════════
   FEATURE ADDITIONS
   ═══════════════════════════════════════════════════════ */

/* ── TOAST SYSTEM ────────────────────────────────────── */
function showToast(title, message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const iconSvg = type === 'success'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-text"><strong>${title}</strong>${message}</div>
    <button class="toast-close" aria-label="Dismiss notification">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;

  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 4000);
}

/* Override addToCart to fire toast */
const _origAddToCart = window.addToCart;
window.addToCart = function(id, name, price, btn) {
  _origAddToCart(id, name, price, btn);
  showToast('Added to cart', `${name} — $${price}`, 'success');
};

/* ── THEME TOGGLE ────────────────────────────────────── */
(function initTheme() {
  const html = document.documentElement;
  const btn  = document.getElementById('themeToggle');

  function applyTheme(t) {
    html.setAttribute('data-theme', t);
    try { localStorage.setItem('ul-theme', t); } catch(e) {}
    if (btn) {
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  /* Read stored preference → system preference → default dark */
  let theme;
  try { theme = localStorage.getItem('ul-theme'); } catch(e) {}
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(theme);

  btn?.addEventListener('click', () => {
    applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* Keep in sync when OS preference changes and no manual choice stored */
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    try { if (localStorage.getItem('ul-theme')) return; } catch(e2) {}
    applyTheme(e.matches ? 'dark' : 'light');
  });
})();

/* ── PRODUCTS DATA ────────────────────────────────────
   Lives in products-data.js (loaded before this file) so
   product.html can share the same catalogue without duplicating it. */

/* ── ML ↔ FL OZ CONVERSION ────────────────────────────── */
function mlToFlOz(ml) {
  return (ml * 0.033814).toFixed(1);
}
function formatSizeLabel(sizeStr) {
  const match = /^([\d.]+)\s*ml$/i.exec(sizeStr.trim());
  if (!match) return sizeStr;
  return `${sizeStr} / ${mlToFlOz(parseFloat(match[1]))} oz`;
}

/* ── RENDER PRODUCT CARD ─────────────────────────────── */
function renderProductCard(p, extraClass = '') {
  const badge = p.badgeText
    ? `<div class="product-badge ${p.badgeClass}">${p.badgeText}</div>` : '';
  const stars = '★'.repeat(Math.floor(p.rating)) + (p.rating % 1 ? '½' : '');
  const defaultSize = p.sizes[0];
  const sizeBtns = p.sizes.map((s, i) =>
    `<button class="size-btn${i === 0 ? ' size-btn-active' : ''}" type="button" data-size="${s.size}" data-price="${s.price}">${formatSizeLabel(s.size)}</button>`
  ).join('');
  return `
  <article class="product-card reveal${extraClass ? ' ' + extraClass : ''}"
    data-id="${p.id}" data-brand="${p.brandKey}" data-price="${defaultSize.price}"
    data-scent="${p.scents.join(' ')}" data-gender="${p.gender}" data-rating="${p.rating}"
    data-name="${p.name.replace(/"/g,'&quot;')}">
    <div class="product-image">
      <a class="product-link-img" href="product.html?id=${p.id}" aria-label="View ${p.name} details">
      ${p.img
        ? `<div class="product-img-wrap">
          <img class="product-img product-img-primary" src="${p.img}" alt="${p.name}" loading="lazy" decoding="async" fetchpriority="low">
          ${p.imgHover ? `<img class="product-img product-img-hover" src="${p.imgHover}" alt="${p.name} detail" loading="lazy" decoding="async" fetchpriority="low">` : ''}
        </div>`
        : `<div class="product-bottle ${p.bottleClass}" role="img" aria-label="${p.name} perfume bottle">
          <div class="pb-cap"></div><div class="pb-neck"></div>
          <div class="pb-body"><div class="pb-liquid"></div><div class="pb-shine"></div></div>
        </div>`
      }
      </a>
      <div class="product-actions">
        <button class="product-wish" aria-label="Add ${p.name} to wishlist" aria-pressed="false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="product-quick" aria-label="Quick view ${p.name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      ${badge}
      <div class="product-preview">
        <span>Preview notes</span>
        <strong>${p.preview}</strong>
        <button class="btn-quick-view" type="button">Quick View</button>
      </div>
    </div>
    <div class="product-info">
      <div class="product-notes">${p.notes.map(n => `<span>${n}</span>`).join('')}</div>
      <p class="product-brand">${p.brand}</p>
      <h3 class="product-name"><a class="product-link-name" href="product.html?id=${p.id}">${p.name}</a></h3>
      <div class="product-rating" aria-label="Rated ${p.rating} out of 5 stars">
        <span aria-hidden="true">${stars}</span>
        <strong>${p.rating.toFixed(1)}</strong>
        <em>(${p.reviews})</em>
      </div>
      <p class="product-desc">${p.desc}</p>
      <blockquote class="product-review">"${p.review}"</blockquote>
      <div class="product-sizes">${sizeBtns}</div>
      <div class="product-footer">
        <span class="product-price">$${defaultSize.price}</span>
        <button class="btn-add-cart" onclick="addToCartFromCard(this)">Add to Cart</button>
      </div>
    </div>
  </article>`;
}

/* ── ADD TO CART FROM CARD (size-aware) ──────────────── */
function addToCartFromCard(btn) {
  const card      = btn.closest('.product-card');
  const id        = parseInt(card.dataset.id);
  const name      = card.dataset.name;
  const active    = card.querySelector('.size-btn.size-btn-active');
  const size      = active?.dataset.size  || '';
  const price     = parseFloat(active?.dataset.price || card.dataset.price);
  addToCart(id, size ? `${name} · ${size}` : name, price, btn);
}
window.addToCartFromCard = addToCartFromCard;

/* Quick View opens the same product page as the card image and name. */
document.addEventListener('click', (event) => {
  const quickView = event.target.closest('.product-quick, .btn-quick-view');
  if (!quickView) return;
  const card = quickView.closest('.product-card');
  if (!card?.dataset.id) return;
  event.preventDefault();
  event.stopPropagation();
  window.location.assign(`product.html?id=${encodeURIComponent(card.dataset.id)}`);
});

/* ── SIZE BUTTON CLICK (global delegation) ───────────── */
document.addEventListener('click', e => {
  const sizeBtn = e.target.closest('.size-btn');
  if (!sizeBtn) return;
  const card = sizeBtn.closest('.product-card');
  if (!card) return;
  card.querySelectorAll('.size-btn').forEach(b => b.classList.remove('size-btn-active'));
  sizeBtn.classList.add('size-btn-active');
  const priceEl = card.querySelector('.product-price');
  if (priceEl) priceEl.textContent = `$${sizeBtn.dataset.price}`;
});

/* ── SHARED PRICE-RANGE HELPERS (Shop filters + AI quiz) ── */
function priceInRange(price, range) {
  if (range === 'under-60')  return price < 60;
  if (range === '61-100')    return price >= 61 && price <= 100;
  if (range === '101-200')   return price >= 101 && price <= 200;
  if (range === '201-plus')  return price >= 201;
  return false;
}

const PRICE_LABELS = {
  'under-60': 'Under $60',
  '61-100':   '$61 – $100',
  '101-200':  '$101 – $200',
  '201-plus': '$201 & Above',
};

/* ── SHOP GRID INIT & FILTER ─────────────────────────── */
(function initShop() {
  const grid     = document.getElementById('shopGrid');
  const countEl  = document.getElementById('shopCount');
  const emptyEl  = document.getElementById('shopEmpty');
  const activeEl = document.getElementById('shopActiveFilters');
  const badgeEl  = document.getElementById('filterCountBadge');
  const sortSel  = document.getElementById('shopSort');
  if (!grid) return;

  let currentSort = 'featured';
  let currentList = [];
  let renderedCount = 0;
  const BATCH_SIZE = window.matchMedia('(max-width: 700px)').matches ? 12 : 24;
  const loadSentinel = document.createElement('div');
  loadSentinel.className = 'shop-load-sentinel';
  loadSentinel.setAttribute('aria-hidden', 'true');
  grid.insertAdjacentElement('afterend', loadSentinel);

  function renderNextBatch() {
    if (renderedCount >= currentList.length) { loadSentinel.hidden = true; return; }
    const end = Math.min(renderedCount + BATCH_SIZE, currentList.length);
    grid.insertAdjacentHTML('beforeend', currentList.slice(renderedCount, end).map(p => renderProductCard(p)).join(''));
    Array.from(grid.children).slice(renderedCount, end).forEach(el => revealObserver.observe(el));
    renderedCount = end;
    loadSentinel.hidden = renderedCount >= currentList.length;
  }

  /* Keep the complete catalog, but only create nearby cards in the DOM. */
  function renderGrid(list) {
    currentList = list;
    renderedCount = 0;
    grid.replaceChildren();
    loadSentinel.hidden = list.length === 0;
    renderNextBatch();
  }

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderNextBatch();
  }, { rootMargin:'900px 0px' }).observe(loadSentinel);

  grid.addEventListener('click', (event) => {
    const btn = event.target.closest('.product-wish');
    if (!btn) return;
    const active = btn.classList.toggle('wished');
    const path = btn.querySelector('svg path');
    if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
    btn.style.color = active ? 'var(--gold)' : '';
    btn.style.borderColor = active ? 'var(--gold)' : '';
    btn.setAttribute('aria-pressed', active);
  });

  window.ensureShopProductRendered = (id) => {
    const index = currentList.findIndex(p => p.id === Number(id));
    while (index >= renderedCount && renderedCount < currentList.length) renderNextBatch();
    return grid.querySelector(`.product-card[data-id="${id}"]`);
  };

  window.ensureShopFullyRendered = () => {
    while (renderedCount < currentList.length) renderNextBatch();
  };

  const CATEGORY_LABELS = {
    'fragrance': 'Fragrances',
    'mist':      'Perfume Mist',
    'body-care': 'Body Care',
  };

  function getChecked(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
  }

  function applyFilters() {
    const categories = getChecked('category');
    const brands  = getChecked('brand');
    const prices  = getChecked('price');
    const scents  = getChecked('scent');
    const genders = getChecked('gender');
    const ratings = getChecked('rating');
    const sizes   = getChecked('size');

    const filtered = PRODUCTS.filter(p => {
      if (categories.length && !categories.includes(p.category))                 return false;
      if (brands.length  && !brands.includes(p.brandKey))                        return false;
      if (prices.length  && !prices.some(r => p.sizes.some(s => priceInRange(s.price, r)))) return false;
      if (scents.length  && !scents.some(s => p.scents.includes(s)))             return false;
      if (genders.length && !genders.includes(p.gender))                         return false;
      if (ratings.length && p.rating < Math.min(...ratings.map(Number)))         return false;
      if (sizes.length   && !sizes.some(s => p.sizes.some(sz => sz.size === s)))  return false;
      return true;
    });

    const sorted = sortProducts(filtered, currentSort);
    renderGrid(sorted);

    const count = sorted.length;
    countEl.textContent = `${count} product${count !== 1 ? 's' : ''}`;
    emptyEl.hidden  = count > 0;
    grid.hidden     = count === 0;

    /* Active filter chips */
    const allActive = [
      ...categories.map(v => ({ cat:'category', val:v, label:CATEGORY_LABELS[v] || v })),
      ...brands.map(v  => ({ cat:'brand',  val:v, label:v.charAt(0).toUpperCase()+v.slice(1) })),
      ...prices.map(v  => ({ cat:'price',  val:v, label:PRICE_LABELS[v] || v })),
      ...scents.map(v  => ({ cat:'scent',  val:v, label:v.charAt(0).toUpperCase()+v.slice(1) })),
      ...genders.map(v => ({ cat:'gender', val:v, label:v.charAt(0).toUpperCase()+v.slice(1) })),
      ...ratings.map(v => ({ cat:'rating', val:v, label:`${v}+ ★` })),
      ...sizes.map(v   => ({ cat:'size',   val:v, label:v })),
    ];
    activeEl.innerHTML = allActive.map(f => `
      <span class="filter-chip">
        ${f.label}
        <button type="button" data-cat="${f.cat}" data-val="${f.val}" aria-label="Remove ${f.label} filter">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>`).join('');

    activeEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.querySelector(`input[name="${btn.dataset.cat}"][value="${btn.dataset.val}"]`);
        if (input) { input.checked = false; applyFilters(); }
      });
    });

    const totalActive = allActive.length;
    badgeEl.textContent = totalActive;
    badgeEl.hidden = totalActive === 0;
  }

  function sortProducts(list, mode) {
    const copy = [...list];
    if (mode === 'price-asc')  return copy.sort((a,b) => a.price - b.price);
    if (mode === 'price-desc') return copy.sort((a,b) => b.price - a.price);
    if (mode === 'rating')     return copy.sort((a,b) => b.rating - a.rating);
    if (mode === 'name')       return copy.sort((a,b) => a.name.localeCompare(b.name));
    return copy; /* featured = original order */
  }

  /* A product detail page can link directly to a brand's complete catalog. */
  const requestedBrand = new URLSearchParams(window.location.search).get('brand');
  if (requestedBrand) {
    const brandInput = Array.from(document.querySelectorAll('input[name="brand"]'))
      .find((input) => input.value === requestedBrand);
    if (brandInput) brandInput.checked = true;
  }

  applyFilters();

  document.getElementById('filterSidebar')?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', applyFilters);
  });

  sortSel?.addEventListener('change', () => { currentSort = sortSel.value; applyFilters(); });

  document.getElementById('filterClearAll')?.addEventListener('click', () => {
    document.querySelectorAll('#filterSidebar input[type="checkbox"]').forEach(i => i.checked = false);
    applyFilters();
  });

  /* Filter accordion */
  document.querySelectorAll('.filter-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group    = btn.closest('.filter-group');
      const expanded = group.classList.toggle('open');
      btn.setAttribute('aria-expanded', expanded);
    });
  });

  /* Mobile filter drawer */
  const filterBtn     = document.getElementById('shopFilterBtn');
  const sidebar       = document.getElementById('filterSidebar');
  const overlay       = Object.assign(document.createElement('div'), { className:'filter-sidebar-overlay' });
  document.body.appendChild(overlay);

  function closeSidebar() {
    sidebar?.classList.remove('mobile-open');
    overlay.classList.remove('active');
    filterBtn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  filterBtn?.addEventListener('click', () => {
    const open = sidebar?.classList.toggle('mobile-open');
    overlay.classList.toggle('active', open);
    filterBtn.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  });
  overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
})();

/* ── AI FRAGRANCE QUIZ ───────────────────────────────── */
(function initAIQuiz() {
  const startBtn   = document.getElementById('aiStart');
  const header     = document.getElementById('aiHeader');
  const quiz       = document.getElementById('aiQuiz');
  const retakeBtn  = document.getElementById('aiRetake');
  const resultsEl  = document.getElementById('aiResults');
  const resultsSub = document.getElementById('aiResultsSub');
  const fillEl     = document.getElementById('aiProgressFill');
  const labelEl    = document.getElementById('aiProgressLabel');
  const innerEl    = document.querySelector('.ai-finder-inner');
  if (!startBtn || !quiz || typeof PRODUCTS === 'undefined') return;

  const RESULTS_COUNT   = 12;
  const MAX_PER_BRAND   = 2;

  const panels  = Array.from(quiz.querySelectorAll('.ai-panel[data-step]')).filter(p => p.dataset.step !== 'results');
  const resultP = quiz.querySelector('.ai-panel[data-step="results"]');
  let   step    = 0;
  const answers = {};

  function showStep(i) {
    panels.forEach((p, idx) => p.hidden = idx !== i);
    if (resultP) resultP.hidden = true;
    if (innerEl) innerEl.classList.remove('ai-finder-inner-wide');
    const pct = Math.round(((i + 1) / panels.length) * 100);
    if (fillEl) { fillEl.style.width = pct + '%'; fillEl.parentElement.setAttribute('aria-valuenow', pct); }
    if (labelEl) labelEl.textContent = `Step ${i + 1} of ${panels.length}`;
  }

  function advance() {
    step++;
    if (step < panels.length) showStep(step);
    else showResults();
  }

  startBtn.addEventListener('click', () => {
    header.hidden = true;
    quiz.hidden   = false;
    showStep(0);
  });

  quiz.addEventListener('click', e => {
    const continueBtn = e.target.closest('.ai-panel-continue');
    if (continueBtn) { advance(); return; }

    const opt = e.target.closest('.ai-option');
    if (!opt) return;
    const optionsGroup = opt.closest('.ai-options');
    const { key, val } = opt.dataset;
    const isMulti = optionsGroup.dataset.multi === 'true';

    if (isMulti) {
      opt.classList.toggle('selected');
      answers[key] = Array.from(optionsGroup.querySelectorAll('.ai-option.selected')).map(o => o.dataset.val);
      const panelContinue = opt.closest('.ai-panel').querySelector('.ai-panel-continue');
      if (panelContinue) panelContinue.disabled = answers[key].length === 0;
      return;
    }

    answers[key] = val;
    optionsGroup.querySelectorAll('.ai-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    setTimeout(advance, 280);
  });

  /* Picks up to `limit` results, capping how many come from any one brand
     so "more matches" means genuinely different fragrances, not five
     concentrations of the same one. Backfills past the cap only if the
     match pool is too thin to fill the grid otherwise. */
  function diversify(sortedMatches, limit, maxPerBrand) {
    const picks = [];
    const brandCount = {};
    for (const p of sortedMatches) {
      const count = brandCount[p.brand] || 0;
      if (count >= maxPerBrand) continue;
      picks.push(p);
      brandCount[p.brand] = count + 1;
      if (picks.length >= limit) return picks;
    }
    const pickedIds = new Set(picks.map(p => p.id));
    for (const p of sortedMatches) {
      if (pickedIds.has(p.id)) continue;
      picks.push(p);
      pickedIds.add(p.id);
      if (picks.length >= limit) break;
    }
    return picks;
  }

  function showResults() {
    panels.forEach(p => p.hidden = true);
    if (resultP) resultP.hidden = false;
    if (innerEl) innerEl.classList.add('ai-finder-inner-wide');
    if (fillEl) { fillEl.style.width = '100%'; fillEl.parentElement.setAttribute('aria-valuenow', 100); }
    if (labelEl) labelEl.textContent = 'Complete';

    const user = typeof ulCurrentUser === 'function' ? ulCurrentUser() : null;
    const personalized = !!(user && user.preferences);

    const picks = scoreProducts(user && user.preferences);
    if (resultsSub) {
      resultsSub.textContent = personalized
        ? `Based on your answers and your saved taste profile, ${picks.length} fragrances stood out:`
        : `Based on your answers, ${picks.length} fragrances stood out:`;
    }

    if (resultsEl) {
      resultsEl.innerHTML = picks.map(p => renderProductCard(p)).join('');
      resultsEl.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
      resultsEl.querySelectorAll('.product-card').forEach((card, index) => {
        const match = picks[index]?._aiMatch;
        const info = card.querySelector('.product-info');
        if (!match || !info) return;
        info.insertAdjacentHTML('afterbegin', `<div class="ai-match-meta"><strong>${match.confidence}% match</strong><span>${match.reasons.join(' · ')}</span></div>`);
      });
      resultsEl.querySelectorAll('.product-wish').forEach(btn => {
        btn.addEventListener('click', () => {
          const active = btn.classList.toggle('wished');
          const path = btn.querySelector('svg path');
          if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
          btn.style.color = active ? 'var(--gold)' : '';
          btn.style.borderColor = active ? 'var(--gold)' : '';
          btn.setAttribute('aria-pressed', active);
        });
      });
    }
  }

  function scoreProducts(acctPrefs) {
    const genderMap  = { masculine: ['men', 'unisex'], feminine: ['women', 'unisex'], any: ['men', 'women', 'unisex'] };
    const dayScents   = ['fresh', 'floral', 'aquatic', 'fruity'];
    const nightScents = ['oriental', 'woody', 'gourmand', 'chypre'];
    const impressionMap = {
      clean: ['fresh', 'aquatic', 'fruity'],
      romantic: ['floral', 'fruity'],
      bold: ['woody', 'oriental', 'chypre'],
      cozy: ['gourmand', 'oriental', 'woody']
    };
    const impressionLabels = { clean:'clean character', romantic:'romantic character', bold:'bold character', cozy:'warm character' };
    const styles = answers.style || [];
    const category = answers.category;
    const allowedGenders = genderMap[answers.gender] || genderMap.any;

    const eligible = PRODUCTS
      .filter(p => !category || category === 'any' || p.category === category)
      .filter(p => !answers.gender || allowedGenders.includes(p.gender));
    const withinBudget = answers.budget
      ? eligible.filter(p => p.sizes.some(s => priceInRange(s.price, answers.budget)))
      : eligible;
    /* Keep budget strict when the catalog can support a useful shortlist;
       otherwise gracefully show the nearest eligible category/profile matches. */
    const candidates = withinBudget.length >= 4 ? withinBudget : eligible;

    const scored = candidates
      .map(p => {
        let score = 0;
        const reasons = [];
        /* Occasion */
        if (answers.when === 'day' && p.scents.some(s => dayScents.includes(s))) { score += 3; reasons.push('daytime-ready'); }
        if (answers.when === 'evening' && p.scents.some(s => nightScents.includes(s))) { score += 3; reasons.push('evening depth'); }
        if (answers.when === 'any') { score += 2; reasons.push('versatile wear'); }
        /* Scent families — every matching family the user picked adds signal */
        const familyMatches = p.scents.filter(s => styles.includes(s));
        score += familyMatches.length * 5;
        if (familyMatches.length) reasons.push(`${familyMatches.slice(0, 2).join(' + ')} profile`);
        /* Desired impression */
        const impressionMatch = p.scents.some(s => impressionMap[answers.impression]?.includes(s));
        if (impressionMatch) { score += 4; reasons.push(impressionLabels[answers.impression]); }
        /* Hard constraints already guarantee budget and profile suitability. */
        if (answers.budget && p.sizes.some(s => priceInRange(s.price, answers.budget))) {
          score += 3;
          reasons.push('within budget');
        }
        if (answers.gender) score += p.gender === 'unisex' ? 1 : 3;
        /* Rating nudge */
        score += Math.max(0, (p.rating - 4.3) * 3);
        if (p.rating >= 4.8) reasons.push('community favorite');
        /* Signed-in taste profile, if one exists */
        if (acctPrefs) {
          if (acctPrefs.brands?.includes(p.brand)) { score += 3; reasons.push('saved brand'); }
          score += (p.scents.filter(s => acctPrefs.scents?.includes(s)).length) * 2;
          if (acctPrefs.genders?.includes(p.gender)) score += 2;
        }
        return { p, score, reasons };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating);

    const topScore = scored[0]?.score || 1;
    const explained = scored.map(({ p, score, reasons }) => ({
      ...p,
      _aiMatch: {
        confidence: Math.max(72, Math.min(97, Math.round(72 + (score / topScore) * 25))),
        reasons: [...new Set(reasons)].slice(0, 3)
      }
    }));

    return diversify(explained, RESULTS_COUNT, MAX_PER_BRAND);
  }

  retakeBtn?.addEventListener('click', () => {
    step = 0;
    Object.keys(answers).forEach(k => delete answers[k]);
    quiz.querySelectorAll('.ai-option').forEach(o => o.classList.remove('selected'));
    quiz.querySelectorAll('.ai-panel-continue').forEach(b => b.disabled = true);
    if (innerEl) innerEl.classList.remove('ai-finder-inner-wide');
    quiz.hidden   = true;
    header.hidden = false;
    header.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
    setTimeout(() => startBtn.focus({ preventScroll:true }), 450);
  });
})();

/* ── BRAND TILE → FILTER ─────────────────────────────── */
(function initBrandTiles() {
  document.querySelectorAll('.brand-tile[data-filter-brand]').forEach(tile => {
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      const key = tile.dataset.filterBrand;

      /* clear all brand checkboxes, then check the right one */
      document.querySelectorAll('input[name="brand"]').forEach(cb => { cb.checked = false; });
      const target = document.querySelector(`input[name="brand"][value="${key}"]`);
      if (target) {
        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }

      /* expand the shop section if it was collapsed */
      const body = document.getElementById('shopBrowseBody');
      const btn  = document.getElementById('shopCollapseBtn');
      if (body?.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        btn?.classList.remove('collapsed');
        btn?.setAttribute('aria-expanded', 'true');
        const label = btn?.querySelector('span');
        if (label) label.textContent = 'Collapse';
      }

      /* scroll to the shop section */
      document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();

/* ── SHOP BROWSE COLLAPSE ────────────────────────────── */
(function initShopCollapse() {
  const btn  = document.getElementById('shopCollapseBtn');
  const body = document.getElementById('shopBrowseBody');
  if (!btn || !body) return;

  btn.addEventListener('click', () => {
    const collapsed = body.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', !collapsed);
    btn.querySelector('span').textContent = collapsed ? 'Expand' : 'Collapse';
  });
})();

/* ── SEARCH ───────────────────────────────────────────
   Live predictive search over PRODUCTS: filters results
   as you type (name, brand, notes, scent profile), with
   popular-term shortcuts and keyboard navigation. Picking
   a result scrolls to it in the Shop grid and highlights it. */
(function initSearch() {
  const searchBtns   = [document.getElementById('searchBtn'), document.getElementById('searchBtnMobile')].filter(Boolean);
  const overlay      = document.getElementById('searchOverlay');
  const panel        = document.getElementById('searchPanel');
  const closeBtn     = document.getElementById('searchClose');
  const form         = document.getElementById('searchForm');
  const input        = document.getElementById('searchInput');
  const clearBtn     = document.getElementById('searchClear');
  const popularEl    = document.getElementById('searchPopular');
  const trendingList = document.getElementById('searchTrendingList');
  const resultsEl    = document.getElementById('searchResults');
  const resultsList  = document.getElementById('searchResultsList');
  const resultsLabel = document.getElementById('searchResultsLabel');
  const viewAllBtn   = document.getElementById('searchViewAll');
  const emptyEl      = document.getElementById('searchEmpty');
  const emptyTermEl  = document.getElementById('searchEmptyTerm');
  const chips        = document.querySelectorAll('.search-chip');
  if (!panel || typeof PRODUCTS === 'undefined') return;

  const MAX_RESULTS = 6;
  let matches = [];
  let activeIndex = -1;
  let debounceTimer = null;

  function openSearch() {
    panel.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => input.focus(), 200);
    if (!input.value.trim()) renderTrending();
  }

  function closeSearch() {
    panel.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  searchBtns.forEach((btn) => btn.addEventListener('click', openSearch));
  closeBtn.addEventListener('click', closeSearch);
  overlay.addEventListener('click', closeSearch);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) closeSearch(); });
  form.addEventListener('submit', (e) => e.preventDefault());

  function matchScore(product, term) {
    const name   = product.name.toLowerCase();
    const brand  = product.brand.toLowerCase();
    const notes  = product.notes.join(' ').toLowerCase();
    const scents = product.scents.join(' ').toLowerCase();
    if (name.startsWith(term))  return 0;
    if (name.includes(term))    return 1;
    if (brand.includes(term))   return 2;
    if (notes.includes(term))   return 3;
    if (scents.includes(term))  return 4;
    return -1;
  }

  function highlight(text, term) {
    if (!term) return text;
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i === -1) return text;
    return `${text.slice(0, i)}<mark>${text.slice(i, i + term.length)}</mark>${text.slice(i + term.length)}`;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderResult(p, term) {
    const price = p.sizes[0]?.price ?? p.price;
    return `
      <a class="search-result-item" data-id="${p.id}" href="product.html?id=${encodeURIComponent(p.id)}" aria-label="View ${p.name} by ${p.brand}">
        <span class="search-result-img">
          ${p.img ? `<img src="${p.img}" alt="" loading="lazy">` : ''}
        </span>
        <span class="search-result-info">
          <span class="search-result-brand">${p.brand}</span>
          <span class="search-result-name">${highlight(p.name, term)}</span>
        </span>
        <span class="search-result-price">$${price}</span>
      </a>`;
  }

  function renderTrending() {
    if (!trendingList) return;
    const featured = PRODUCTS.filter((p) => p.badgeText === 'New');
    const pool = shuffle(featured.length >= 4 ? featured : PRODUCTS).slice(0, 4);
    trendingList.innerHTML = pool.map((p) => renderResult(p, '')).join('');
  }

  function setActive(index) {
    const items = resultsList.querySelectorAll('.search-result-item');
    items.forEach((el) => el.classList.remove('kbd-active'));
    if (index >= 0 && items[index]) {
      items[index].classList.add('kbd-active');
      items[index].scrollIntoView({ block: 'nearest' });
    }
    activeIndex = index;
  }

  function runSearch(rawTerm) {
    const term = rawTerm.trim().toLowerCase();
    clearBtn.hidden = term.length === 0;
    activeIndex = -1;

    if (!term) {
      popularEl.hidden = false;
      resultsEl.hidden = true;
      emptyEl.hidden = true;
      matches = [];
      renderTrending();
      return;
    }

    matches = PRODUCTS
      .map((p) => ({ p, score: matchScore(p, term) }))
      .filter((m) => m.score !== -1)
      .sort((a, b) => a.score - b.score)
      .map((m) => m.p);

    popularEl.hidden = true;

    if (matches.length === 0) {
      resultsEl.hidden = true;
      emptyEl.hidden = false;
      emptyTermEl.textContent = rawTerm.trim();
      return;
    }

    emptyEl.hidden = true;
    resultsEl.hidden = false;
    resultsLabel.textContent = `${matches.length} Result${matches.length !== 1 ? 's' : ''}`;
    resultsList.innerHTML = matches.slice(0, MAX_RESULTS).map((p) => renderResult(p, rawTerm.trim())).join('');
    viewAllBtn.hidden = matches.length <= MAX_RESULTS ? true : false;
    viewAllBtn.textContent = `View all ${matches.length} results in Shop`;

  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = input.value;
    debounceTimer = setTimeout(() => runSearch(val), 140);
  });

  input.addEventListener('keydown', (e) => {
    const items = resultsList.querySelectorAll('.search-result-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].click();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    runSearch('');
    input.focus();
  });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.term;
      runSearch(input.value);
      input.focus();
    });
  });

  viewAllBtn.addEventListener('click', () => {
    closeSearch();
    document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();

/* ── PRODUCT PAGE LINKS ────────────────────────────────
   renderProductCard() already wraps its image/name in real
   <a href="product.html?id=…"> links. Statically-authored cards
   (New Arrivals) don't go through that function, so wrap their
   image and name here too — every fragrance card ends up with
   a genuine hyperlink to its product page either way. */
document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
  img.decoding = 'async';
  img.fetchPriority = 'low';
});

(function wireStaticProductLinks() {
  document.querySelectorAll('.product-card[data-id]').forEach((card) => {
    if (card.querySelector('.product-link-img')) return; /* already a real card from renderProductCard */
    const id   = card.dataset.id;
    const name = card.dataset.name || card.querySelector('.product-name')?.textContent.trim() || '';
    const href = `product.html?id=${id}`;

    const imageTarget = card.querySelector('.product-image > .product-img-wrap, .product-image > .product-bottle');
    if (imageTarget) {
      const a = document.createElement('a');
      a.className = 'product-link-img';
      a.href = href;
      a.setAttribute('aria-label', `View ${name} details`);
      imageTarget.replaceWith(a);
      a.appendChild(imageTarget);
    }

    const nameEl = card.querySelector('.product-name');
    if (nameEl && !nameEl.querySelector('.product-link-name')) {
      const a = document.createElement('a');
      a.className = 'product-link-name';
      a.href = href;
      a.textContent = nameEl.textContent.trim();
      nameEl.textContent = '';
      nameEl.appendChild(a);
    }
  });
})();

/* ── NEW ARRIVALS: gender filter, sort, see more ─────── */
(function initNewArrivalsControls() {
  const grid       = document.getElementById('newArrivalsGrid');
  const seeMoreBtn = document.getElementById('newArrivalsSeeMore');
  const filterBtns = document.querySelectorAll('#newArrivalsFilters .gender-pill');
  const sortSelect = document.getElementById('newArrivalsSort');
  if (!grid) return;

  /* Use the same shared card renderer as Best Sellers so both sections stay
     structurally and visually identical as the catalog evolves. */
  if (typeof PRODUCTS !== 'undefined' && typeof renderProductCard === 'function') {
    const arrivals = PRODUCTS.filter((product) => product.badgeText === 'New');
    if (arrivals.length) {
      grid.innerHTML = arrivals.map((product) => renderProductCard(product)).join('');
      grid.querySelectorAll('.reveal').forEach((element) => element.classList.add('visible'));
      grid.querySelectorAll('.product-wish').forEach((button) => {
        button.addEventListener('click', () => {
          const active = button.classList.toggle('wished');
          const path = button.querySelector('svg path');
          if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
          button.style.color = active ? 'var(--gold)' : '';
          button.style.borderColor = active ? 'var(--gold)' : '';
          button.setAttribute('aria-pressed', active);
        });
      });
    }
  }

  const INITIAL_VISIBLE = 12;
  const cards = Array.from(grid.querySelectorAll('.product-card'));
  cards.forEach((card, i) => { card.dataset.order = i; });

  let currentGender = 'all';
  let currentSort   = 'featured';
  let showAll       = false;

  function apply() {
    let matching = cards.filter((c) => currentGender === 'all' || c.dataset.gender === currentGender);

    matching = matching.slice().sort((a, b) => currentSort === 'newest'
      ? parseInt(b.dataset.id, 10) - parseInt(a.dataset.id, 10)
      : parseInt(a.dataset.order, 10) - parseInt(b.dataset.order, 10));

    const limit = showAll ? matching.length : INITIAL_VISIBLE;

    cards.forEach((card) => {
      const idx = matching.indexOf(card);
      if (idx === -1 || idx >= limit) {
        card.classList.add('na-hidden');
      } else {
        card.classList.remove('na-hidden');
        card.style.order = idx;
      }
    });

    if (seeMoreBtn) seeMoreBtn.hidden = showAll || matching.length <= INITIAL_VISIBLE;
    grid.dispatchEvent(new CustomEvent('coverflow:refresh'));
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('gender-pill-active'));
      btn.classList.add('gender-pill-active');
      currentGender = btn.dataset.filterGender;
      showAll = false;
      apply();
    });
  });

  sortSelect?.addEventListener('change', () => {
    currentSort = sortSelect.value;
    showAll = false;
    apply();
  });

  seeMoreBtn?.addEventListener('click', () => {
    showAll = true;
    apply();
  });

  apply();
})();

/* ── SHARED 3D COVERFLOW ─────────────────────────────── */
(function initProductCoverflows() {
  function setup(track, prev, next, dots) {
    if (!track) return;
    const useAlignedSideCards = track.id === 'newArrivalsGrid';
    let cards = [];
    let position = 0;
    let target = 0;
    let cardWidth = 300;
    let raf = 0;
    let drag = null;
    let suppressClick = false;

    const indexAt = (value) => cards.length ? ((Math.round(value) % cards.length) + cards.length) % cards.length : 0;

    function paint() {
      if (!cards.length) return;
      const pitch = cardWidth * .68;
      cards.forEach((card, index) => {
        let offset = index - position;
        offset = ((offset % cards.length) + cards.length) % cards.length;
        if (offset > cards.length / 2) offset -= cards.length;
        const distance = Math.abs(offset);
        const ramp = Math.pow(distance, .58);
        const tilt = Math.min(46 * ramp, 78) * Math.sign(offset);
        if (useAlignedSideCards) {
          const scale = Math.max(.82, 1 - distance * .08);
          card.style.transformOrigin = 'center top';
          card.style.transform = `translateX(calc(-50% + ${offset * pitch}px)) translateZ(${-cardWidth * .3 * ramp}px) scale(${scale})`;
        } else {
          card.style.transformOrigin = '';
          card.style.transform = `translateX(calc(-50% + ${offset * pitch}px)) translateZ(${-cardWidth * .56 * ramp}px) rotateY(${-tilt}deg)`;
        }
        card.style.opacity = String(distance > 4 ? 0 : Math.max(.12, 1 - distance * .16));
        card.style.zIndex = String(100 - Math.round(distance * 10));
        card.style.visibility = distance > 4 ? 'hidden' : 'visible';
        const active = distance < .5;
        card.classList.toggle('coverflow-active', active);
        card.inert = !active;
        card.setAttribute('role', 'group');
        card.setAttribute('aria-roledescription', 'slide');
        card.setAttribute('aria-hidden', active ? 'false' : 'true');
        card.setAttribute('aria-label', `${index + 1} of ${cards.length}`);
      });
      const selected = indexAt(position);
      dots?.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        const active = index === selected;
        dot.classList.toggle('active', active);
        dot.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }

    function settle(destination) {
      cancelAnimationFrame(raf);
      target = destination;
      const step = () => {
        const remaining = target - position;
        if (Math.abs(remaining) < .0005) { position = target; paint(); return; }
        position += remaining * .16;
        paint();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function nudge(by) { if (cards.length) settle(Math.round(target) + by); }

    function renderDots() {
      if (!dots) return;
      dots.innerHTML = cards.map((_, index) => `<button class="carousel-dot" type="button" aria-label="Show slide ${index + 1}"></button>`).join('');
      dots.querySelectorAll('.carousel-dot').forEach((dot, index) => dot.addEventListener('click', () => {
        const current = indexAt(target);
        let delta = index - current;
        if (delta > cards.length / 2) delta -= cards.length;
        if (delta < -cards.length / 2) delta += cards.length;
        settle(Math.round(target) + delta);
      }));
    }

    function refresh() {
      cards = Array.from(track.querySelectorAll(':scope > .product-card:not(.na-hidden)'))
        .sort((a, b) => (parseInt(a.style.order || a.dataset.order || 0, 10) - parseInt(b.style.order || b.dataset.order || 0, 10)));
      track.querySelectorAll(':scope > .product-card.na-hidden').forEach(card => { card.inert = true; card.setAttribute('aria-hidden', 'true'); });
      position = target = 0;
      cardWidth = cards[0]?.offsetWidth || 300;
      renderDots();
      paint();
    }

    prev?.addEventListener('click', () => nudge(-1));
    next?.addEventListener('click', () => nudge(1));
    track.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); nudge(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    track.addEventListener('pointerdown', (event) => {
      if (event.target.closest('a,button,input,select')) return;
      cancelAnimationFrame(raf);
      track.setPointerCapture(event.pointerId);
      drag = { id:event.pointerId, x:event.clientX, start:position, last:position, time:performance.now(), velocity:0 };
      suppressClick = false;
      track.classList.add('is-dragging');
    });
    track.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const now = performance.now();
      const nextPosition = drag.start - (event.clientX - drag.x) / (cardWidth * .68);
      drag.velocity = ((nextPosition - drag.last) / Math.max(now - drag.time, 1)) * 1000;
      drag.last = position = nextPosition;
      drag.time = now;
      suppressClick ||= Math.abs(event.clientX - drag.x) > 6;
      paint();
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const carried = Math.max(-2, Math.min(2, drag.velocity * .16));
      drag = null;
      track.classList.remove('is-dragging');
      settle(Math.round(position + carried));
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('click', (event) => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } }, true);
    track.addEventListener('coverflow:refresh', refresh);
    new ResizeObserver(() => { cardWidth = cards[0]?.offsetWidth || cardWidth; paint(); }).observe(track);
    refresh();
  }

  setup(document.getElementById('newArrivalsGrid'), document.getElementById('newArrivalsPrev'), document.getElementById('newArrivalsNext'), document.getElementById('newArrivalsDots'));
  setup(document.getElementById('productsGrid'), document.getElementById('bestPrev'), document.getElementById('bestNext'), document.getElementById('bestDots'));
})();

/* ── CROSS-PAGE ANCHOR LANDING ───────────────────────── *
   A link like product.html's "Collections" nav item arrives here as a plain
   index.html#hash URL. The browser's own scroll-to-fragment runs before the
   shop grid renders or any content-visibility section unskips, so it lands
   short exactly like an in-page click once did. Redo it with scrollToTarget
   now that the page's own init above has run. */
if (location.hash && location.hash !== '#') {
  const hashTarget = document.querySelector(location.hash);
  if (hashTarget) scrollToTarget(hashTarget);
}
