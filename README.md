# Luxe Perfume

A responsive luxury fragrance storefront for Luxe Fragrances and Perfume World in St. Thomas, U.S. Virgin Islands.

The website offers fragrance discovery, product browsing, personalized recommendations, a local shopping cart, and complimentary in-store pickup ordering.

## Features

- Responsive luxury storefront
- Dark and light themes
- Product catalog with filtering and search
- Individual product and collection pages
- New arrivals and best-seller sections
- Signature Scent recommendation quiz
- Wishlist and shopping cart
- Local account preferences
- Store pickup scheduling
- Pickup confirmation emails
- Pickup cancellation requests within 24 hours
- Customer support and policy panels
- Keyboard and reduced-motion accessibility support

## Technology

- HTML5
- CSS3
- Vanilla JavaScript
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare Email Service
- Browser `localStorage`

No frontend framework or build process is required.

## Project Structure

```text
urban-luxe/
├── index.html
├── product.html
├── collection.html
├── styles.css
├── app.js
├── auth.js
├── product.js
├── collection.js
├── products-data.js
├── images/
├── functions/
│   └── api/
│       ├── pickup-order.js
│       └── cancel-pickup-order.js
├── wrangler.jsonc
├── CLOUDFLARE-SETUP.md
├── .gitignore
└── README.md
```

## Key Files

- `index.html` — Main storefront and homepage sections
- `styles.css` — Shared layout, themes, components, and responsive styling
- `app.js` — Navigation, cart, search, pickup ordering, recommendations, and general interactions
- `auth.js` — Local account sessions and fragrance preferences
- `products-data.js` — Shared product catalog
- `product.html` and `product.js` — Individual product experience
- `collection.html` and `collection.js` — Collection browsing experience
- `functions/api/pickup-order.js` — Sends pickup-order notifications and customer confirmations
- `functions/api/cancel-pickup-order.js` — Sends pickup cancellation requests within the permitted window
- `wrangler.jsonc` — Cloudflare Pages and Email Service configuration

## Running Locally

Because this is a static website, it can be served with any local HTTP server.

Using Python:

```bash
cd urban-luxe
python3 -m http.server 8080
```

Then visit:

```text
http://localhost:8080
```

For local Cloudflare Pages Function testing, install or run Wrangler:

```bash
cd urban-luxe
npx wrangler pages dev .
```

Wrangler will display the local development URL in the terminal.

> Pickup-order and cancellation emails require a configured Cloudflare Email Service binding. The visual storefront can still be explored without it.

## Store Pickup

Customers can:

1. Add products to their cart.
2. Select Luxe Fragrances or Perfume World.
3. Choose a pickup date and time.
4. Enter their contact information.
5. submit the pickup request.
6. Receive a unique pickup reference by email.

A pickup request confirms that the store received the request. It does not guarantee inventory until the selected store confirms availability.

## Pickup Cancellation

Customers may request cancellation within 24 hours of placing a pickup order.

After checkout, the confirmation screen displays:

- The pickup reference
- The selected store
- The cancellation deadline
- A **Cancel Pickup Order** button

When cancellation is requested:

- The selected store is notified.
- The internal order contact is notified.
- The customer receives a cancellation-request confirmation email.

Customers can also contact the selected store with their pickup reference.

## Local Account Data

Accounts, sessions, saved preferences, wishlist selections, theme settings, and certain order details are stored locally in the customer’s browser.

This means:

- Account information is specific to the current browser and device.
- Clearing browser storage may remove saved preferences and local account information.
- The current account feature is not a server-backed authentication system.
- Passwords stored locally should not be treated as production-grade authentication.

## Cloudflare Deployment

The project is configured for Cloudflare Pages.

### Prerequisites

- A Cloudflare account
- A Cloudflare Pages project
- A verified sending domain
- Cloudflare Email Service enabled
- The `EMAIL` binding configured in `wrangler.jsonc`

### Deployment Steps

1. Add `luxeperfume.com` to the appropriate Cloudflare account.
2. Open **Compute & AI → Email Service → Email Sending**.
3. Onboard and verify the sending domain.
4. Allow Cloudflare to configure the required SPF, DKIM, DMARC, and bounce-domain records.
5. Connect the repository to Cloudflare Pages.
6. Set `urban-luxe` as the project root.
7. Deploy the project.
8. Confirm that the `EMAIL` binding is available to the Pages Functions.

Cloudflare dashboard Direct Upload does not deploy Pages Functions. Deploy through a connected Git repository or Wrangler.

### Wrangler Deployment

```bash
cd urban-luxe
npx wrangler pages deploy .
```

## Email Routing

Pickup orders are routed to the selected store:

- **Luxe Fragrances**  
  `luxefragrances.vi@gmail.com`

- **Perfume World**  
  `perfumeworldvi@gmail.com`

The customer receives a separate confirmation at the email address entered during checkout.

Transactional messages are sent from:

```text
Luxe Perfume Pickup <orders@luxeperfume.com>
```

The sending domain must be verified before Cloudflare can deliver these messages.

## Store Locations

### Luxe Fragrances

9001 Havensight Mall, Suite A & B  
St. Thomas, VI 00802  
340-693-0039

### Perfume World

4605 Tutu Park Mall  
St. Thomas, VI 00802  
340-777-5504

## Accessibility

The website includes:

- Semantic headings and landmarks
- Keyboard-accessible controls
- Visible focus states
- Descriptive labels
- Responsive layouts
- Dark and light display themes
- Reduced-motion support
- Accessible dialogs and status messages

## Important Production Notes

Before treating the website as a full production commerce system, consider adding:

- Server-backed customer authentication
- A persistent order database
- Signed or database-verified cancellation tokens
- Inventory management
- Payment processing
- Administrative order management
- Automated testing
- Rate limiting and abuse protection
- Centralized monitoring and error reporting

## License

This project and its original design materials are intended for Luxe Perfume. Product names, fragrance names, images, and trademarks remain the property of their respective owners.
