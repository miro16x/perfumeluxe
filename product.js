/* ── PRODUCT DETAIL PAGE ───────────────────────────────
   Renders whichever product product.html?id=<id> points to,
   using the shared PRODUCTS catalogue and the site chrome
   (nav/cart/search) already wired up by app.js. */
(function initPDP() {
  const root = document.getElementById('pdpRoot');
  if (!root || typeof PRODUCTS === 'undefined') return;

  const notFoundEl = document.getElementById('pdpNotFound');
  const relatedEl  = document.getElementById('pdpRelated');

  const id      = parseInt(new URLSearchParams(window.location.search).get('id'), 10);
  const product = PRODUCTS.find((p) => p.id === id);

  if (!product) {
    root.hidden     = true;
    relatedEl.hidden = true;
    notFoundEl.hidden = false;
    const crumb = document.querySelector('.pdp-breadcrumb');
    if (crumb) crumb.hidden = true;
    return;
  }

  /* ── page metadata ── */
  document.title = `${product.name} | ${product.brand} — Luxe Perfume`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', product.desc);

  /* ── breadcrumb ── */
  document.getElementById('pdpBrandCrumb').textContent = product.name;

  /* ── gallery ── */
  const mainImg  = document.getElementById('pdpMainImg');
  const thumbsEl = document.getElementById('pdpThumbs');
  const images   = [product.img, product.imgHover].filter(Boolean);

  if (images.length) {
    mainImg.src = images[0];
    mainImg.alt = product.name;
  }
  if (images.length > 1) {
    thumbsEl.innerHTML = images.map((src, i) => `
      <button type="button" class="pdp-thumb${i === 0 ? ' active' : ''}" data-src="${src}" aria-label="View image ${i + 1} of ${product.name}">
        <img src="${src}" alt="" loading="lazy">
      </button>`).join('');
    thumbsEl.querySelectorAll('.pdp-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        mainImg.src = btn.dataset.src;
        thumbsEl.querySelectorAll('.pdp-thumb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  /* ── badge ── */
  const badgeEl = document.getElementById('pdpBadge');
  if (product.badgeText) {
    badgeEl.textContent = product.badgeText;
    badgeEl.className = `product-badge pdp-badge ${product.badgeClass}`;
    badgeEl.hidden = false;
  }

  /* ── core info ── */
  const brandLink = document.getElementById('pdpBrand');
  brandLink.textContent = product.brand;
  brandLink.href = `index.html?brand=${encodeURIComponent(product.brandKey)}#shop`;
  brandLink.setAttribute('aria-label', `View the complete ${product.brand} catalog`);
  document.getElementById('pdpName').textContent = product.name;

  const stars = '★'.repeat(Math.floor(product.rating)) + (product.rating % 1 ? '½' : '');
  document.getElementById('pdpRating').innerHTML = `
    <span aria-hidden="true">${stars}</span>
    <strong>${product.rating.toFixed(1)}</strong>
    <em>(${product.reviews} reviews)</em>`;

  document.getElementById('pdpNotes').innerHTML = product.notes.map((n) => `<span>${n}</span>`).join('');
  document.getElementById('pdpDesc').textContent = product.desc;
  document.getElementById('pdpReview').textContent = `"${product.review}"`;

  /* ── sizes + price ── */
  const sizesEl = document.getElementById('pdpSizes');
  const priceEl = document.getElementById('pdpPrice');
  sizesEl.innerHTML = `
    <span class="pdp-sizes-label">Size</span>
    <div class="product-sizes">
      ${product.sizes.map((s, i) => `<button type="button" class="size-btn${i === 0 ? ' size-btn-active' : ''}" data-size="${s.size}" data-price="${s.price}">${formatSizeLabel(s.size)}</button>`).join('')}
    </div>`;
  priceEl.textContent = `$${product.sizes[0].price}`;
  sizesEl.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sizesEl.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('size-btn-active'));
      btn.classList.add('size-btn-active');
      priceEl.textContent = `$${btn.dataset.price}`;
    });
  });

  /* ── add to cart ── */
  document.getElementById('pdpAddToCart').addEventListener('click', function () {
    const active = sizesEl.querySelector('.size-btn-active');
    const size   = active?.dataset.size || '';
    const price  = parseFloat(active?.dataset.price || product.sizes[0].price);
    addToCart(product.id, size ? `${product.name} · ${size}` : product.name, price, this);
  });

  /* ── wishlist toggle ── */
  const wishBtn = document.getElementById('pdpWish');
  wishBtn.addEventListener('click', () => {
    const active = wishBtn.classList.toggle('wished');
    wishBtn.setAttribute('aria-pressed', active);
  });

  root.hidden = false;

  /* ── related products: same brand first, same scent family as fallback ── */
  let related = PRODUCTS.filter((p) => p.brandKey === product.brandKey && p.id !== product.id);
  if (related.length < 4) {
    const seen = new Set(related.map((p) => p.id));
    const more = PRODUCTS.filter((p) => p.id !== product.id && !seen.has(p.id) && p.scents.some((s) => product.scents.includes(s)));
    related = related.concat(more);
  }
  related = related.slice(0, 4);

  if (related.length) {
    const grid = document.getElementById('pdpRelatedGrid');
    grid.innerHTML = related.map((p) => renderProductCard(p)).join('');
    grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
    grid.querySelectorAll('.product-wish').forEach((btn) => {
      btn.addEventListener('click', () => {
        const active = btn.classList.toggle('wished');
        const path = btn.querySelector('svg path');
        if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
        btn.style.color = active ? 'var(--gold)' : '';
        btn.style.borderColor = active ? 'var(--gold)' : '';
        btn.setAttribute('aria-pressed', active);
      });
    });
    document.getElementById('pdpRelatedBrand').textContent = product.brand;
    relatedEl.hidden = false;
  }
})();
