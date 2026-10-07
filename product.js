/* ── PRODUCT DETAIL PAGE ───────────────────────────────
   Renders whichever product product.html?id=<id> points to,
   using the shared PRODUCTS catalogue and the site chrome
   (nav/cart/search) already wired up by app.js. */
// Match named fragrance lines, rather than treating a whole brand as a collection.
// More specific lines precede their parent names (for example, Coco Mademoiselle).
const FRAGRANCE_LINES = {
  dior: [/^Miss Dior\b/i, /^J'adore\b/i, /^Dior Addict\b/i, /\bPoison\b/i, /^Sauvage\b/i, /^Dior Homme\b/i],
  chanel: [/^N°5\b/i, /^Coco Mademoiselle\b/i, /^Coco\b/i, /^Chance\b/i, /^Gabrielle\b/i, /^Allure\b/i, /^Cristalle\b/i, /^Bleu de Chanel\b/i, /Égoïste$/i],
  ysl: [/^Libre\b/i, /^Black Opium\b/i, /^Mon Paris\b/i, /^Y\b/i, /^MYSLF\b/i, /^La Nuit de L'Homme\b/i, /^L'Homme\b/i],
  givenchy: [/^L'Interdit\b/i, /^Irresistible\b/i, /^Very Irrésistible\b/i, /^Gentleman Society\b/i, /^Gentleman\b/i],
  hermes: [/^Twilly\b/i, /^Barénia\b/i, /\bdes Merveilles\b/i, /^Terre d'Hermès\b/i, /^H24\b/i, /^Un Jardin\b/i],
  bvlgari: [/^Omnia\b/i, /^Splendida\b/i, /^Rose Goldea\b/i, /^Man\b/i, /^Pour Homme\b/i],
  guerlain: [/^Mon Guerlain\b/i, /^Aqua Allegoria\b/i],
  cartier: [/^La Panthère\b/i, /^Déclaration\b/i, /^Pasha de Cartier\b/i],
  'narciso-rodriguez': [/^All Of Me\b/i, /\bFor Her\b/i, /^Narciso\b/i, /^For Him\b/i],
  'issey-miyake': [/^L'Eau d'Issey\b/i, /^A Drop d'Issey\b/i, /^Fusion d'Issey\b/i, /^Le Sel d'Issey\b/i],
  'dolce-gabbana': [/^Q by\b/i, /\bDevotion\b/i, /^Dolce\b/i, /^The Only One\b/i, /^The One\b/i, /^Light Blue\b/i, /^K by\b/i],
  versace: [/^Bright Crystal\b/i, /^Crystal Noir\b/i, /^Yellow Diamond\b/i, /^Dylan\b/i, /^Eros\b/i, /^Man Eau Fraîche\b/i],
  moschino: [/^Toy 2\b/i, /^Toy Boy\b/i],
  coach: [/^Coach Dreams\b/i, /^Coach Floral\b/i, /^Coach for Men\b/i],
  'kate-spade': [/^Kate Spade New York Chérie\b/i, /^Kate Spade New York\b/i],
  montblanc: [/^Signature\b/i, /^Explorer\b/i, /^Legend\b/i],
  'jimmy-choo': [/^I Want Choo\b/i, /\bUrban Hero\b/i, /^Jimmy Choo Man\b/i, /^Jimmy Choo\b/i],
  'tory-burch': [/^Sublime\b/i],
  rabanne: [/^Million Gold\b/i, /^1 Million\b/i, /^Fame\b/i, /^Olympéa\b/i, /^Phantom\b/i, /^Invictus\b/i],
  'carolina-herrera': [/^La Bomba\b/i, /\bGood Girl\b/i, /^Bad Boy\b/i, /^212 VIP\b/i, /^212 Heroes\b/i, /^212 (?:Men )?NYC\b/i, /^212 (?:Men )?Sexy\b/i],
  'jean-paul-gaultier': [/^Gaultier Divine\b/i, /^Scandal\b/i, /^La Belle\b/i, /^Le Male\b/i, /^Le Beau\b/i],
  armani: [/^My Way\b/i, /^Sí(?:\s|$)/i, /\bdi Gioia\b/i, /^Acqua di Giò(?:\s|$)/i, /^Armani Code\b/i, /^Emporio Armani Stronger With You\b/i],
  'ralph-lauren': [/^Romance\b/i, /^Ralph's Club\b/i, /^Ralph\b/i, /^Polo 67\b/i, /^Polo Blue\b/i, /^Polo Red\b/i, /^Polo Sport\b/i],
  lancome: [/^La Vie Est Belle\b/i, /^Idôle\b/i, /^Trésor\b/i],
  gucci: [/^Flora\b/i, /^Bloom\b/i, /^Guilty\b/i],
  burberry: [/^Goddess\b/i, /^Her\b/i, /^My Burberry\b/i, /^Burberry Brit\b/i, /^Hero\b/i],
  'tiffany-co': [/^Tiffany Rose Gold\b/i],
  'marc-jacobs': [/^Perfect\b/i, /^Daisy\b/i],
  chloe: [/^Chloé Love Story\b/i, /^Chloé\b/i],
  valentino: [/^Donna Born in Roma\b/i, /^Uomo Born in Roma\b/i, /^Voce Viva\b/i],
  prada: [/^Paradoxe\b/i, /^Candy\b/i, /^Infusion\b/i, /^Paradigme\b/i, /^Luna Rossa\b/i],
  mugler: [/^Angel\b/i, /^Alien\b/i],
  'viktor-rolf': [/^Flowerbomb\b/i, /^Spicebomb\b/i],
  azzaro: [/\bWanted\b/i],
  'miu-miu': [/^Miutine\b/i],
  'hugo-boss': [/^BOSS Bottled\b/i, /^BOSS The Scent\b/i],
  ck: [/\bEuphoria\b/i, /^Eternity\b/i, /^CK One Shock\b/i],
  lacoste: [/^L\.12\.12\b/i, /^Lacoste Original\b/i, /^Match Point\b/i],
  'michael-kors': [/^Michael Kors Pour Femme\b/i, /^Michael Kors Pour Homme\b/i],
  'salvatore-ferragamo': [/^Fiamma\b/i, /^Signorina\b/i, /^Ferragamo\b/i, /^Uomo\b/i],
  kenzo: [/\bFlower by Kenzo\b/i, /^Kenzo Homme\b/i],
  guess: [/\bBella Vita\b/i, /^Iconic\b/i],
  'oscar-de-la-renta': [/^Alibi\b/i, /^Bella\b/i],
  'karl-lagerfeld': [/^Karl Ikonik\b/i],
  'ariana-grande': [/^Cloud\b/i, /^Mod\b/i],
  'billie-eilish': [/^Eilish\b/i],
  'sabrina-carpenter': [/^Sweet Tooth\b/i],
  lattafa: [/^Yara\b/i, /^Asad\b/i, /^Khamrah\b/i, /^Bade'e Al Oud\b/i],
  alharamain: [/^Amber Oud\b/i],
  afnan: [/^9 PM\b/i, /^9 AM\b/i, /^Supremacy\b/i],
  armaf: [/^Club de Nuit\b/i, /^Odyssey\b/i],
  'bond-no-9': [/^The Scent of Peace\b/i],
  'elizabeth-taylor': [/^White Diamonds\b/i],
  'paris-hilton': [/\bRush\b/i],
  shakira: [/^Dance\b/i],
  'antonio-banderas': [/^The Icon\b/i]
};

function getFragranceLine(product) {
  const line = FRAGRANCE_LINES[product.brandKey]?.findIndex((pattern) => pattern.test(product.name));
  // Unlisted lines only match their exact name, allowing concentration variants.
  const name = product.name.replace(/\s+(?:Eau de (?:Parfum|Toilette|Cologne)|Parfum)$/i, '').toLowerCase();
  return `${product.brandKey}:${product.gender}:${line >= 0 ? `line-${line}` : name}`;
}

function getRelatedFragrances(product, catalogue) {
  const line = getFragranceLine(product);
  const variants = catalogue.filter((candidate) => candidate.id !== product.id
    && candidate.category === product.category
    && getFragranceLine(candidate) === line);
  const seen = new Set([product.id, ...variants.map((candidate) => candidate.id)]);
  const brandAlternatives = catalogue.filter((candidate) => candidate.brandKey === product.brandKey
    && !seen.has(candidate.id));
  // Prefer the same product type and audience when filling remaining cards.
  const relevance = (candidate) => Number(candidate.category === product.category) * 2
    + Number(candidate.gender === product.gender);
  brandAlternatives.sort((a, b) => relevance(b) - relevance(a));
  return variants.concat(brandAlternatives).slice(0, 4);
}

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
  brandLink.href = `shop.html?brand=${encodeURIComponent(product.brandKey)}`;
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
    addToCart(product.id, size ? `${product.name} · ${size}` : product.name, price, this, size);
  });

  /* ── wishlist toggle ── */
  const wishBtn = document.getElementById('pdpWish');
  wishBtn.addEventListener('click', () => {
    const active = wishBtn.classList.toggle('wished');
    wishBtn.setAttribute('aria-pressed', active);
  });

  root.hidden = false;

  /* ── related products: same line first, then other products from the brand ── */
  const related = getRelatedFragrances(product, PRODUCTS);
  relatedEl.hidden = true;

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
