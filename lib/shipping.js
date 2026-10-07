// Shipping rules, shared by the order handler and /api/checkout-options.
// Shipping always needs online payment, so it is only offered when Stripe is on.

export const SHIPPING_STORE = 'Luxe Fragrances';   /* ships every online order */
export const FLAT_RATE = 15;
export const FREE_OVER = 200;                       /* subtotal of $200 or more ships free */

/* The 50 states, Washington, D.C. and Puerto Rico. Military (AA/AE/AP) and
   other territories are deliberately absent. */
export const SHIPPING_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};

export const shippingCost = (subtotal) => (subtotal >= FREE_OVER ? 0 : FLAT_RATE);

const field = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/* Returns a cleaned address, or null if it is incomplete or outside the area.
   Puerto Rico ZIP codes start 006, 007 or 009. */
export function normalizeAddress(input) {
  if (!input || typeof input !== 'object') return null;
  const address = {
    line1: field(input.line1, 120),
    line2: field(input.line2, 120),
    city: field(input.city, 80),
    state: field(input.state, 2).toUpperCase(),
    zip: field(input.zip, 10)
  };
  if (address.line1.length < 3 || address.city.length < 2 || !SHIPPING_STATES[address.state]) return null;
  if (!/^\d{5}(-\d{4})?$/.test(address.zip)) return null;
  if ((address.state === 'PR') !== /^00[679]/.test(address.zip)) return null;
  return { ...address, country: address.state === 'PR' ? 'PR' : 'US' };
}

export const formatAddress = (address) => [
  address.line1,
  address.line2,
  `${address.city}, ${address.state} ${address.zip}`
].filter(Boolean).join('\n');
