import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const catalogueSource = readFileSync(new URL('../products-data.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../product.js', import.meta.url), 'utf8');
const context = vm.createContext({ document: { getElementById: () => null } });
vm.runInContext(`${catalogueSource}\n${pageSource}\nthis.catalogue = PRODUCTS;`, context);
const products = context.catalogue;
const related = (product) => Array.from(context.getRelatedFragrances(product, products));

test('all six replacement lines recommend only their own variants', () => {
  const families = [
    ['carolina-herrera', /\bGood Girl\b/],
    ['valentino', /^Donna Born in Roma\b/],
    ['prada', /^Paradoxe\b/],
    ['ysl', /^Libre\b/],
    ['marc-jacobs', /^Perfect\b/],
    ['burberry', /^Her\b/]
  ];
  for (const [brand, name] of families) {
    const variants = products.filter(p => p.brandKey === brand && name.test(p.name));
    assert.ok(variants.length > 1, brand);
    for (const selected of variants) {
      const recommendations = related(selected);
      assert.equal(recommendations.length, Math.min(4, variants.length - 1));
      for (const item of recommendations) {
        assert.notEqual(item.id, selected.id);
        assert.ok(variants.includes(item), `${selected.name} recommended ${item.name}`);
      }
    }
  }
});

test('same-line variants precede other brand recommendations', () => {
  const coco = products.find(p => p.name === 'Coco Eau de Parfum');
  assert.equal(related(coco)[0].name, 'Coco Eau de Toilette');
  assert.equal(related(coco).length, 4);
  assert.ok(related(coco).every(p => p.brandKey === 'chanel' && p.gender === 'women'));
});

test('men’s Born in Roma stays separate from women’s Born in Roma', () => {
  const selected = products.find(p => p.name === 'Uomo Born in Roma Eau de Toilette');
  assert.equal(related(selected).length, 4);
  assert.ok(related(selected).every(p => p.name.startsWith('Uomo Born in Roma')));
});

test('a standalone fragrance recommends other fragrances from its brand', () => {
  const dune = products.find(p => p.name === 'Dune');
  assert.equal(related(dune).length, 4);
  assert.ok(related(dune).every(p => p.brandKey === 'dior' && p.gender === 'women'));
});

test('every catalogue product has unique same-brand recommendations excluding itself', () => {
  for (const selected of products) {
    const recommendations = related(selected);
    assert.ok(recommendations.length > 0, selected.name);
    assert.ok(recommendations.length <= 4);
    assert.equal(new Set(recommendations.map(p => p.id)).size, recommendations.length);
    assert.ok(recommendations.every(p => p.id !== selected.id && p.brandKey === selected.brandKey));
  }
});

test('product page shows recommendations for both fragrance lines and standalone fragrances', () => {
  for (const name of ['Good Girl Eau de Parfum', 'Dune']) {
    const selected = products.find(p => p.name === name);
    const elements = new Map();
    const document = {
      querySelector: () => null,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          hidden: true,
          setAttribute() {},
          addEventListener() {},
          querySelectorAll: () => []
        });
        return elements.get(id);
      }
    };
    vm.runInNewContext(`${catalogueSource}\n${pageSource}`, {
      document, URLSearchParams,
      window: { location: { search: `?id=${selected.id}` } },
      formatSizeLabel: size => size,
      renderProductCard: p => `<a href="product.html?id=${p.id}">${p.name}</a>`
    });
    assert.equal(elements.get('pdpRoot').hidden, false);
    assert.equal(elements.get('pdpRelated').hidden, false);
    const html = elements.get('pdpRelatedGrid').innerHTML;
    for (const item of related(selected)) assert.ok(html.includes(`product.html?id=${item.id}`));
    assert.ok(!html.includes(`product.html?id=${selected.id}`));
  }
});
