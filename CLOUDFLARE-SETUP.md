# Cloudflare Worker deployment setup

The storefront is deployed as a Cloudflare Worker with static assets. The Worker routes `/api/pickup-order` and `/api/cancel-pickup-order` to the order handlers and serves the website through the `ASSETS` binding. Email is delivered through Resend using the server-side `RESEND_API_KEY` Worker secret.

## Before deploying

1. Confirm the existing Worker is named `luxeperfume` and serves `luxeperfume.uluxe.site` in the Cloudflare account used for deployment. `wrangler.jsonc` targets this Worker. Store the `RESEND_API_KEY` secret on this Worker.
2. Add `luxeperfume.uluxe.site` in Resend → Domains. Add the DNS records Resend provides in Cloudflare and wait until Resend shows the domain as verified. Create a sending API key and save it as a Worker secret named `RESEND_API_KEY` under Worker Settings → Variables and Secrets. Never put this key in browser JavaScript or source control.
3. Deploy from the `urban-luxe` directory with `npx wrangler@latest deploy`, or configure that command in a Workers Builds project whose root directory is `urban-luxe`.
4. Confirm that the deployed Worker has the `RESEND_API_KEY` secret and `ASSETS` binding. The old `EMAIL` binding is no longer used.

The Function sends from `orders@luxeperfume.uluxe.site`. That mailbox does not have to exist, but the subdomain must finish verification in Resend before orders can be delivered.

## Notification routing

- Luxe Fragrances orders: `luxefragrances.vi@gmail.com`
- Perfume World orders: `perfumeworldvi@gmail.com`
- Every store notification is privately BCC'd to `amirsslem679@gmail.com`.
- The customer receives a separate receipt at the email entered in the pickup form.

## Local verification

Run `node --test urban-luxe/tests/*.test.mjs` from the repository root. These tests mock Resend and do not send emails. After deployment, coordinate a test order and cancellation with the store and check delivery in the Resend Emails dashboard.

## Customer accounts (Supabase)

Accounts, taste preferences, likes and order history are stored in the Supabase project `bvffpffnyjfufprcdskb`. The browser (`auth.js`) uses the public project URL and publishable key. The Worker uses a secret key to write order history.

1. Create the tables once: Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run. It is safe to re-run.
2. Authentication → URL Configuration: set Site URL to `https://luxeperfume.uluxe.site` and add `https://luxeperfume.uluxe.site/**` under Redirect URLs. Confirmation and password-reset links return to `index.html`.
3. Authentication → SMTP: use Resend (already verified for this domain) so confirmation and reset emails reach customers. Supabase's built-in mailer is for testing only.
4. Save the Supabase **secret** key (`sb_secret_…`, or the legacy `service_role` key) as a Worker secret named `SUPABASE_SERVICE_ROLE_KEY`. Never put it in browser JavaScript or source control. Without it, ordering still works; orders are just not added to account history.

`supabase/` is listed in `.assetsignore`, so the SQL file is not published with the site.
