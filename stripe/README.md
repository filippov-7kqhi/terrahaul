# Payments and the Worker: TerraHaul

## How terrahaul.shop takes payment

| Basket | Route |
|---|---|
| One machine | Its Stripe Payment Link, from `paymentLinks` in `assets/js/site-config.js` |
| Several machines | `POST /checkout` on the Worker, which opens one Stripe Checkout Session |

The Worker prices a basket from the Stripe price ids in `analytics-worker.js`
(`PRICES`), never from the browser, so an edited basket cannot change what is
charged. The same Worker feeds `/admin.html`: `POST /event` records visits and
`GET /stats` returns them, stored in the KV namespace `terrahaul-EVENTS`.

- Worker: `https://terrahaul-collector.stellapark1141.workers.dev`
- Config: `stripe/wrangler.toml`

## Update products, prices and payment links

This store shares a Stripe account with the others, so `--any-account` is
needed: without it the script refuses a key whose account name is not TerraHaul.
Run in PowerShell; paste the whole block, and it asks for the key once:

```powershell
& {
  $env:STRIPE_API_KEY = (Read-Host "Paste the Stripe key and press Enter").Trim()
  Set-Location "C:\Users\Hp\uk-stores\terrahaul\stripe"
  & "C:\Users\Hp\AppData\Local\Programs\Python\Python312\python.exe" setup-payment-links.py --any-account --write
  Remove-Item Env:STRIPE_API_KEY
}
```

It is safe to repeat. Products keep fixed ids, prices are reused while the amount
matches, and existing links are left alone (they print as `reused`). `--write`
updates the links in `site-config.js`, the price ids in `analytics-worker.js` and
`price_ids.json`. Nothing is ever deleted.

## Deploy the Worker and set its secrets

Call `wrangler.cmd`, not `wrangler`: PowerShell's execution policy blocks the
`.ps1` shim. Set secrets with `secret bulk` from a file. Typing a secret at
`wrangler secret put`'s prompt stored only its first character on this machine.

```powershell
& {
  $w = "C:\Users\Hp\AppData\Roaming\npm\wrangler.cmd"
  $key = (Read-Host "Paste the Stripe key and press Enter").Trim()
  Set-Location "C:\Users\Hp\uk-stores\terrahaul\stripe"
  & $w deploy
  $tmp = "$env:TEMP\stripe-secret.json"
  @{ STRIPE_SECRET_KEY = $key } | ConvertTo-Json | Set-Content $tmp -Encoding ascii
  & $w secret bulk $tmp
  Remove-Item $tmp
}
```

`ADMIN_HASH` is the `passHash` from `site-config.js`, set the same way.

## Do not

- commit a key, or paste one into a chat. Roll it in the Stripe Dashboard if you do.
- delete the KV namespace `terrahaul-EVENTS`. It holds the dashboard's data.
- type a key after `secret put NAME`. The name is the name; the value goes through the file.
