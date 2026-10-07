# Luxe Perfume

A responsive luxury fragrance storefront for Luxe Fragrances and Perfume World in St. Thomas, U.S. Virgin Islands. Live at [luxeperfume.uluxe.site](https://luxeperfume.uluxe.site).

Customers browse the catalog, get personalized recommendations, and order for free in-store pickup or shipping within the United States and Puerto Rico, paying online through Stripe when they order.

## Features

- Product catalog with filtering, search, collections and product pages
- Signature Scent recommendation quiz
- Customer accounts with saved taste preferences, likes and order history
- Store pickup ordering with online payment (Stripe Checkout) and email confirmations to the store and the customer
- Shipping to the 50 states, Washington, D.C. and Puerto Rico from Luxe Fragrances ($15, free on orders of $200 or more)
- Online cancellation with an automatic refund within 24 hours of ordering
- Bot protection and rate limiting on ordering
- Email alerts to the site owner when orders or cancellations fail
- Dark and light themes, keyboard navigation and reduced-motion support

## Technology

- HTML, CSS and vanilla JavaScript, with no framework or build step
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) serves the site and runs the order API
- [Stripe Checkout](https://stripe.com/payments/checkout) for payments and refunds
- [Supabase](https://supabase.com/) for customer accounts, order history and paid-order records
- [Resend](https://resend.com/) for order, cancellation and alert emails
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) for bot protection

## Project structure

```text
urban-luxe/
├── index.html, shop.html, collection.html, product.html, about.html, contact.html
├── styles.css
├── app.js              Navigation, cart, search, pickup ordering and the Turnstile widget
├── auth.js             Supabase sign-in, profiles, preferences, likes and order history
├── products-data.js    Product catalog
├── product.js, collection.js
├── images/
├── worker.js           Routes /api/* to the handlers below and serves everything else
├── functions/api/
│   ├── pickup-order.js         Validates and prices orders; starts Stripe Checkout (or emails the store when payment is off)
│   ├── stripe-webhook.js       Receives Stripe's payment confirmation and emails the store
│   ├── checkout-status.js      Confirmation details when the customer returns from Stripe
│   ├── checkout-options.js     Tells the cart whether payment and shipping are available
│   └── cancel-pickup-order.js  Cancels within the 24-hour window and refunds paid orders
├── lib/                Server-only helpers (never published)
│   ├── abuse-protection.js     Turnstile verification and rate limiting
│   ├── alerts.js               Failure alerts to the site owner
│   ├── cancel-token.js         Signs and verifies cancellation tokens
│   ├── catalog.js              Server-side prices from products-data.js
│   ├── email.js                Resend client
│   ├── order-emails.js         Store and customer order emails
│   ├── shipping.js             Shipping area, rates and address checks
│   ├── stores.js               Store addresses, phones and email routing
│   ├── stripe.js               Stripe Checkout, webhook verification and refunds
│   └── supabase.js             Order records and account history
├── supabase/           Database schema and auth email templates (never published)
├── tests/              Node test suite (never published)
├── wrangler.jsonc      Worker configuration
└── CLOUDFLARE-SETUP.md Deployment and secrets setup
```

`.assetsignore` keeps server code, tests, the database schema and docs out of the public site.

## Running locally

Run the site and the order API together with Wrangler:

```bash
cd urban-luxe
npx wrangler dev
```

Without the Worker secrets, browsing works, but ordering returns "Email service is not configured". The Turnstile widget only works on `uluxe.site` domains, so it does not load on `localhost`.

Run the tests (they mock Resend, Supabase and Turnstile, and send nothing):

```bash
node --test tests/*.test.mjs
```

## Deployment

Deploy with `npx wrangler@latest deploy` from this folder, or push to `main` if the Worker is connected to GitHub through Workers Builds. First-time setup (Resend domain, Supabase tables, Turnstile widget and Worker secrets) is in [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md).

The Worker needs these secrets, set under Worker → Settings → Variables and Secrets as type **Secret**:

| Secret | Used for | Without it |
| --- | --- | --- |
| `RESEND_API_KEY` | Sending all emails | Ordering and cancellation are unavailable |
| `CANCEL_SIGNING_SECRET` | Signing cancellation tokens | Online cancellation is off; customers are told to call the store |
| `SUPABASE_SERVICE_ROLE_KEY` | Saving orders to account history | Orders work but don't appear in accounts |
| `TURNSTILE_SECRET_KEY` | Verifying the bot check | The bot check is off |
| `STRIPE_SECRET_KEY` | Creating payments and refunds | Customers pay at pickup instead |
| `STRIPE_WEBHOOK_SECRET` | Verifying Stripe's payment confirmations | Customers pay at pickup instead |

## Store pickup and payment

1. The customer adds products to the cart, chooses Luxe Fragrances or Perfume World, picks a date and time, and enters their contact details.
2. Turnstile confirms a person submitted the form.
3. The server prices every item from `products-data.js` (prices sent by the browser are ignored) and opens a Stripe Checkout page.
4. Once Stripe confirms payment, its webhook records the order in Supabase and emails the store (BCC to the site owner) marked **PAID**, and the customer a confirmation with a unique pickup reference such as `LP-20261002-AB12CD34`.
5. The customer returns to the site and sees the reference and a cancel button. Signed-in customers also see the order in their account history.

If the customer leaves the Stripe page, they aren't charged and their cart is restored. Without the Stripe secrets, step 3 is skipped: the store is emailed straight away and the customer pays at pickup.

A paid order confirms the store received it, not that the items are in stock. If something is unavailable, the store refunds it from the Stripe dashboard.

## Shipping

When online payment is on, the cart offers **Ship to me** next to store pickup. Shipping orders:

- go only to the 50 states, Washington, D.C. and Puerto Rico. The server rejects other addresses (military, other territories, a ZIP code that doesn't match the state) before payment. The rules and rates are in `lib/shipping.js`.
- cost $15, or ship free when the order subtotal is $200 or more.
- are always sent to **Luxe Fragrances**. The store email is marked **New Shipping Order (PAID)**, shows the address, and asks the store to ship after the 24-hour cancellation window closes, so an order is never refunded after it has left.
- appear in the customer's account history as "Shipping to City, ST".

There is no tracking-number flow yet: the store emails the customer tracking details itself.

## Cancellation and refunds

Customers can cancel within 24 hours of ordering from the confirmation screen, or by calling the store with their pickup reference. Each order gets a signed cancellation token, so the 24-hour window and order details can't be forged from the browser. Cancelling a paid order refunds it in full through Stripe first; only then are the store and customer emailed, and the order is marked refunded. Phone cancellations are refunded by hand in the Stripe dashboard.

## Customer accounts

Accounts use Supabase Auth (email and password, with email confirmation). Profiles, taste preferences and likes are stored in Supabase and protected by row-level security, so each customer can only read and change their own. Order history can only be written by the Worker, so customers can't add or edit orders themselves. The schema is in [supabase/schema.sql](supabase/schema.sql).

The browser keeps a small cache in `localStorage` (the last signed-in profile, quiz answers in progress, the latest pickup order for cancellation, recently shown recommendations, theme and cookie choices), but the account data lives in Supabase.

## Security and monitoring

- **Bot protection:** the order API rejects submissions without a valid Turnstile token before sending any email.
- **Rate limiting:** each visitor IP can call each API route 10 times a minute (`API_RATE_LIMITER` in `wrangler.jsonc`).
- **Secrets:** API keys exist only as Worker secrets and never reach the browser.
- **Logs:** Workers Logs is enabled; view every request and error under Cloudflare → Workers → luxeperfume → Logs.
- **Alerts:** the site owner is emailed when:
  - a store doesn't receive an order or cancellation. Every one is sent, with the full details, so it can be passed on by hand.
  - customer confirmations, the bot check or account saving start failing. These are sent at most once an hour per problem.

  Alerts go through Resend, so a complete Resend outage can't send them; check the Resend dashboard and Workers Logs if orders seem quiet.

## Email routing

Emails are sent from `orders@luxeperfume.uluxe.site` (alerts from `alerts@luxeperfume.uluxe.site`). The domain must stay verified in Resend.

- **Luxe Fragrances** orders: `luxefragrances.vi@gmail.com`
- **Perfume World** orders: `perfumeworldvi@gmail.com`
- Every store notification and every alert also goes to the site owner.

## Store locations

**Luxe Fragrances**
9001 Havensight Mall, Suite A & B
St. Thomas, VI 00802
340-693-0039

**Perfume World**
4605 Tutu Park Mall
St. Thomas, VI 00802
340-777-5504

## Not yet built

- A staff dashboard for stores to manage orders and update customers
- Inventory and stock levels (on hold until the stores have a point-of-sale system)

## License

This project and its original design materials are intended for Luxe Perfume. Product names, fragrance names, images and trademarks remain the property of their respective owners.
