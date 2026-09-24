#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create a Stripe Payment Link for every machine on every store, in one run.

Stripe has no API that accepts an account email and password, and it should not
-- those credentials control your money and are second-factor gated. What it
does have is a RESTRICTED API KEY: a credential you create yourself, scoped to
exactly the three things this script needs, revocable in one click, and useless
for anything else. That is what this uses.

    1. Stripe Dashboard -> Developers -> API keys -> Create restricted key
    2. Give it WRITE on:  Products,  Prices,  Payment links
       and READ on:     Account   -- so this can check the key opens the
                                     account you think it does.
       Leave everything else on "None".
    3. Run:  STRIPE_API_KEY=rk_live_... python3 setup-payment-links.py

It reads each store's live catalogue, so it always matches what is actually on
sale, and it is safe to run repeatedly: products are created with fixed ids and
reused, prices are reused when the amount still matches, and a machine that
already has a link is left alone. Nothing is deleted, ever.

Run it from inside a store repo and it does that store; run it from anywhere
else and it does all four. --dry-run shows what it would create and changes
nothing. --write pastes the resulting links straight into site-config.js;
without it the script only prints them.

Requires nothing but Python 3. Do not commit your key, and do not paste it into
a chat window -- roll it in the Dashboard if you ever do.
"""
import argparse, json, os, re, sys, urllib.error, urllib.parse, urllib.request

# A product name can carry a non-ASCII character, and Windows' console defaults
# to a codepage that cannot encode it -- crashing a plain print() before
# anything reaches Stripe. UTF-8 output fixes that everywhere, harmlessly.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

API = "https://api.stripe.com/v1"

STORES = {
    "terrahaul": "terrahaul.shop",
}


# ----------------------------------------------------------------- transport --
def call(key, method, path, data=None):
    url = f"{API}{path}"
    body = None
    if data is not None:
        body = urllib.parse.urlencode(flatten(data), doseq=False).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Stripe-Version", "2024-06-20")
    if body:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = json.load(e).get("error", {})
        if e.code == 404:
            return None
        msg = str(detail.get("message", e.reason))
        hint = ""
        if e.code in (401, 403):
            # Stripe answers 401 both for a key it has never seen and for a real
            # key that lacks the scope. Only the second is a permissions problem,
            # and guessing wrong sends you off to fix something that was never
            # broken.
            hint = ("That key does not exist. Check you pasted a real key and not\n"
                    "the placeholder from the instructions.\n"
                    if "Invalid API Key" in msg else
                    "Your restricted key is missing a permission. It needs WRITE on\n"
                    "Products, Prices and Payment links.\n")
        raise SystemExit(f"\nStripe refused {method} {path}: {msg}\n" + hint)


def probe_account(key):
    """Who does this key belong to? Answered without dying, because a restricted
       key may lack Account read -- not knowing is a weaker problem than being
       unable to run at all."""
    try:
        return call(key, "GET", "/account"), None
    except SystemExit as e:
        return None, str(e).strip().splitlines()[0]


def flatten(d, prefix=""):
    """Stripe takes form encoding with bracket notation, not JSON."""
    out = {}
    for k, v in d.items():
        key = f"{prefix}[{k}]" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        elif isinstance(v, (list, tuple)):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    out.update(flatten(item, f"{key}[{i}]"))
                else:
                    out[f"{key}[{i}]"] = item
        elif isinstance(v, bool):
            out[key] = "true" if v else "false"
        elif v is not None:
            out[key] = v
    return out


def detect_store_repo():
    """Run from inside a store repo, the CNAME beside this script names the store.
       That is the normal case, so it becomes the default rather than something
       you have to spell out."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cname = os.path.join(root, "CNAME")
    if os.path.exists(cname):
        domain = open(cname, encoding="utf-8").read().strip()
        for store, d in STORES.items():
            if d == domain:
                return store, root
    return None, None


# ------------------------------------------------------------------ catalogue --
def catalogue(store, domain, local, repo_root=None):
    """The machines actually on sale, read from the store's own catalogue."""
    if repo_root:
        src = open(f"{repo_root}/assets/js/catalogue.js", encoding="utf-8").read()
    elif local:
        src = open(f"{local}/{store}/assets/js/catalogue.js", encoding="utf-8").read()
    else:
        with urllib.request.urlopen(f"https://{domain}/assets/js/catalogue.js", timeout=30) as r:
            src = r.read().decode("utf-8")
    m = re.search(r"window\.CATALOGUE\s*=\s*(\{.*\})\s*;", src, re.S)
    if not m:
        raise SystemExit(f"{store}: could not read catalogue.js")
    return json.loads(m.group(1))


# --------------------------------------------------------------------- upsert --
def product_for(key, sku, item, domain):
    """One Stripe product per machine, at a fixed id so re-runs reuse it."""
    pid = "machine_" + re.sub(r"[^A-Za-z0-9_]", "_", sku)
    existing = call(key, "GET", f"/products/{pid}")
    payload = {
        "name": item["name"],
        "url": f"https://{domain}/{item['url']}",
        "images": [f"https://{domain}/{item['img']}"],
        "metadata": {"sku": sku, "store": domain},
        "shippable": True,
    }
    if existing:
        return call(key, "POST", f"/products/{pid}", payload)
    return call(key, "POST", "/products", dict(payload, id=pid))


def price_for(key, product, amount_pence, vat_inclusive):
    for p in call(key, "GET", f"/prices?product={product['id']}&active=true&limit=100")["data"]:
        if p["unit_amount"] == amount_pence and p["currency"] == "gbp":
            return p
    body = {"product": product["id"], "unit_amount": amount_pence, "currency": "gbp"}
    if vat_inclusive:
        body["tax_behavior"] = "inclusive"
    return call(key, "POST", "/prices", body)


def link_for(key, sku, price, domain, existing_links):
    if sku in existing_links:
        return existing_links[sku], False
    body = {
        "line_items": [{"price": price["id"], "quantity": 1,
                        "adjustable_quantity": {"enabled": True, "minimum": 1, "maximum": 5}}],
        "metadata": {"sku": sku},
        "shipping_address_collection": {"allowed_countries": ["GB"]},
        "phone_number_collection": {"enabled": True},
        # The carrier telephones to book a slot, and nothing else on a static
        # site ever gets the chance to ask about access.
        "custom_fields": [{
            "key": "access", "type": "text",
            "label": {"type": "custom", "custom": "Delivery access notes"},
            "optional": True,
        }],
        "after_completion": {"type": "redirect",
                             "redirect": {"url": f"https://{domain}/track-order.html"}},
    }
    return call(key, "POST", "/payment_links", body)["url"], True


def existing_links_by_sku(key):
    out, params = {}, "?limit=100&active=true"
    while True:
        page = call(key, "GET", f"/payment_links{params}")
        for l in page["data"]:
            sku = (l.get("metadata") or {}).get("sku")
            if sku and sku not in out:
                out[sku] = l["url"]
        if not page.get("has_more"):
            return out
        params = f"?limit=100&active=true&starting_after={page['data'][-1]['id']}"


# ----------------------------------------------------------------------- write --
def write_worker_prices(path, prices):
    """The Worker resolves a basket by price id, so it needs the ids the run
       just produced. Written, never transcribed -- in a terminal font "l" and
       "1" are the same glyph, and a wrong id fails at the payment step."""
    if not os.path.exists(path):
        return False
    src = open(path, encoding="utf-8").read()
    body = ",\n".join(f"  '{sku}': '{pid}'" for sku, pid in prices.items())
    new, n = re.subn(r"const PRICES = \{.*?\n\};",
                     "const PRICES = {\n" + body + ",\n};", src, flags=re.S)
    if n != 1:
        raise SystemExit(f"{path}: could not find the PRICES block to replace")
    open(path, "w", encoding="utf-8").write(new)
    return True


def write_config(path, links):
    """Replace only the paymentLinks block, leaving every other setting alone."""
    src = open(path, encoding="utf-8").read()
    block = "  paymentLinks: {\n" + "\n".join(
        f'    "{sku}": "{url}",' for sku, url in links.items()).rstrip(",") + "\n  }"
    new, n = re.subn(r"  paymentLinks: \{.*?\n  \}", block, src, flags=re.S)
    if n != 1:
        raise SystemExit(f"{path}: could not find the paymentLinks block to replace")
    open(path, "w", encoding="utf-8").write(new)


# ------------------------------------------------------------------------ main --
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", action="append", choices=sorted(STORES),
                    help="limit to one store; repeatable. Default: all four.")
    ap.add_argument("--local", metavar="SITES_DIR",
                    help="read catalogues from a local sites/ directory instead of the live sites")
    ap.add_argument("--write", action="store_true",
                    help="paste the links into the store's site-config.js")
    ap.add_argument("--dry-run", action="store_true",
                    help="show what would be created and change nothing")
    ap.add_argument("--any-account", action="store_true",
                    help="skip the check that the key belongs to this store's own "
                         "Stripe account. You almost never want this.")
    ap.add_argument("--vat-inclusive", action="store_true",
                    help="mark prices VAT-inclusive. Only if the company is VAT registered.")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY", "").strip()
    if not key:
        raise SystemExit("Set STRIPE_API_KEY to a restricted key, e.g.\n"
                         "  STRIPE_API_KEY=rk_live_... python3 setup-payment-links.py")
    if not key.startswith(("sk_", "rk_")):
        # Catch the placeholder here rather than let Stripe reject it, which it
        # does with a 401 that reads like a permissions problem.
        raise SystemExit(f"STRIPE_API_KEY is not a Stripe key: {key[:12]}...\n"
                         "It should start sk_ or rk_. Did you paste the placeholder?")
    if key.startswith("sk_"):
        print("! That is an unrestricted secret key. It works, but a restricted key with\n"
              "  write on Products, Prices and Payment links is the safer thing to use here.\n",
              file=sys.stderr)
    repo_store, repo_root = detect_store_repo()
    if repo_root:
        print(f"Running inside the {repo_store} repo ({repo_root}).")
        if not args.store and not args.local:
            args.store = [repo_store]
    if args.write and not (args.local or repo_root):
        raise SystemExit("--write needs --local, or to be run from inside a store repo")

    mode = "TEST" if key.startswith(("sk_test", "rk_test")) else "LIVE"
    acct, why = probe_account(key)
    name = ""
    if acct is None:
        print(f"! Cannot read the account name: {why}\n"
              "  Add Read on 'Account' to the restricted key so this can confirm\n"
              "  the key belongs to the right store.\n", file=sys.stderr)
    else:
        name = acct.get("settings", {}).get("dashboard", {}).get("display_name") or ""
        print(f"Stripe account: {name or acct['id']}  ({mode} mode)\n")

    # One store, one Stripe account. A key from the wrong account creates this
    # store's machines in another business's books, and --write then publishes
    # those links to the live site -- so a customer's money lands there too,
    # with nothing on screen to say so.
    want = sorted(STORES)[0]
    if name and len(STORES) == 1 and not args.any_account:
        if want not in re.sub(r"[^a-z0-9]", "", name.lower()):
            raise SystemExit(
                f"\nThis key opens the Stripe account {name!r}, but you are setting up\n"
                f"{want}. Payment for a {want} machine would be collected by {name!r}.\n\n"
                f"Use a key from {want}'s own Stripe account. If you genuinely mean to\n"
                f"use this one, pass --any-account.")

    known = existing_links_by_sku(key)
    for store in (args.store or sorted(STORES)):
        domain = STORES[store]
        root = repo_root if store == repo_store else None
        items = catalogue(store, domain, args.local, root)
        print(f"{store} ({domain})")
        links = {}
        price_ids = {}
        for sku, item in items.items():
            if args.dry_run:
                have = sku in known
                print(f"  {'would keep  ' if have else 'would create'}  {sku:12} "
                      f"£{item['price']:>6,}  {item['name']}")
                continue
            product = product_for(key, sku, item, domain)
            price = price_for(key, product, item["price"] * 100, args.vat_inclusive)
            url, made = link_for(key, sku, price, domain, known)
            links[sku] = known[sku] = url
            price_ids[sku] = price["id"]
            # A price id grants no access on its own, unlike an API key, so it
            # is safe to print. It is what the Worker needs for multi-item
            # baskets, which Payment Links cannot do.
            print(f"  {'created' if made else 'reused '}  {sku:12} £{item['price']:>6,}  "
                  f"{price['id']:<28} {url}")
        if args.write and not args.dry_run:
            base = root or f"{args.local}/{store}"
            write_config(f"{base}/assets/js/site-config.js", links)
            print(f"  written to {base}/assets/js/site-config.js")
            ids_path = f"{base}/stripe/price_ids.json"
            os.makedirs(os.path.dirname(ids_path), exist_ok=True)
            json.dump(price_ids, open(ids_path, "w", encoding="utf-8"), indent=2)
            print(f"  written to {ids_path}")
            worker = f"{base}/stripe/analytics-worker.js"
            if write_worker_prices(worker, price_ids):
                print(f"  written to {worker}  (redeploy the Worker to apply)")
        print()

    if args.dry_run:
        print("Dry run: nothing was created. Drop --dry-run to do it for real.")
    else:
        print("Done. Commit the site-config.js changes, or paste the URLs in "
              "through /admin.html.")


if __name__ == "__main__":
    main()
