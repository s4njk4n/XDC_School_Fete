/* Fete Tickets — stall app */
(async function () {
  'use strict';
  const F = window.Fete;
  const { $, $$, esc } = F;

  const { created } = await F.start('stall', {
    account: {
      welcomeTitle: 'Fete Stall',
      welcomeText: 'Take tickets at your stall. Tap what the customer is buying, show them the code, and you\'ll see a big green tick when they\'ve paid.',
      startLabel: 'Set up my stall'
    }
  });
  F.keepAwake();

  let items = F.store.get('stall.items', []);
  let cart = {}; // index -> qty
  let request = null;

  const stallName = () => F.store.get('stall.name', '');
  const cents = () => (F.state.info && F.state.info.cents) || 100;

  async function askName(first) {
    const r = await F.sheet({
      title: first ? 'What\'s your stall called?' : 'Stall name',
      html: '<p class="muted">Customers see this when they pay.</p><label class="field"><input class="input" id="nm" maxlength="30" placeholder="e.g. Sausage Sizzle" value="' + esc(stallName()) + '"></label>',
      buttons: [{ label: 'Save', value: true, submit: true }].concat(first ? [] : [{ label: 'Cancel', value: false, style: 'ghost' }]),
      dismissable: !first,
      validate: (ov) => ($('#nm', ov).value.trim() ? null : 'Enter your stall\'s name.')
    });
    if (r.value) F.store.set('stall.name', $('#nm', r.el).value.trim());
    $('#stallName').textContent = stallName() || 'Fete Stall';
  }

  // ---------------------------------------------------------------- selling screen
  function cartTotal() {
    return Object.entries(cart).reduce((s, [i, q]) => s + (items[i] ? items[i].price * q : 0), 0);
  }
  function cartLabel() {
    return Object.entries(cart).filter(([i, q]) => q > 0 && items[i]).map(([i, q]) => q + '× ' + items[i].name).join(', ');
  }
  function renderSell() {
    $('#noItems').hidden = items.length > 0;
    $('#items').innerHTML = items.map((it, i) =>
      '<button class="item-btn" data-i="' + i + '"><span class="nm">' + esc(it.name) + '</span><span class="pr">' + F.tix(it.price) + '</span>' +
      (cart[i] ? '<span class="qty">' + cart[i] + '</span>' : '') + '</button>').join('');
    $$('#items [data-i]').forEach((b) => (b.onclick = () => { const i = b.dataset.i; cart[i] = (cart[i] || 0) + 1; renderSell(); }));
    const lines = Object.entries(cart).filter(([i, q]) => q > 0 && items[i]);
    $('#cartCard').hidden = !lines.length;
    $('#cart').innerHTML = lines.map(([i, q]) =>
      '<li><div class="grow"><b>' + esc(items[i].name) + '</b><span>' + F.tix(items[i].price) + ' each</span></div>' +
      '<button class="btn secondary small" data-minus="' + i + '">−</button><b style="min-width:26px;text-align:center">' + q + '</b>' +
      '<button class="btn secondary small" data-plus="' + i + '">+</button></li>').join('');
    $$('[data-minus]').forEach((b) => (b.onclick = () => { const i = b.dataset.minus; cart[i]--; if (cart[i] <= 0) delete cart[i]; renderSell(); }));
    $$('[data-plus]').forEach((b) => (b.onclick = () => { cart[b.dataset.plus]++; renderSell(); }));
    const t = cartTotal();
    $('#cartTotal').textContent = F.tix(t);
    $('#chargeBtn').disabled = !(t > 0);
    $('#chargeBtn').textContent = t > 0 ? 'Charge ' + F.tix(t) : 'Tap items to start a sale';
    $('#backupNag').hidden = !!F.store.get('stall.backedUp');
  }
  function sell() { request && request.stop(); request = null; renderSell(); F.showView('sell'); }

  $('#chargeBtn').onclick = () => charge(cartTotal(), cartLabel());
  $('#clearBtn').onclick = () => { cart = {}; renderSell(); };
  $('#customBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Type an amount',
      html: '<label class="field"><span>Tickets to charge</span><input class="input money" id="amt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label>',
      buttons: [{ label: 'Charge', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter how many tickets.')
    });
    if (r.value) charge(Number($('#amt', r.el).value), '');
  };

  async function charge(n, label) {
    if (!(n > 0)) return;
    const amount = F.uniqueAmount(n);
    const b = F.busy('Getting ready…');
    let start = 0n, block = 0;
    try { [start, block] = await Promise.all([F.ticketBalance(), F.blockNumber()]); }
    catch (e) { b.close(); return F.showError(e); }
    b.close();
    $('#reqAmt').textContent = F.fmt(n);
    $('#reqUnit').textContent = F.ticketWord(n);
    $('#reqItems').textContent = label;
    $('#reqQr').innerHTML = F.qrSvg(F.Codes.pay(F.myAddress(), amount, stallName() + (label ? ' · ' + label : '')));
    F.showView('request');
    request = F.watchPayment(amount, block, start, async (info) => {
      request = null;
      F.history.add({ type: 'sale', amount: n, label, from: info.from });
      cart = {};
      await F.splash('PAID', F.tix(n) + (label ? ' · ' + label : ''), true, 2200);
      sell();
    });
  }
  $('#reqCancel').onclick = async () => {
    const ok = await F.confirmSheet('Cancel this sale?', 'Only cancel if the customer <b>hasn\'t</b> paid yet.', 'Cancel sale', 'Keep waiting');
    if (ok) sell();
  };

  // ---------------------------------------------------------------- items editor
  function renderMenu() {
    $('#menuList').innerHTML = items.length ? items.map((it, i) =>
      '<li><div class="grow"><b>' + esc(it.name) + '</b><span>' + F.tix(it.price) + (F.money(it.price) ? ' · ' + F.money(it.price) : '') + '</span></div>' +
      '<button class="btn secondary small" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="btn danger small" data-del="' + i + '">Remove</button></li>').join('') : '<li class="empty">No items yet.</li>';
    $$('[data-del]').forEach((b) => (b.onclick = () => { items.splice(Number(b.dataset.del), 1); save(); }));
    $$('[data-up]').forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [items[i - 1], items[i]] = [items[i], items[i - 1]]; save(); }));
  }
  function save() { F.store.set('stall.items', items); cart = {}; renderMenu(); }
  $('#addItem').onclick = () => {
    const name = $('#newName').value.trim();
    const price = Math.round(Number($('#newPrice').value) * 100) / 100;
    if (!name) return F.toast('Enter the item name', 'bad');
    if (!(price > 0)) return F.toast('Enter a price in tickets', 'bad');
    items.push({ name, price });
    $('#newName').value = ''; $('#newPrice').value = '';
    save();
    F.toast('Added ' + name, 'ok');
  };
  const openMenu = () => { renderMenu(); F.showView('menu'); };
  $('#menuBtn').onclick = openMenu;
  $('#addFirst').onclick = openMenu;

  // ---------------------------------------------------------------- refunds
  $('#refundBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Give a refund',
      html: '<p class="muted">Sends tickets from this stall back to a customer.</p><label class="field"><span>Tickets to refund</span><input class="input money" id="rf" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label>',
      buttons: [{ label: '📷 Scan customer\'s code', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => (Number($('#rf', ov).value) > 0 ? null : 'Enter how many tickets.')
    });
    if (!r.value) return;
    const n = Number($('#rf', r.el).value);
    const c = await F.scan({ title: 'Scan the customer\'s code', hint: 'They tap "Get tickets" to show it', check: (p) => p.kind === 'C' ? null : 'That\'s not a customer code.' });
    if (!c) return;
    const b = F.busy('Refunding ' + F.tix(n) + '…');
    try {
      await F.sendTickets(c.address, F.toWei(n));
      F.history.add({ type: 'refund', amount: n });
      b.close();
      await F.splash('Refunded', F.tix(n) + ' returned to the customer');
      sell();
    } catch (e) { b.close(); await F.showError(e); }
  };

  // ---------------------------------------------------------------- today
  async function openToday() {
    const l = F.history.list().filter((e) => F.isToday(e.t));
    const taken = l.reduce((s, e) => s + (e.type === 'sale' ? e.amount : e.type === 'refund' ? -e.amount : 0), 0);
    $('#sTaken').textContent = F.fmt(taken);
    $('#sMoney').textContent = F.money(taken) || '–';
    $('#sCount').textContent = l.filter((e) => e.type === 'sale').length;
    $('#salesList').innerHTML = l.length ? l.map((e) =>
      '<li><div class="ico">' + ({ sale: '🛍️', refund: '↩️', handin: '📦' }[e.type] || '•') + '</div><div class="grow"><b>' +
      esc(e.type === 'sale' ? (e.label || 'Sale') : e.type === 'refund' ? 'Refund' : 'Handed in to organiser') + '</b><span>' + F.timeStr(e.t) + '</span></div>' +
      '<div class="amt ' + (e.type === 'sale' ? 'plus' : '') + '">' + (e.type === 'sale' ? '+' : '−') + F.fmt(e.amount) + '</div></li>').join('') : '<li class="empty">No sales yet today.</li>';
    $('#sHeld').textContent = '…';
    F.showView('today');
    try { $('#sHeld').textContent = F.fmt(await F.ticketBalance()); } catch (e) { $('#sHeld').textContent = '?'; }
  }
  $('#todayBtn').onclick = openToday;

  $('#handInBtn').onclick = async () => {
    const bal = await F.ticketBalance().catch(() => 0n);
    if (!bal) return F.alertSheet('Nothing to hand in', 'This stall has no tickets on it.');
    const ok = await F.confirmSheet('Hand in your tickets?', 'This sends all <b>' + F.tix(bal) + '</b> taken by this stall to the organiser. Do this when your stall has closed.', 'Hand them in', 'Cancel');
    if (!ok) return;
    const b = F.busy('Handing in…');
    try {
      await F.sendTickets(F.state.info.organiser, bal);
      F.history.add({ type: 'handin', amount: Number(F.toNum(bal).toFixed(2)) });
      b.close();
      await F.splash('Handed in', F.tix(bal) + ' sent to the organiser. Thanks for helping!');
      openToday();
    } catch (e) { b.close(); await F.showError(e); }
  };

  $('#myCodeBtn').onclick = () => {
    $('#myQr').innerHTML = F.qrSvg(F.Codes.member('S', F.myAddress(), stallName()));
    F.showView('mycode');
    (async function waitAdded() {
      const start = await F.creditBalance().catch(() => null);
      while (document.body.dataset.current === 'mycode' && start !== null) {
        await F.sleep(3000);
        if (document.body.dataset.current !== 'mycode') return; // they moved on; the join note updates by itself
        const now = await F.creditBalance().catch(() => start);
        if (now > start && document.body.dataset.current === 'mycode') {
          F.fstore.set('joined', 1);
          $('#joinNote').hidden = true;
          await F.splash('You\'re in!', 'The organiser has added your stall. Ready to sell.');
          sell();
          return;
        }
      }
    })();
  };

  // ---------------------------------------------------------------- misc
  $$('[data-sell]').forEach((b) => (b.onclick = sell));
  $('#backupNow').onclick = async () => { await F.backupFlow(false); renderSell(); };
  $('#settingsBtn').onclick = () => F.openSettings(
    '<button class="btn secondary" data-x="name">🏷️ Change stall name</button>',
    (ov, act) => ($('[data-x="name"]', ov).onclick = () => act('name'))
  ).then((a) => { if (a === 'name') askName(false); });

  $('#joinCode').onclick = () => $('#myCodeBtn').click();
  // Until the organiser has added this stall (they send it a little running credit), show how to join.
  (async function checkJoined() {
    try {
      const [c, t] = await Promise.all([F.creditBalance(), F.ticketBalance()]);
      const joined = c > 0n || t > 0n || F.history.list().length > 0;
      if (joined) F.fstore.set('joined', 1);
      $('#joinNote').hidden = joined || !!F.fstore.get('joined');
      if (!joined && !F.fstore.get('joined')) setTimeout(checkJoined, 5000);
    } catch (e) { setTimeout(checkJoined, 8000); }
  })();

  if (!stallName()) await askName(true);
  $('#stallName').textContent = stallName();
  sell();
  if (created && !items.length) openMenu();
})();
