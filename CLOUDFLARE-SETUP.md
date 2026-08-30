# Cloudflare Worker deployment setup

The storefront is deployed as a Cloudflare Worker with static assets. The Worker routes `/api/pickup-order` and `/api/cancel-pickup-order` to the order handlers and serves the website through the `ASSETS` binding. Email is delivered through the native `EMAIL` binding declared in `wrangler.jsonc`.

## Before deploying

1. Add `luxeperfume.com` to the Cloudflare account used for the Pages project.
2. In **Compute & AI → Email Service → Email Sending**, onboard `luxeperfume.com` and allow Cloudflare to add the SPF, DKIM, DMARC, and bounce-domain DNS records.
3. Deploy from the `urban-luxe` directory with `npx wrangler@latest deploy`, or configure that command in a Workers Builds project whose root directory is `urban-luxe`.
4. Confirm that the `EMAIL` send-email and `ASSETS` bindings from `wrangler.jsonc` are present on the deployed Worker.

The Function sends from `orders@luxeperfume.com`. That mailbox does not have to exist, but the domain must finish Email Sending verification before orders can be delivered.

## Notification routing

- Luxe Fragrances orders: `luxefragrances.vi@gmail.com`
- Perfume World orders: `perfumeworldvi@gmail.com`
- Every store notification is privately BCC'd to `amirslem679@gmail.com`.
- The customer receives a separate receipt at the email entered in the pickup form.
