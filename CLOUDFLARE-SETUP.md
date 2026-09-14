# Cloudflare Worker deployment setup

The storefront is deployed as a Cloudflare Worker with static assets. The Worker routes `/api/pickup-order` and `/api/cancel-pickup-order` to the order handlers and serves the website through the `ASSETS` binding. Email is delivered through Resend using the server-side `RESEND_API_KEY` Worker secret.

## Before deploying

1. Confirm `luxeperfume.uluxe.site` is active in the Cloudflare account used for the Worker.
2. Add `luxeperfume.uluxe.site` in Resend → Domains. Add the DNS records Resend provides in Cloudflare and wait until Resend shows the domain as verified. Create a sending API key and save it as a Worker secret named `RESEND_API_KEY` under Worker Settings → Variables and Secrets. Never put this key in browser JavaScript or source control.
3. Deploy from the `urban-luxe` directory with `npx wrangler@latest deploy`, or configure that command in a Workers Builds project whose root directory is `urban-luxe`.
4. Confirm that the deployed Worker has the `RESEND_API_KEY` secret and `ASSETS` binding. The old `EMAIL` binding is no longer used.

The Function sends from `orders@luxeperfume.uluxe.site`. That mailbox does not have to exist, but the subdomain must finish verification in Resend before orders can be delivered.

## Notification routing

- Luxe Fragrances orders: `luxefragrances.vi@gmail.com`
- Perfume World orders: `perfumeworldvi@gmail.com`
- Every store notification is privately BCC'd to `amirslem679@gmail.com`.
- The customer receives a separate receipt at the email entered in the pickup form.

## Local verification

Run `node --test urban-luxe/tests/*.test.mjs` from the repository root. These tests mock Resend and do not send emails. After deployment, coordinate a test order and cancellation with the store and check delivery in the Resend Emails dashboard.
