# Stripe setup

All four stores are static sites on GitHub Pages, so there is no server to hold a
Stripe secret key. Stripe's supported route for that is **Payment Links** — the old
client-only `stripe.redirectToCheckout` was removed from Stripe.js and is no longer an
option.

## There is no "connect with my Stripe login"

No Stripe API accepts an account email and password, and none should: those credentials
control your money, they are second-factor gated, and handing them to any tool or person
is the one mistake that cannot be undone quietly.

What Stripe does have is a **restricted API key** — a credential you create yourself,
scope to exactly what a job needs, and revoke in one click. That is what the script below
uses, and it is the closest thing to what you actually want.

## The fast way — 16 links in one command

```bash
# Dashboard -> Developers -> API keys -> Create restricted key
# WRITE on: Products, Prices, Payment links.  Everything else: None.

STRIPE_API_KEY=rk_live_...  python3 setup-payment-links.py
```

It reads each store's live catalogue, so it always matches what is on sale, and creates
per machine:

- a **product** with the machine's name, its photograph and a link back to its page
- a **price** in GBP
- a **payment link** with UK shipping address collection, a phone number, an adjustable
  quantity and a *Delivery access notes* field — the carrier telephones to book a slot,
  and nothing else on a static site ever gets the chance to ask about gate width or
  gradient

Run it from inside a store repo and it does that store; run it from anywhere else and it
does all four. It prints one block per store, ready to paste — add `--write` and it edits
`site-config.js` for you instead. Only the `paymentLinks` block is touched; the admin
hash and every other setting survive.

`--dry-run` lists what it would create and changes nothing. Worth doing first.

Running it again is safe: products are created at fixed ids and reused, a price is
reused while the amount still matches, and a machine that already has a link is left
alone. Nothing is ever deleted.

`--vat-inclusive` marks the prices VAT-inclusive. Use it only if the company is VAT
registered — none of the four currently shows a VAT number.

## The manual way

If you would rather click than run anything: **Product catalogue → Add product**, one per
machine, price in GBP. Then **Payment Links → New link**, pick the product, and switch on
shipping address collection (GB), adjustable quantity, and a custom text field named
`Delivery access notes`. Copy each URL.

Paste the URLs into `assets/js/site-config.js` in each store repo, or through
`/admin.html` on the store itself:

```js
paymentLinks: {
  "TH-CREX6M": "https://buy.stripe.com/xxxxxxxx",
  ...
}
```

The site reads that file at runtime, so you can edit it straight on GitHub — no rebuild
needed. Sixteen links in total: four machines on each of four stores.

**Never put a secret key (`sk_live_…`, `rk_live_…`) in this file or anywhere in the
repo,** and never paste one into a chat window. Payment Link URLs are public by design;
keys are not. If one is ever exposed, roll it in the Dashboard immediately.

## What happens once links are in

| Basket | Behaviour |
|---|---|
| **Buy now** on a product page | Straight to that machine's Stripe page |
| One machine in the basket | Checkout shows **Pay securely with Stripe** |
| Two or more *different* machines | Checkout explains they must be paid for one at a time, or invoiced — unless the Worker below is running |
| A machine with no link pasted in | Checkout says payment is not switched on and routes to an enquiry, rather than pretending |

## Multi-machine baskets, and the admin dashboard

`analytics-worker.js` is an optional Cloudflare Worker serving three routes:

- `POST /event` and `GET /stats` — the data behind `/admin.html`. Without an endpoint the
  dashboard shows nothing rather than inventing figures.
- `POST /checkout` — creates a Stripe Checkout Session for a basket holding more than one
  machine. It reads prices from Stripe rather than from the browser, so a tampered basket
  cannot change what is charged.

Deploy it with Wrangler, put the secret key in with `wrangler secret put STRIPE_SECRET_KEY`
— never in the file — and set `analyticsEndpoint` and `checkoutEndpoint` in each store's
`site-config.js`.
