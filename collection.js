(function initCollectionPage() {
  if (typeof PRODUCTS === 'undefined') return;

  const definitions = {
    men: {
      eyebrow: 'For Him', title: "Men's <em>Fragrances</em>",
      description: 'Bold woods, crisp citrus, aromatic freshness, and refined evening signatures.',
      match: (p) => p.category === 'fragrance' && p.gender === 'men'
    },
    women: {
      eyebrow: 'For Her', title: "Women's <em>Fragrances</em>",
      description: 'Radiant florals, velvet musks, luminous gourmands, and modern icons.',
      match: (p) => p.category === 'fragrance' && p.gender === 'women'
    },
    unisex: {
      eyebrow: 'Without Boundaries', title: 'Unisex <em>Fragrances</em>',
      description: 'Balanced blends selected for every mood, season, identity, and skin.',
      match: (p) => p.category === 'fragrance' && p.gender === 'unisex'
    },
    'niche-luxury': {
      eyebrow: 'Rare & Exceptional', title: 'Niche &amp; Luxury <em>Perfumes</em>',
      description: 'Discover Bond No. 9 fragrances inspired by the energy, artistry, and neighborhoods of New York City.',
      match: (p) => p.brandKey === 'bond-no-9'
    },
    gifts: {
      eyebrow: 'The Art of Giving', title: 'Gift <em>Sets</em>',
      description: 'Gift-ready Sol de Janeiro rituals featuring fragrance mist, body care, and shower essentials.',
      match: (p) => p.id !== 830 && p.brandKey === 'sol-de-janeiro' && /set/i.test(p.name)
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
  document.getElementById('collectionCount').textContent = `${products.length} ${products.length === 1 ? 'fragrance' : 'fragrances'}`;

  const grid = document.getElementById('collectionProductGrid');
  const visible = products.slice(0, 48);
  grid.innerHTML = visible.map((product) => {
    const price = product.sizes?.[0]?.price ?? product.price;
    const usePrimaryImage = key === 'gifts' || key === 'niche-luxury';
    const image = usePrimaryImage ? product.img : (product.imgHover || product.img);
    const badge = product.badgeText
      ? `<div class="product-badge ${product.badgeClass}">${product.badgeText}</div>` : '';
    return `<a class="collection-product" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${product.name} by ${product.brand}">
      <div class="collection-product-image">${badge}<img src="${image}" alt="${product.name}" loading="lazy" decoding="async"></div>
      <div class="collection-product-copy">
        <span>${product.brand}</span><h3>${product.name}</h3>
        <div><em>${product.notes.slice(0, 3).join(' · ')}</em><strong>$${price}</strong></div>
      </div>
    </a>`;
  }).join('');

  if (!visible.length) {
    grid.hidden = true;
    document.getElementById('collectionEmpty').hidden = false;
  }
})();
