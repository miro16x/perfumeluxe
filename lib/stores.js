// Pickup locations, shared by the order, payment and cancellation handlers.
export const STORES = {
  'Luxe Fragrances': {
    email: 'luxefragrances.vi@gmail.com',
    address: '9001 Havensight Mall, Suite A & B, St. Thomas, VI 00802',
    phone: '340-693-0039'
  },
  'Perfume World': {
    email: 'perfumeworldvi@gmail.com',
    address: '4605 Tutu Park Mall, St. Thomas, VI 00802',
    phone: '340-777-5504'
  }
};

export const ALWAYS_NOTIFY = 'amirsslem679@gmail.com';
export const FROM_ADDRESS = { email: 'orders@luxeperfume.uluxe.site', name: 'Luxe Perfume Pickup' };
export const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
