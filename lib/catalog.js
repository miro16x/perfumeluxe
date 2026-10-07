// Server-side prices. The browser sends only product ids, sizes and quantities;
// names and prices always come from products-data.js, so a customer can't
// change what they pay by editing the request.
import '../products-data.js';

const PRODUCTS_BY_ID = new Map(globalThis.UL_PRODUCTS.map((product) => [product.id, product]));
const MAX_QTY = 20;

/* Returns the priced line, or null for an unknown product, size or quantity.
   An empty size means the product's first (default) size. */
export function priceCartItem({ id, size, qty }) {
  const product = PRODUCTS_BY_ID.get(Number(id));
  const quantity = Number(qty);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;
  const variant = size ? product.sizes.find((option) => option.size === String(size)) : product.sizes[0];
  if (!variant) return null;
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    size: variant.size,
    price: variant.price,
    qty: quantity,
    img: product.img
  };
}
