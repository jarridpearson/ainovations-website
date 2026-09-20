/* Drumlin Septic & Site Services — shared behavior.
   Three jobs: (1) owner-editable prices, (2) route-WEEK availability, (3) demo form handling.
   In a real client build, PRICES and WEEKS come from the DB instead of localStorage,
   and forms POST to Netlify. Everything else ports as-is. */
(function () {
  'use strict';

  /* ---------- 1. PRICES — owner edits them on his phone in ~20 seconds ---------- */
  var DEFAULTS = {
    pump1000: '340', pump1500: '395', pump2000: '460',
    lid: '75', hose: '45', after: '150', filter: '65',
    inspect: '295',
    asof: 'February 2, 2026'
  };
  var KEY = 'drumlin.prices.v1';

  function load() {
    try {
      var s = localStorage.getItem(KEY);
      if (!s) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(s));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

  var prices = load();
  window.DRUMLIN_PRICES = prices;

  function paint() {
    document.querySelectorAll('[data-price]').forEach(function (el) {
      var k = el.getAttribute('data-price');
      if (prices[k] != null) el.textContent = prices[k];
    });
  }
  paint();

  /* owner edit mode — ?owner=1 or tapping the footer year 3x */
  var editing = false;
  function setEditing(on) {
    editing = on;
    document.querySelectorAll('[data-price]').forEach(function (el) {
      el.setAttribute('contenteditable', on ? 'true' : 'false');
      if (on) el.setAttribute('inputmode', 'decimal');
    });
    var bar = document.getElementById('ownerbar');
    if (bar) bar.classList.toggle('show', on);
    if (!on) paint();
  }
  window.drumlinSavePrices = function () {
    document.querySelectorAll('[data-price]').forEach(function (el) {
      var k = el.getAttribute('data-price');
      var v = (el.textContent || '').replace(/[^0-9.A-Za-z ,]/g, '').trim();
      if (v) prices[k] = v;
    });
    save(prices);
    setEditing(false);
    toast('Prices updated. Live on every page.');
  };
  window.drumlinCancelPrices = function () { setEditing(false); };
  window.drumlinResetPrices = function () {
    prices = Object.assign({}, DEFAULTS); save(prices); paint();
    toast('Reset to the original demo prices.');
  };

  if (/[?&]owner=1/.test(location.search)) setEditing(true);
  var taps = 0, tapTimer = null;
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-ownertap]');
    if (!t) return;
    taps++; clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { taps = 0; }, 1200);
    if (taps >= 3) { taps = 0; setEditing(true); }
  });

  /* ---------- 2. ROUTE WEEKS — a pumper routes by geography, never by clock ---------- */
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function mondayOf(d) {
    var x = new Date(d); var day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
  }
  window.drumlinWeeks = function (mountId, count) {
    var host = document.getElementById(mountId);
    if (!host) return;
    var start = mondayOf(new Date());
    start.setDate(start.getDate() + 7);           // never offer the current week
    var fills = ['tight', 'open', 'open', 'open', 'full', 'open'];
    var words = { open: 'Openings', tight: 'Filling up', full: 'Full' };
    var html = '';
    for (var i = 0; i < (count || 5); i++) {
      var a = new Date(start); a.setDate(a.getDate() + i * 7);
      var b = new Date(a); b.setDate(b.getDate() + 4);
      var f = fills[i % fills.length];
      var lab = 'Week of ' + MON[a.getMonth()] + ' ' + a.getDate() +
                ' – ' + (a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' ') + b.getDate();
      var dis = f === 'full' ? ' isfull' : '';
      html += '<label class="week' + dis + '">' +
        '<input type="radio" name="routeweek" value="' + lab + '"' + (f === 'full' ? ' disabled' : '') + '>' +
        '<span class="wk">' + lab + '</span>' +
        '<span class="fill ' + f + '">' + words[f] + '</span></label>';
    }
    host.innerHTML = html;
  };

  /* ---------- 3. DEMO FORMS — confirm on screen, never send ---------- */
  window.drumlinDemoSubmit = function (form, msg) {
    var box = form.querySelector('[data-confirm]');
    if (box) {
      box.innerHTML = '<div class="honest"><b>Demo — nothing was sent.</b><br>' + msg + '</div>';
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return false;
  };

  function toast(m) {
    var t = document.createElement('div');
    t.textContent = m;
    t.style.cssText = 'position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:80;' +
      'background:#10202b;color:#fff;padding:12px 18px;border-radius:999px;font-weight:700;font-size:14.5px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:90vw;text-align:center';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  window.drumlinToast = toast;
})();
