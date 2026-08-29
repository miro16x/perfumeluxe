# Cloudflare deployment setup

The pickup-order API is a Cloudflare Pages Function at `/api/pickup-order`. It uses Cloudflare Email Service through the `EMAIL` binding declared in `wrangler.jsonc`.

## Before deploying

1. Add `luxeperfume.com` to the Cloudflare account used for the Pages project.
2. In **Compute & AI → Email Service → Email Sending**, onboard `luxeperfume.com` and allow Cloudflare to add the SPF, DKIM, DMARC, and bounce-domain DNS records.
3. Deploy from a connected Git repository or with Wrangler, using `urban-luxe` as the Pages project root. Cloudflare dashboard Direct Upload does not deploy Pages Functions.
4. Confirm that the `EMAIL` send-email binding from `wrangler.jsonc` is present on the deployed project.

The Function sends from `orders@luxeperfume.com`. That mailbox does not have to exist, but the domain must finish Email Sending verification before orders can be delivered.

## Notification routing

- Luxe Fragrances orders: `luxefragrances.vi@gmail.com`
- Perfume World orders: `perfumeworldvi@gmail.com`
- Every store notification is privately BCC'd to `amirslem679@gmail.com`.
- The customer receives a separate receipt at the email entered in the pickup form.
