# Cloudflare Worker deployment setup

The storefront is deployed as a Cloudflare Worker with static assets. The Worker routes `/api/pickup-order` and `/api/cancel-pickup-order` to the order handlers and serves the website through the `ASSETS` binding. Email is delivered through Resend using the server-side `RESEND_API_KEY` Worker secret.

## Before deploying

1. Confirm the existing Worker is named `luxeperfume` and serves `luxeperfume.uluxe.site` in the Cloudflare account used for deployment. `wrangler.jsonc` targets this Worker. Store the `RESEND_API_KEY` secret on this Worker.
2. Add `luxeperfume.uluxe.site` in Resend → Domains. Add the DNS records Resend provides in Cloudflare and wait until Resend shows the domain as verified. Create a sending API key and save it as a Worker secret named `RESEND_API_KEY` under Worker Settings → Variables and Secrets. Never put this key in browser JavaScript or source control.
3. Deploy from the `urban-luxe` directory with `npx wrangler@latest deploy`, or configure that command in a Workers Builds project whose root directory is `urban-luxe`.
4. Confirm that the deployed Worker has the `RESEND_API_KEY` secret and `ASSETS` binding. The old `EMAIL` binding is no longer used.
5. Add a Worker secret named `CANCEL_SIGNING_SECRET` set to a long random value (for example, the output of `openssl rand -base64 32`). The pickup endpoint signs each order with it, and the cancellation endpoint rejects any request whose details (reference, email, store, time placed) don't match that signature, so the 24-hour window can't be bypassed. Without it, online cancellation is turned off and customers are told to call the store. Changing it invalidates the cancel buttons of orders placed in the previous 24 hours.
6. Bot protection (Turnstile), in this order so orders never break:
   1. Cloudflare dashboard → Turnstile → Add widget. Hostname: `uluxe.site` (this covers the `luxeperfume` subdomain). Widget mode: Managed.
   2. Paste the **site key** into `TURNSTILE_SITE_KEY` near the top of the pickup code in `app.js`, then deploy. The site key is public.
   3. Save the **secret key** as a Worker secret named `TURNSTILE_SECRET_KEY`. From then on the pickup endpoint rejects orders without a valid Turnstile token, before any email is sent. Without the secret, the check is off.
7. Rate limiting needs no setup: `wrangler.jsonc` defines the `API_RATE_LIMITER` binding (10 requests per minute per visitor IP for each API route), and visitors over the limit get HTTP 429.

The Function sends from `orders@luxeperfume.uluxe.site`. That mailbox does not have to exist, but the subdomain must finish verification in Resend before orders can be delivered.

## Notification routing

- Luxe Fragrances orders: `luxefragrances.vi@gmail.com`
- Perfume World orders: `perfumeworldvi@gmail.com`
- Every store notification is privately BCC'd to `amirsslem679@gmail.com`.
- The customer receives a separate receipt at the email entered in the pickup form.

## Local verification

Run `node --test tests/*.test.mjs` from the repository root. These tests mock Resend, Supabase and Turnstile and do not send emails. After deployment, coordinate a test order and cancellation with the store and check delivery in the Resend Emails dashboard.

## Customer accounts (Supabase)

Accounts, taste preferences, likes and order history are stored in the Supabase project `bvffpffnyjfufprcdskb`. The browser (`auth.js`) uses the public project URL and publishable key. The Worker uses a secret key to write order history.

1. Create the tables once: Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. It is safe to re-run.
2. Authentication → URL Configuration: set Site URL to `https://luxeperfume.uluxe.site` and add `https://luxeperfume.uluxe.site/**` under Redirect URLs. Confirmation and password-reset links return to `index.html`.
3. Authentication → SMTP: use Resend (already verified for this domain) so confirmation and reset emails reach customers. Supabase's built-in mailer is for testing only.
4. Save the Supabase **secret** key (`sb_secret_…`, or the legacy `service_role` key) as a Worker secret named `SUPABASE_SERVICE_ROLE_KEY`. Never put it in browser JavaScript or source control. Without it, ordering still works; orders are just not added to account history.

`supabase/` is listed in `.assetsignore`, so the SQL file is not published with the site.

## Online payment (Stripe)

Customers pay when they order, on Stripe's hosted Checkout page; card details never reach this site. The store is emailed only after Stripe confirms payment, and cancelling within 24 hours refunds the customer automatically. Until both Stripe secrets are set, ordering works as before (pay at pickup), so the code can be deployed before Stripe is ready.

Do everything in **test mode** first (the toggle at the top of the Stripe dashboard), then repeat steps 2–4 in live mode.

1. **Update the database.** Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. This adds the payment and shipping columns and lets guest orders be stored. It is safe to re-run.
2. **API key.** Stripe dashboard → Developers → API keys → copy the **Secret key** (`sk_test_…`, later `sk_live_…`). Save it as a Worker secret named `STRIPE_SECRET_KEY`.
3. **Webhook.** Stripe dashboard → Developers → Webhooks → Add endpoint:
   - Endpoint URL: `https://luxeperfume.uluxe.site/api/stripe-webhook`
   - Events: `checkout.session.completed` only
   - After saving, reveal the **Signing secret** (`whsec_…`) and save it as a Worker secret named `STRIPE_WEBHOOK_SECRET`.
4. **Business details.** Stripe dashboard → Settings → Public details: set the business name and support phone/email customers see on the payment page and their card statement.
5. **Test.** Place an order on the live site and pay with the test card `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP). Check that:
   - you return to the site and see the pickup reference and "Paid",
   - the store email says **PAID ONLINE**,
   - the payment appears under Stripe → Payments,
   - cancelling from the confirmation screen shows a refund in Stripe.
   Then repeat with **Ship to me** and a U.S. address: the email should go to Luxe Fragrances as **New Shipping Order (PAID)** with the address, and the payment in Stripe should show the shipping details.
   Let the stores know first, since real store emails are sent.
6. **Go live.** Switch the Stripe dashboard to live mode, repeat steps 2–3 with the live key and a live-mode webhook (it has its own signing secret), and replace both Worker secrets.

Refunds for orders cancelled by phone, or for items that turn out to be unavailable, are issued in the Stripe dashboard: Payments → find the order (search its `LP-…` reference) → Refund.

To turn online payment off at any time, delete the `STRIPE_SECRET_KEY` Worker secret. Ordering immediately goes back to pay at pickup, and the shipping option disappears from the cart (shipping needs online payment). Carts already open in a browser may show it for up to five minutes, but the server refuses those shipping orders.

Shipping rates, the free-shipping threshold, the shipping store and the allowed states are set in `lib/shipping.js`. Perfume is shipped as a hazardous material (flammable liquid); confirm Luxe Fragrances' carrier account allows it before going live.
