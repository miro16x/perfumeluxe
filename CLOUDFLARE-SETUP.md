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

Run `node --test tests/*.test.mjs` from the repository root. These tests mock Resend, Supabase, PayPal and Turnstile and do not send emails or take payments. After deployment, coordinate a test order and cancellation with the store and check delivery in the Resend Emails dashboard.

## Customer accounts (Supabase)

Accounts, taste preferences, likes and order history are stored in the Supabase project `bvffpffnyjfufprcdskb`. The browser (`auth.js`) uses the public project URL and publishable key. The Worker uses a secret key to write order history.

1. Create the tables once: Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. It is safe to re-run.
2. Authentication → URL Configuration: set Site URL to `https://luxeperfume.uluxe.site` and add `https://luxeperfume.uluxe.site/**` under Redirect URLs. Confirmation and password-reset links return to `index.html`.
3. Authentication → SMTP: use Resend (already verified for this domain) so confirmation and reset emails reach customers. Supabase's built-in mailer is for testing only.
4. Save the Supabase **secret** key (`sb_secret_…`, or the legacy `service_role` key) as a Worker secret named `SUPABASE_SERVICE_ROLE_KEY`. Never put it in browser JavaScript or source control. Without it, ordering still works; orders are just not added to account history.

`supabase/` is listed in `.assetsignore`, so the SQL file is not published with the site.

## Online payment (PayPal)

Customers pay when they order, on PayPal's hosted page, either with a PayPal account or by debit/credit card as a guest; card details never reach this site. The store is emailed only after PayPal confirms payment, and cancelling within 24 hours refunds the customer automatically. Until the PayPal secrets are set, ordering works as before (pay at pickup), so the code can be deployed before PayPal is ready. Online payment also needs `SUPABASE_SERVICE_ROLE_KEY`: the order details wait in Supabase while the customer is on PayPal's page.

Do everything in the **sandbox** first, then repeat steps 2–4 for live.

1. **Update the database.** Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. This adds the `checkouts` table and the PayPal columns on orders. It is safe to re-run.
2. **API credentials.** developer.paypal.com → log in with the business account → Apps & Credentials → **Sandbox** → Create App (type: Merchant). Save these as Worker secrets (Worker → Settings → Variables and Secrets, type **Secret**):
   - `PAYPAL_CLIENT_ID`: the app's Client ID
   - `PAYPAL_CLIENT_SECRET`: the app's Secret
   - `PAYPAL_ENV`: `sandbox` (later `live`). Saved as a secret so deploys don't remove it. If it's missing, the sandbox is used.
3. **Webhook.** In the same app → Webhooks → Add Webhook:
   - Webhook URL: `https://luxeperfume.uluxe.site/api/paypal-webhook`
   - Events: `Checkout order approved` (`CHECKOUT.ORDER.APPROVED`) and `Payment capture completed` (`PAYMENT.CAPTURE.COMPLETED`)
   - Copy the **Webhook ID** it shows and save it as a Worker secret named `PAYPAL_WEBHOOK_ID`.
4. **Card payments without a PayPal account.** In the live PayPal business account: Settings → Account settings → Website payments → Website preferences → set **PayPal account optional** to On. Without it, customers must log in to PayPal to pay.
5. **Test.** Let the stores know first, since real store emails are sent. Place an order on the live site and pay with a sandbox buyer account (developer.paypal.com → Testing Tools → Sandbox Accounts, the "Personal" one), or as a guest with a test card from Testing Tools → Card Generator. Check that:
   - you return to the site and see the pickup reference and "Paid",
   - the store email says **PAID ONLINE**,
   - the payment appears in the sandbox business account (sandbox.paypal.com → Activity),
   - cancelling from the confirmation screen shows a refund there.
   Then repeat with **Ship to me** and a U.S. address: the email should go to Luxe Fragrances as **New Shipping Order (PAID)** with the address, and the payment should show the shipping address.
6. **Go live.** Apps & Credentials → **Live** → Create App, add the same webhook there (it gets its own Webhook ID), then replace `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` with the live values and set `PAYPAL_ENV` to `live`. The keys and `PAYPAL_ENV` must match: live keys don't work against the sandbox, and the reverse.

Refunds for orders cancelled by phone, or for items that turn out to be unavailable, are issued from the staff dashboard, or in PayPal: Activity → find the payment (search its `LP-…` reference) → Issue a refund.

To turn online payment off at any time, delete the `PAYPAL_CLIENT_SECRET` Worker secret. Ordering immediately goes back to pay at pickup, and the shipping option disappears from the cart (shipping needs online payment). Carts already open in a browser may show it for up to five minutes, but the server refuses those shipping orders.

Shipping rates, the free-shipping threshold, the shipping store and the allowed states are set in `lib/shipping.js`. Perfume is shipped as a hazardous material (flammable liquid); confirm Luxe Fragrances' carrier account allows it before going live.

## Staff dashboard

1. **Update the database.** Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. This adds the `staff` table and the ready, shipped and picked-up order statuses. It is safe to re-run.
2. **Add staff.** Each staff member opens `https://luxeperfume.uluxe.site/staff.html`, chooses **Create account** and confirms their email. They'll see "Waiting for access" with their email until you add them. Then, in the SQL Editor, add them with their store:
   ```sql
   insert into public.staff (user_id, store, name)
   select id, 'Perfume World', 'Jane' from auth.users where email = 'jane@example.com';
   ```
   Use `'Luxe Fragrances'`, `'Perfume World'`, or `'all'` for someone who manages every store (such as the owner). To remove access: `delete from public.staff where user_id = (select id from auth.users where email = 'jane@example.com');`
3. **Use it.** Staff go to `https://luxeperfume.uluxe.site/staff.html` and sign in. The dashboard needs `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`, and refunds need the PayPal secrets.
