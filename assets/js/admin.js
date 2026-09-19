/* Admin dashboard. Reads live figures from the analytics worker when one is
   configured; shows nothing rather than inventing numbers when one is not. */
(function () {
  'use strict';

  function cfg() { return window.SITE_CONFIG || {}; }
  function endpoint() { return (cfg().analyticsEndpoint || '').trim().replace(/\/$/, ''); }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // ---- SHA-256: crypto.subtle is absent outside a secure context (plain http) ----
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

  function sha256(text) {
    if (window.isSecureContext && window.crypto && window.crypto.subtle) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
        .then(function (buf) {
          return [].map.call(new Uint8Array(buf), function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
        });
    }
    return Promise.resolve(sha256Sync(text));
  }

  // ---- gate ---------------------------------------------------------------
  var KEY = 'admin.unlocked';
  var gate = $('#gate'), app = $('#app');

  function open_() {
    gate.hidden = true;
    app.hidden = false;
    if (location.protocol === 'http:') $('#httpWarn').hidden = false;
    loadSettings();
    refresh();
  }

  try { if (sessionStorage.getItem(KEY) === '1') open_(); } catch (e) { /* ignore */ }

  gate.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('#gateMsg');
    msg.className = 'gmsg';
    msg.textContent = 'Checking…';
    var want = (cfg().admin || {}).passHash || '';
    sha256($('#pass').value).then(function (got) {
      if (got && got === want) {
        try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
        msg.textContent = '';
        open_();
      } else {
        msg.className = 'gmsg bad';
        msg.textContent = 'That passphrase does not match.';
      }
    }).catch(function (err) {
      msg.className = 'gmsg bad';
      msg.textContent = 'Could not check the passphrase: ' + err.message;
    });
  });

  $('#signout').addEventListener('click', function () {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  // ---- tabs ---------------------------------------------------------------
  $$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
    });
  });

  // ---- rendering helpers --------------------------------------------------
  var nf = new Intl.NumberFormat('en-GB');
  function money(pence) {
    return '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(a, b) {
    if (!b) return '—';
    // A stage can never convert more than everyone who reached the one before it.
    return Math.min(100, a / b * 100).toFixed(1) + '%';
  }
  function when(ts) {
    var d = new Date(ts);
    return isNaN(d) ? '' : d.toLocaleString('en-GB',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function set(k, v) { $$('[data-k="' + k + '"]').forEach(function (n) { n.textContent = v; }); }
  function blank() {
    ['active','pageViews','productViews','addToCart','checkoutStarted','purchased','revenue','r1','r2','r3']
      .forEach(function (k) { set(k, '—'); });
    set('orders', '0');
  }

  var TAGCLASS = { Purchase: 'tag tag--buy', AddToCart: 'tag tag--cart', InitiateCheckout: 'tag tag--cart' };

  function paint(d) {
    var s = d.day || {};
    set('active', nf.format(d.active || 0));
    ['pageViews','productViews','addToCart','checkoutStarted','purchased'].forEach(function (k) {
      set(k, nf.format(s[k] || 0));
    });
    set('revenue', money(s.revenuePence || 0));
    set('orders', nf.format(s.orders || 0));
    set('r1', pct(s.addToCart, s.pageViews));
    set('r2', pct(s.checkoutStarted, s.addToCart));
    set('r3', pct(s.purchased, s.checkoutStarted));

    var feed = d.activity || [];
    $('#feed').innerHTML = feed.length ? feed.map(function (a) {
      return '<div class="frow"><span class="' + (TAGCLASS[a.type] || 'tag') + '">' + esc(a.type) +
        '</span><span class="lbl">' + esc(a.label) + '</span><time>' + when(a.ts) + '</time></div>';
    }).join('') : '<p class="empty">No activity recorded.</p>';

    var vis = d.visitors || [];
    $('#visitors').innerHTML = vis.length ? vis.map(function (v) {
      return '<div class="frow"><span class="tag">Now</span><span class="lbl">' + esc(v.path) +
        '</span><time>' + when(v.since) + '</time></div>';
    }).join('') : '<p class="empty">Nobody browsing at the moment.</p>';

    var o = d.orders || [];
    $('#ordersBody').innerHTML = o.length ? table(
      ['Order', 'Machine', 'Customer', 'Total', 'Status', 'Placed'],
      o.map(function (x) {
        return ['<strong>' + esc(x.id) + '</strong>', esc(x.item), esc(x.email),
          '<strong>' + money(x.amountPence) + '</strong>',
          '<span class="pill pill--' + (x.paid ? 'ok">Paid' : 'warn">' + esc(x.status)) + '</span>',
          when(x.ts)];
      })) : '<p class="empty">No orders to show.</p>';

    var c = d.customers || [];
    $('#customersBody').innerHTML = c.length ? table(
      ['Customer', 'Orders', 'Spent', 'Last seen'],
      c.map(function (x) {
        return ['<strong>' + esc(x.email) + '</strong>', nf.format(x.orders),
          money(x.spentPence), when(x.lastTs)];
      })) : '<p class="empty">No customers yet.</p>';

    var ab = d.abandoned || [];
    $('#abandonedBody').innerHTML = ab.length ? table(
      ['Machine', 'Value', 'Reached', 'When'],
      ab.map(function (x) {
        return [esc(x.item), money(x.valuePence), esc(x.stage), when(x.ts)];
      })) : '<p class="empty">No abandoned baskets recorded.</p>';

    var ins = d.products || [];
    $('#insightsBody').innerHTML = ins.length ? table(
      ['Machine', 'Views', 'Added to basket', 'Purchased', 'View → basket'],
      ins.map(function (x) {
        return ['<strong>' + esc(x.name || x.sku) + '</strong>', nf.format(x.views),
          nf.format(x.adds), nf.format(x.buys), pct(x.adds, x.views)];
      })) : '<p class="empty">No product data yet.</p>';
  }

  function table(head, rows) {
    return '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---- data ---------------------------------------------------------------
  function refresh() {
    var ep = endpoint();
    if (!ep) { $('#noData').hidden = false; blank(); return; }
    $('#noData').hidden = true;
    fetch(ep + '/stats', { headers: { 'X-Admin': (cfg().admin || {}).passHash || '' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(paint)
      .catch(function (err) {
        blank();
        var n = $('#noData');
        n.hidden = false;
        n.innerHTML = '<strong>Could not reach the data collector.</strong> ' +
          'Nothing is shown rather than a stale or invented figure. ' +
          '<span class="muted">(' + esc(err.message) + ')</span>';
      });
  }
  $('#refresh').addEventListener('click', refresh);

  // ---- settings -----------------------------------------------------------
  function loadSettings() {
    var c = cfg(), links = c.paymentLinks || {}, biz = c.business || {};
    $$('[data-link]').forEach(function (i) { i.value = links[i.dataset.link] || ''; });
    $$('[data-biz-field]').forEach(function (i) { i.value = biz[i.dataset.bizField] || ''; });
    $$('[data-cfg]').forEach(function (i) { i.value = c[i.dataset.cfg] || ''; });
    render();
  }

  function render() {
    var c = cfg(), links = {}, biz = {};
    $$('[data-link]').forEach(function (i) { links[i.dataset.link] = i.value.trim(); });
    $$('[data-biz-field]').forEach(function (i) { biz[i.dataset.bizField] = i.value.trim(); });
    var extra = {};
    $$('[data-cfg]').forEach(function (i) { extra[i.dataset.cfg] = i.value.trim(); });
    var q = function (v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; };
    var pad = function (k) { return '"' + k + '":' + ' '.repeat(Math.max(1, 13 - k.length)); };
    $('#out').value =
      '/* Runtime configuration. THIS FILE IS PUBLIC.\n' +
      '   Never put a Stripe secret key (sk_live_... / sk_test_...) in it. */\n' +
      'window.SITE_CONFIG = {\n' +
      '  admin: { passHash: ' + q((c.admin || {}).passHash || '') + ' },\n\n' +
      '  business: {\n' +
      Object.keys(biz).map(function (k) { return '    ' + pad(k) + q(biz[k]); }).join(',\n') +
      '\n  },\n\n' +
      '  analyticsEndpoint: ' + q(extra.analyticsEndpoint || '') + ',\n' +
      '  checkoutEndpoint: ' + q(extra.checkoutEndpoint || '') + ',\n\n' +
      '  paymentLinks: {\n' +
      Object.keys(links).map(function (k) { return '    ' + q(k) + ': ' + q(links[k]); }).join(',\n') +
      '\n  }\n};\n';
  }

  document.addEventListener('input', function (ev) {
    if (ev.target.matches('[data-link],[data-biz-field],[data-cfg]')) render();
  });

  $('#copyBtn').addEventListener('click', function () {
    var out = $('#out');
    out.select();
    var done = function (t) { $('#saveMsg').textContent = t; };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(out.value).then(
        function () { done('Copied. Replace assets/js/site-config.js on GitHub and commit.'); },
        function () { done('Copy failed — select the text below and copy it manually.'); });
    } else {
      done('Select the text below and copy it manually.');
    }
  });

  $('#dlBtn').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$('#out').value], { type: 'text/javascript' }));
    a.download = 'site-config.js';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#hashBtn').addEventListener('click', function () {
    var v = $('#newpass').value;
    if (!v) return;
    sha256(v).then(function (h) { $('#hashOut').textContent = h; });
  });
})();
