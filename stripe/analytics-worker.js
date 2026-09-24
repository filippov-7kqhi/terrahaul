/**
 * Store data collector — feeds the /admin.html dashboard.
 *
 * GitHub Pages has no server, so a static store cannot count visitors, hold
 * orders or total revenue by itself. This Worker does both jobs:
 *
 *   POST /event   store pages send page views, product views, basket adds
 *   GET  /stats   the admin dashboard reads aggregates (and live Stripe orders)
 *   POST /checkout  optional: Checkout Session for multi-machine baskets
 *
 * Deploy (free tier is ample for a store this size):
 *   npm i -g wrangler
 *   wrangler kv namespace create EVENTS
 *   wrangler deploy
 *   wrangler secret put STRIPE_SECRET_KEY     # sk_live_… — NEVER commit this
 *   wrangler secret put ADMIN_HASH            # the passHash from site-config.js
 *
 * wrangler.toml:
 *   name = "store-collector"
 *   main = "analytics-worker.js"
 *   compatibility_date = "2026-01-01"
 *   kv_namespaces = [{ binding = "EVENTS", id = "<from the create command>" }]
 *
 * Then paste the Worker URL into Settings → Analytics endpoint in the admin.
 */

const ALLOWED = ['https://terrahaul.shop'];
const DAY = 86400e3;
const LIVE_WINDOW = 5 * 60e3;
const KEEP = 7 * DAY;

const PRICES = {
  'TH-CREX6M': 'price_1UJ2XyGd7L8SA737vXbzR0qs',
  'TH-DP5000': 'price_1UJ2Y1Gd7L8SA737DFNGfTOf',
  'TH-TW1375G': 'price_1UJ2Y4Gd7L8SA737FXyoNQpv',
  'TH-360SW': 'price_1UJ2Y6Gd7L8SA737nMw0u8Wx',
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin',
      'Access-Control-Allow-Credentials': 'true',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const path = new URL(request.url).pathname.replace(/\/$/, '');

    if (path === '/event' && request.method === 'POST') return collect(request, env, cors);
    if (path === '/stats' && request.method === 'GET') return stats(request, env, cors);
    if (path === '/checkout' && request.method === 'POST') return checkout(request, env, cors, origin);
    return json({ error: 'not found' }, 404, cors);
  },
};

/* ---------------------------------------------------------------- collect -- */
async function collect(request, env, cors) {
  let e;
  try { e = await request.json(); } catch { return json({ error: 'bad json' }, 400, cors); }

  const type = String(e.type || '').slice(0, 24);
  if (!type) return json({ error: 'no type' }, 400, cors);

  const rec = {
    type,
    label: String(e.label || '').slice(0, 160),
    sku: String(e.sku || '').slice(0, 24),
    sid: String(e.sid || '').slice(0, 32),
    ts: Date.now(),
  };
  // One key per event; the ts prefix makes range reads cheap and expiry automatic.
  await env.EVENTS.put(`e:${rec.ts}:${Math.random().toString(36).slice(2, 8)}`,
    JSON.stringify(rec), { expirationTtl: KEEP / 1000 });
  return json({ ok: true }, 200, cors);
}

/* ------------------------------------------------------------------ stats -- */
async function stats(request, env, cors) {
  if (env.ADMIN_HASH && request.headers.get('X-Admin') !== env.ADMIN_HASH) {
    return json({ error: 'unauthorised' }, 401, cors);
  }

  const now = Date.now();
  const events = [];
  let cursor;
  do {
    const page = await env.EVENTS.list({ prefix: 'e:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const v = await env.EVENTS.get(k.name);
      if (v) events.push(JSON.parse(v));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const day = events.filter((x) => now - x.ts < DAY);
  // Funnel stages count DISTINCT SESSIONS, not raw events. Counting events lets a
  // reloaded checkout page outnumber basket adds and produce rates above 100%.
  const sessions = (t) => new Set(day.filter((x) => x.type === t).map((x) => x.sid)).size;
  const count = (t) => day.filter((x) => x.type === t).length;
  const live = new Set(events.filter((x) => now - x.ts < LIVE_WINDOW).map((x) => x.sid));

  const orders = await stripeOrders(env);
  const dayOrders = orders.filter((o) => now - o.ts < DAY && o.paid);

  // interest per machine, last 7 days
  const byProduct = {};
  for (const x of events) {
    if (!x.sku) continue;
    const p = (byProduct[x.sku] ||= { sku: x.sku, name: x.label, views: 0, adds: 0, buys: 0 });
    if (x.type === 'ViewContent') p.views++;
    if (x.type === 'AddToCart') p.adds++;
    if (x.type === 'Purchase') p.buys++;
  }

  // a session that started checkout and never paid
  const paidSids = new Set(events.filter((x) => x.type === 'Purchase').map((x) => x.sid));
  const abandoned = [];
  const seen = new Set();
  for (const x of events) {
    if (x.type !== 'InitiateCheckout' || paidSids.has(x.sid) || seen.has(x.sid)) continue;
    if (now - x.ts < 3600e3) continue;               // still in progress
    seen.add(x.sid);
    const item = events.find((y) => y.sid === x.sid && y.type === 'AddToCart');
    abandoned.push({ item: item ? item.label : 'Unknown', valuePence: 0, stage: 'Checkout', ts: x.ts });
  }

  const customers = {};
  for (const o of orders.filter((o) => o.paid)) {
    const c = (customers[o.email] ||= { email: o.email, orders: 0, spentPence: 0, lastTs: 0 });
    c.orders++; c.spentPence += o.amountPence; c.lastTs = Math.max(c.lastTs, o.ts);
  }

  return json({
    active: live.size,
    day: {
      pageViews: count('PageView'),          // raw views, as a traffic figure
      productViews: count('ViewContent'),
      addToCart: sessions('AddToCart'),      // funnel stages: unique sessions
      checkoutStarted: sessions('InitiateCheckout'),
      purchased: dayOrders.length,
      orders: dayOrders.length,
      revenuePence: dayOrders.reduce((t, o) => t + o.amountPence, 0),
    },
    activity: events.sort((a, b) => b.ts - a.ts).slice(0, 40),
    visitors: [...live].map((sid) => {
      const last = events.filter((x) => x.sid === sid).sort((a, b) => b.ts - a.ts)[0];
      return { path: last ? last.label : '/', since: last ? last.ts : now };
    }),
    orders: orders.slice(0, 50),
    customers: Object.values(customers).sort((a, b) => b.lastTs - a.lastTs),
    abandoned: abandoned.sort((a, b) => b.ts - a.ts).slice(0, 50),
    products: Object.values(byProduct).sort((a, b) => b.views - a.views),
  }, 200, cors);
}

async function stripeOrders(env) {
  if (!env.STRIPE_SECRET_KEY) return [];
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions?limit=50&expand[]=data.line_items', {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.data || []).map((s) => ({
    id: s.id.slice(-10),
    item: s.line_items?.data?.[0]?.description || '—',
    email: s.customer_details?.email || '—',
    amountPence: s.amount_total || 0,
    paid: s.payment_status === 'paid',
    status: s.payment_status || 'unpaid',
    ts: (s.created || 0) * 1000,
  }));
}

/* --------------------------------------------------------------- checkout -- */
async function checkout(request, env, cors, origin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: 'empty basket' }, 400, cors);

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${origin}/index.html?paid=1`);
  form.set('cancel_url', `${origin}/cart.html`);
  form.set('shipping_address_collection[allowed_countries][0]', 'GB');
  form.set('phone_number_collection[enabled]', 'true');
  items.forEach((it, i) => {
    const price = PRICES[it.sku];
    if (!price) return;
    form.set(`line_items[${i}][price]`, price);
    form.set(`line_items[${i}][quantity]`, String(Math.max(1, Math.min(5, parseInt(it.qty, 10) || 1))));
  });

  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const text = await res.text();
  let s;
  try { s = JSON.parse(text); }
  catch { return json({ error: `Stripe returned status ${res.status} (key length ${key.length}): ${text.slice(0, 300)}` }, 502, cors); }
  if (!res.ok) return json({ error: s.error?.message || 'stripe error' }, 502, cors);
  return json({ url: s.url }, 200, cors);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
