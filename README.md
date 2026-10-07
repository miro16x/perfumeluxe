# Luxe Perfume

A responsive luxury fragrance storefront for Luxe Fragrances and Perfume World in St. Thomas, U.S. Virgin Islands. Live at [luxeperfume.uluxe.site](https://luxeperfume.uluxe.site).

Customers browse the catalog, get personalized recommendations, and place free in-store pickup orders. There is no online payment: customers pay at the store when they collect.

## Features

- Product catalog with filtering, search, collections and product pages
- Signature Scent recommendation quiz
- Customer accounts with saved taste preferences, likes and order history
- Store pickup ordering with email confirmations to the store and the customer
- Online cancellation within 24 hours of ordering
- Bot protection and rate limiting on ordering
- Email alerts to the site owner when orders or cancellations fail
- Dark and light themes, keyboard navigation and reduced-motion support

## Technology

- HTML, CSS and vanilla JavaScript, with no framework or build step
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) serves the site and runs the order API
- [Supabase](https://supabase.com/) for customer accounts and order history
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
│   ├── pickup-order.js         Validates and sends pickup orders
│   └── cancel-pickup-order.js  Sends cancellations within the 24-hour window
├── lib/                Server-only helpers (never published)
│   ├── abuse-protection.js     Turnstile verification and rate limiting
│   ├── alerts.js               Failure alerts to the site owner
│   ├── cancel-token.js         Signs and verifies cancellation tokens
│   ├── email.js                Resend client
│   └── supabase.js             Saves orders to customer accounts
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

## Store pickup

1. The customer adds products to the cart, chooses Luxe Fragrances or Perfume World, picks a date and time, and enters their contact details.
2. Turnstile confirms a person submitted the form.
3. The store receives the order by email (BCC to the site owner), and the customer receives a confirmation with a unique pickup reference such as `LP-20261002-AB12CD34`.
4. Signed-in customers also see the order in their account history.

A pickup request confirms the store received it, not that the items are in stock. The store contacts the customer when the order is ready.

## Cancellation

Customers can cancel within 24 hours of ordering from the confirmation screen, or by calling the store with their pickup reference. The order API gives each order a signed cancellation token, so the 24-hour window and order details can't be forged from the browser. The store and customer are both emailed, and the order is marked cancelled in the customer's account history.

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
- Saving guest orders (only signed-in customers' orders are stored)
- Inventory and stock levels
- Online payment

## License

This project and its original design materials are intended for Luxe Perfume. Product names, fragrance names, images and trademarks remain the property of their respective owners.
