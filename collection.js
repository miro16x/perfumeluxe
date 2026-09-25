(function initCollectionPage() {
  if (typeof PRODUCTS === 'undefined' || typeof renderProductCard !== 'function') return;

  const womensCollections = {
    dior: /^(Miss Dior|J'adore)\b/i,
    chanel: /^(Coco|Chance)\b/i,
    'carolina-herrera': /\bgood girl\b/i,
    valentino: /\bborn in roma\b/i,
    prada: /^Paradoxe\b/i,
    ysl: /^Libre\b/i,
    'marc-jacobs': /^Perfect\b/i,
    burberry: /^Her\b/i
  };

  const mensCollections = {
    dior: /^(Sauvage|Dior Homme)\b/i,
    chanel: /^Bleu de Chanel\b/i,
    ysl: /^MYSLF\b/i,
    versace: /^Eros\b/i,
    rabanne: /^(1 Million|Million Gold|Invictus)\b/i,
    'jean-paul-gaultier': /^Le Male\b/i,
    valentino: /^Uomo Born in Roma\b/i,
    prada: /^Paradigme\b/i,
    'hugo-boss': /^BOSS Bottled\b/i
  };

  const definitions = {
    men: {
      eyebrow: 'For Him', title: "Men's <em>Fragrances</em>",
      description: 'Bold woods, crisp citrus, aromatic freshness, and refined evening signatures.',
      match: (p) => p.category === 'fragrance' && p.gender === 'men'
        && mensCollections[p.brandKey]?.test(p.name)
    },
    women: {
      eyebrow: 'For Her', title: "Women's <em>Fragrances</em>",
      description: 'Radiant florals, velvet musks, luminous gourmands, and modern icons.',
      match: (p) => p.category === 'fragrance' && p.gender === 'women'
        && womensCollections[p.brandKey]?.test(p.name)
    },
    unisex: {
      eyebrow: 'Without Boundaries', title: 'Unisex <em>Fragrances</em>',
      description: 'Balanced blends selected for every mood, season, identity, and skin.',
      match: (p) => p.category === 'fragrance' && p.gender === 'unisex'
    },
    'niche-luxury': {
      eyebrow: 'Rare & Exceptional', title: 'Niche & Luxury <em>Perfumes</em>',
      description: 'Discover Bond No. 9 fragrances inspired by the energy, artistry, and neighborhoods of New York City.',
      match: (p) => p.brandKey === 'bond-no-9'
    },
    gifts: {
      eyebrow: 'The Art of Giving', title: 'Gift <em>Sets</em>',
      description: 'Gift-ready Sol de Janeiro rituals featuring fragrance mist, body care, and shower essentials.',
      match: (p) => p.id !== 830 && p.brandKey === 'sol-de-janeiro' && /set/i.test(p.name)
    },
    'new-arrivals': {
      eyebrow: 'Just Landed', title: 'New <em>Arrivals</em>',
      description: 'Freshly composed and ready to wear — the latest releases in the collection.',
      match: (p) => p.badgeText === 'New'
    },
    seasonal: {
      eyebrow: 'The Seasonal Edit', title: 'Seasonal <em>Collections</em>',
      description: 'Limited-edition fragrances available for a fleeting moment.',
      match: (p) => p.badgeText === 'Limited Edition'
    }
  };

  const key = new URLSearchParams(location.search).get('collection') || 'men';
  const collection = definitions[key] || definitions.men;
  const products = PRODUCTS.filter(collection.match);
  document.title = `${collection.title.replace(/<[^>]+>/g, '')} | Luxe Perfume`;
  document.getElementById('collectionEyebrow').textContent = collection.eyebrow;
  document.getElementById('collectionTitle').innerHTML = collection.title;
  document.getElementById('collectionDescription').textContent = collection.description;
  document.getElementById('collectionCrumb').textContent = collection.title.replace(/<[^>]+>/g, '');
  const grid = document.getElementById('collectionProductGrid');
  const count = document.getElementById('collectionCount');
  const empty = document.getElementById('collectionEmpty');
  const filtersEl = document.getElementById('collectionFilters');
  const sortSelect = document.getElementById('collectionSort');
  const showAll = key === 'men' || key === 'women' || key === 'new-arrivals';

  /* Single-gender collections filter by badge instead of gender, and drop the
     "Newest Launched" sort since the Newest pill covers it. */
  const isGenderCollection = key === 'men' || key === 'women' || key === 'unisex';
  const filters = isGenderCollection
    ? {
        all: { label: 'All', match: () => true },
        'best-sellers': { label: 'Best Sellers', match: (p) => p.badgeText === 'Best Seller' },
        newest: { label: 'Newest', match: (p) => p.badgeText === 'New' }
      }
    : {
        all: { label: 'All', match: () => true },
        women: { label: 'Women', match: (p) => p.gender === 'women' },
        men: { label: 'Men', match: (p) => p.gender === 'men' },
        unisex: { label: 'Unisex', match: (p) => p.gender === 'unisex' }
      };

  if (key === 'unisex') delete filters['best-sellers'];

  filtersEl.setAttribute('aria-label', isGenderCollection ? 'Filter fragrances' : 'Filter by gender');
  filtersEl.innerHTML = Object.entries(filters).map(([value, { label }], i) =>
    `<button type="button" class="gender-pill${i === 0 ? ' gender-pill-active' : ''}" data-filter="${value}" aria-pressed="${i === 0}">${label}</button>`
  ).join('');
  if (isGenderCollection) sortSelect?.querySelector('option[value="newest"]')?.remove();
  const filterBtns = filtersEl.querySelectorAll('.gender-pill');

  let currentFilter = 'all';
  let currentSort = 'featured';

  function render() {
    const matching = products.filter(filters[currentFilter].match);
    if (currentSort === 'newest') matching.sort((a, b) => b.id - a.id);
    const visible = showAll ? matching : matching.slice(0, 48);

    count.textContent = `${matching.length} ${matching.length === 1 ? 'fragrance' : 'fragrances'}`;
    /* Same card markup as the Shop grid (renderProductCard lives in app.js). */
    grid.innerHTML = visible.map((product) => renderProductCard(product)).join('');
    grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));

    grid.hidden = !visible.length;
    empty.hidden = !!visible.length;
  }

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

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => {
        b.classList.toggle('gender-pill-active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  sortSelect?.addEventListener('change', () => {
    currentSort = sortSelect.value;
    render();
  });

  render();
})();
