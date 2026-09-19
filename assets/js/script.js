/* Shared store behaviour. Basket lives in this browser only — nothing is sent anywhere. */
(function () {
  'use strict';

  function sha256Sync(str) {
    var K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  
    var b = [], i, c;
    for (i = 0; i < str.length; i++) {          // UTF-8 encode
      c = str.charCodeAt(i);
      if (c < 0x80) b.push(c);
      else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c >= 0xe000) b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++;
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        b.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
  
    var bitLen = b.length * 8;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor(bitLen / 4294967296);
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
           (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
  
    var rr = function (v, n) { return (v >>> n) | (v << (32 - n)); };
    var w = new Array(64);
    for (var off = 0; off < b.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (b[off+i*4] << 24) | (b[off+i*4+1] << 16) | (b[off+i*4+2] << 8) | b[off+i*4+3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3);
        var s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
      }
      var a=H[0],bb=H[1],cc=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
        var mj = (a & bb) ^ (a & cc) ^ (bb & cc);
        var t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=cc; cc=bb; bb=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+bb)|0; H[2]=(H[2]+cc)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
  }

  var KEY = 'basket.v1';

  function money(n) {
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function catalogue() { return window.CATALOGUE || {}; }

  /** Raw basket: item codes and quantities only. */
  function read() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (err) { return []; }
    if (!Array.isArray(raw)) return [];
    // Baskets saved by older versions kept a full snapshot. Keep the code and
    // quantity, discard the rest — it is resolved live below.
    return raw.filter(function (i) { return i && i.sku; })
              .map(function (i) { return { sku: i.sku, qty: Math.max(1, Math.min(5, i.qty || 1)) }; });
  }

  /** Basket joined to the live catalogue. Anything withdrawn is dropped. */
  function hydrate() {
    var cat = catalogue(), kept = [], dropped = 0;
    read().forEach(function (i) {
      var p = cat[i.sku];
      if (!p) { dropped++; return; }
      kept.push({ sku: i.sku, qty: i.qty, name: p.name, price: p.price, img: p.img, url: p.url });
    });
    if (dropped) write(kept);            // prune withdrawn machines once
    return { items: kept, dropped: dropped };
  }

  function write(items) {
    var lean = items.map(function (i) { return { sku: i.sku, qty: i.qty }; });
    try { localStorage.setItem(KEY, JSON.stringify(lean)); } catch (err) { /* private mode */ }
    paintCount(items);
  }

  function paintCount(items) {
    var n = (items || hydrate().items).reduce(function (t, i) { return t + i.qty; }, 0);
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.hidden = n === 0 && el.classList.contains('cartbadge');
    });
  }

  function totals(items) {
    var gross = items.reduce(function (t, i) { return t + i.price * i.qty; }, 0);
    return { gross: gross, net: gross };
  }

  function paintTotals(items) {
    var t = totals(items);
    var set = function (sel, v) {
      document.querySelectorAll(sel).forEach(function (el) { el.textContent = money(v); });
    };
    set('[data-sum-net]', t.net);
    set('[data-sum-total]', t.gross);
  }

  // ---- Stripe --------------------------------------------------------------
  function cfg() { return window.SITE_CONFIG || window.STRIPE_CONFIG || {}; }

  function linkFor(sku) {
    var links = cfg().paymentLinks || {};
    return (links[sku] || '').trim();
  }

  /** A basket is payable by Payment Link only when it holds one distinct machine. */
  function singleLine(items) {
    return items.length === 1 ? items[0] : null;
  }

  function goToPaymentLink(url, item) {
    var u = url;
    // Stripe reads these from the query string on a Payment Link.
    u += (u.indexOf('?') === -1 ? '?' : '&') +
         'client_reference_id=' + encodeURIComponent(item.sku);
    window.location.href = u;
  }


  // ---- analytics beacon ----------------------------------------------------
  // Sends only what the dashboard counts: a path, an event name and an item code.
  // No cookies, no identifiers, no personal data — see the privacy policy.
  (function () {
    var ep = (cfg().analyticsEndpoint || '').trim().replace(/\/$/, '');
    if (!ep) return;

    var sid;
    try {
      sid = sessionStorage.getItem('sid');
      if (!sid) {
        sid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
        sessionStorage.setItem('sid', sid);
      }
    } catch (e) { sid = 'anon'; }

    window.track = function (type, label, sku) {
      var body = JSON.stringify({
        type: type, label: label || location.pathname, sku: sku || '', sid: sid
      });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(ep + '/event', new Blob([body], { type: 'application/json' }));
        } else {
          fetch(ep + '/event', { method: 'POST', body: body, keepalive: true,
                                 headers: { 'Content-Type': 'application/json' } });
        }
      } catch (e) { /* never let tracking break the page */ }
    };

    var page = document.body.getAttribute('data-page') || location.pathname;
    window.track('PageView', page);

    var prod = document.querySelector('[data-add]');
    if (prod && document.getElementById('galMain')) {
      window.track('ViewContent', prod.dataset.name, prod.dataset.add);
    }
    if (document.getElementById('checkoutItems')) window.track('InitiateCheckout', 'checkout');
  })();

  // ---- add to basket -------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-add]');
    if (!btn) return;
    ev.preventDefault();
    var qty = 1;
    if (btn.dataset.qty) {
      var input = document.querySelector(btn.dataset.qty);
      qty = Math.max(1, Math.min(5, parseInt(input && input.value, 10) || 1));
    }
    var items = read();
    var found = items.filter(function (i) { return i.sku === btn.dataset.add; })[0];
    if (found) {
      found.qty = Math.min(5, found.qty + qty);
    } else {
      items.push({ sku: btn.dataset.add, qty: qty });
    }
    write(items);
    var entry = catalogue()[btn.dataset.add];
    if (window.track) window.track('AddToCart', entry ? entry.name : btn.dataset.add, btn.dataset.add);
    if (btn.hasAttribute('data-buynow')) {
      var direct = linkFor(btn.dataset.add);
      if (direct) {
        goToPaymentLink(direct, { sku: btn.dataset.add });
      } else {
        window.location.href = 'checkout.html';
      }
      return;
    }
    var note = document.querySelector('[data-added]');
    if (note) { note.hidden = false; }
    btn.classList.add('is-added');
    var label = btn.textContent;
    btn.textContent = 'Added to basket';
    setTimeout(function () { btn.textContent = label; btn.classList.remove('is-added'); }, 1600);
  });

  // ---- basket page ---------------------------------------------------------
  var list = document.getElementById('cartItems');
  if (list) {
    var render = function () {
      var h = hydrate(), items = h.items;
      var notice = document.getElementById('cartNotice');
      if (notice) {
        notice.hidden = !h.dropped;
        notice.textContent = h.dropped === 1
          ? 'One machine was removed from your basket because it is no longer sold.'
          : h.dropped + ' machines were removed from your basket because they are no longer sold.';
      }
      var empty = document.getElementById('cartEmpty');
      var summary = document.getElementById('cartSummary');
      empty.hidden = items.length > 0;
      summary.hidden = items.length === 0;
      list.innerHTML = items.map(function (i) {
        return '<div class="cartitem" data-sku="' + i.sku + '">' +
          '<a href="' + i.url + '"><img src="' + i.img + '" width="1200" height="760" alt="" ' +
          'onerror="this.style.visibility=\'hidden\'"></a>' +
          '<div><h3><a href="' + i.url + '">' + i.name + '</a></h3>' +
          '<p class="line">' + money(i.price) + ' each</p>' +
          '<label class="line">Qty <input type="number" min="1" max="5" value="' + i.qty +
          '" data-qty-for="' + i.sku + '"></label></div>' +
          '<div class="cartitem__right"><b>' + money(i.price * i.qty) + '</b>' +
          '<button class="linkbtn" data-remove="' + i.sku + '">Remove</button></div></div>';
      }).join('');
      paintTotals(items);
      paintCount(items);
    };
    list.addEventListener('click', function (ev) {
      var rm = ev.target.closest('[data-remove]');
      if (!rm) return;
      write(hydrate().items.filter(function (i) { return i.sku !== rm.dataset.remove; }));
      render();
    });
    var applyQty = function (f) {
      var items = hydrate().items;
      items.forEach(function (i) {
        if (i.sku === f.dataset.qtyFor) i.qty = Math.max(1, Math.min(5, parseInt(f.value, 10) || 1));
      });
      write(items);
      // update this row and the totals in place so the field keeps focus
      var row = f.closest('.cartitem');
      var it = items.filter(function (i) { return i.sku === f.dataset.qtyFor; })[0];
      if (row && it) row.querySelector('.cartitem__right b').textContent = money(it.price * it.qty);
      paintTotals(items);
    };
    ['input', 'change'].forEach(function (evt) {
      list.addEventListener(evt, function (ev) {
        var f = ev.target.closest('[data-qty-for]');
        if (f) applyQty(f);
      });
    });
    render();
  }

  // ---- checkout page -------------------------------------------------------
  var payReady = document.getElementById('payReady');
  if (payReady) {
    var items = hydrate().items;
    if (!items.length) { window.location.replace('cart.html'); return; }

    document.getElementById('checkoutItems').innerHTML = items.map(function (i) {
      return '<div><span>' + i.name + ' &times; ' + i.qty + '</span><span>' +
             money(i.price * i.qty) + '</span></div>';
    }).join('');
    paintTotals(items);

    var box = document.getElementById('ckResult');
    var say = function (html) { box.className = 'result show'; box.innerHTML = html; };

    var endpoint = (cfg().checkoutEndpoint || '').trim();
    var only = singleLine(items);
    var link = only ? linkFor(only.sku) : '';

    if (endpoint) {
      // Any basket, including several different machines.
      payReady.hidden = false;
      document.getElementById('payBtn').addEventListener('click', function (ev) {
        var b = ev.currentTarget;
        b.disabled = true;
        b.textContent = 'Contacting Stripe…';
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map(function (i) { return { sku: i.sku, qty: i.qty }; })
          })
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (d) {
          if (!d.url) throw new Error('no session url');
          window.location.href = d.url;
        }).catch(function (err) {
          b.disabled = false;
          b.textContent = 'Pay securely with Stripe';
          say('<strong>We could not start the payment.</strong> Nothing has been charged. ' +
              'Please try again, or email us and we will take the order directly. ' +
              '<span class="muted">(' + err.message + ')</span>');
        });
      });

    } else if (only && link) {
      // Single machine, paid through its Stripe Payment Link.
      payReady.hidden = false;
      document.getElementById('payBtn').addEventListener('click', function () {
        goToPaymentLink(link, only);
      });
      if (only.qty > 1) {
        say('You have ' + only.qty + ' of this machine in your basket. Set the quantity to ' +
            only.qty + ' on the Stripe page before paying.');
      }

    } else if (items.length > 1) {
      say('<strong>One machine at a time.</strong> Card payment currently handles a single ' +
          'machine per order. Remove all but one from your <a href="cart.html">basket</a> and pay, ' +
          'then repeat for the next &mdash; or <a href="contact.html">contact us</a> and we will ' +
          'raise one invoice for the lot.');

    } else {
      say('<strong>Card payment is not switched on yet.</strong> No order has been placed and no ' +
          'money has been taken. <a href="contact.html">Send us an enquiry</a> and we will take ' +
          'the order directly.');
    }
  }

  // ---- mobile nav ----------------------------------------------------------
  var burger = document.getElementById('burger'), nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  // ---- reveal on scroll ----------------------------------------------------
  var els = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && els.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: .12 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- product gallery -----------------------------------------------------
  var main = document.getElementById('galMain'), thumbs = document.getElementById('galThumbs');
  if (main && thumbs) {
    thumbs.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      main.src = b.dataset.full;
      main.alt = b.dataset.alt || main.alt;
      thumbs.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
    });
  }

  // ---- enquiry forms (no backend wired up) ---------------------------------
  document.querySelectorAll('form[data-demo]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      var box = form.parentElement.querySelector('.result');
      if (box) { box.className = 'result show'; box.textContent = form.dataset.demo; }
      form.reset();
    });
  });


  // ---- business identity from config --------------------------------------
  (function () {
    var biz = cfg().business || {};

    // Address on one line, skipping any part that has not been supplied.
    var addr = document.querySelector('[data-biz-addr]');
    if (addr) {
      // Town and postcode sit together without a comma, as UK addresses are written.
      var town = [(biz.city || '').trim(), (biz.postcode || '').trim()].filter(Boolean).join(' ');
      var supplied = [(biz.street || '').trim(), town].filter(Boolean);
      if (supplied.length) {
        addr.textContent = supplied.concat('United Kingdom').join(', ');
        addr.hidden = false;
      } else if (!addr.textContent.trim()) {
        addr.hidden = true;
      }
    }

    document.querySelectorAll('[data-biz]').forEach(function (el) {
      var v = (biz[el.dataset.biz] || '').trim() || el.textContent.trim();
      if (!v) {
        // Nothing supplied for this field, so show nothing rather than an empty line.
        if (el.hasAttribute('data-hide-if-unset')) el.hidden = true;
        return;
      }
      el.textContent = (el.dataset.prefix || '') + v;
      el.hidden = false;
      if (el.tagName === 'A' && !el.getAttribute('href')) {
        el.setAttribute('href', 'tel:' + v.replace(/[^+0-9]/g, ''));
      }
    });
  })();

  // ---- admin config editor -------------------------------------------------
  var gate = document.getElementById('gate');
  if (gate) {
    var panel = document.getElementById('panel');
    var out = document.getElementById('out');

    var sha256 = function (text) {
      // crypto.subtle only exists in a secure context, so it is absent over plain http.
      if (window.isSecureContext && window.crypto && window.crypto.subtle) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
          .then(function (buf) {
            return [].map.call(new Uint8Array(buf), function (b) {
              return b.toString(16).padStart(2, '0');
            }).join('');
          });
      }
      return Promise.resolve(sha256Sync(text));
    };

    if (location.protocol === 'http:') {
      var warn = document.getElementById('httpWarn');
      if (warn) warn.hidden = false;
    }

    var linkInputs = function () { return document.querySelectorAll('[data-link]'); };
    var bizInputs = function () { return document.querySelectorAll('[data-biz-field]'); };

    var load = function () {
      var c = cfg(), links = c.paymentLinks || {}, biz = c.business || {};
      linkInputs().forEach(function (i) { i.value = links[i.dataset.link] || ''; });
      bizInputs().forEach(function (i) { i.value = biz[i.dataset.bizField] || ''; });
    };

    var render = function () {
      var c = cfg();
      var links = {}, biz = {};
      linkInputs().forEach(function (i) { links[i.dataset.link] = i.value.trim(); });
      bizInputs().forEach(function (i) { biz[i.dataset.bizField] = i.value.trim(); });
      var pad = function (k) { return '"' + k + '":' + ' '.repeat(Math.max(1, 12 - k.length)); };
      out.value =
        '/* Runtime configuration. THIS FILE IS PUBLIC.\n' +
        '   Never put a Stripe secret key (sk_live_... / sk_test_...) in it. */\n' +
        'window.SITE_CONFIG = {\n' +
        '  admin: { passHash: "' + ((c.admin && c.admin.passHash) || '') + '" },\n\n' +
        '  business: {\n' +
        Object.keys(biz).map(function (k) {
          return '    ' + pad(k) + '"' + biz[k].replace(/"/g, '\\"') + '"';
        }).join(',\n') + '\n  },\n\n' +
        '  checkoutEndpoint: "' + (c.checkoutEndpoint || '') + '",\n\n' +
        '  paymentLinks: {\n' +
        Object.keys(links).map(function (k) {
          return '    "' + k + '": "' + links[k] + '"';
        }).join(',\n') + '\n  }\n};\n';
    };

    gate.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var want = (cfg().admin || {}).passHash || '';
      var msg = document.getElementById('gateMsg');
      sha256(document.getElementById('pass').value).then(function (got) {
        if (got === want) {
          gate.hidden = true;
          panel.hidden = false;
          load();
          render();
        } else {
          msg.textContent = 'That passphrase does not match.';
        }
      }).catch(function (err) {
        msg.textContent = 'Could not check the passphrase: ' + err.message;
      });
    });

    document.addEventListener('input', function (ev) {
      if (ev.target.matches('[data-link],[data-biz-field]')) render();
    });

    document.getElementById('copyBtn').addEventListener('click', function () {
      out.select();
      navigator.clipboard.writeText(out.value).then(function () {
        document.getElementById('saveMsg').textContent =
          'Copied. Open assets/js/site-config.js on GitHub, replace all of it, and commit.';
      }, function () {
        document.getElementById('saveMsg').textContent =
          'Could not reach the clipboard — select the text below and copy it manually.';
      });
    });

    document.getElementById('dlBtn').addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/javascript' }));
      a.download = 'site-config.js';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById('hashForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = document.getElementById('newpass').value;
      if (!v) return;
      sha256(v).then(function (h) {
        document.getElementById('hashOut').textContent = h;
      });
    });
  }

  document.querySelectorAll('[data-year]').forEach(function (n) {
    n.textContent = new Date().getFullYear();
  });

  paintCount();
})();
