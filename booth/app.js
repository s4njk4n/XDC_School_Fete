/* Fete Tickets — ticket booth app */
(async function () {
  'use strict';
  const F = window.Fete;
  const { $, $$, esc } = F;

  await F.start('booth', {
    account: {
      welcomeTitle: 'Ticket Booth',
      welcomeText: 'Sell fete tickets: take the customer\'s cash or card as usual, tap the amount, and scan their phone. Done.',
      startLabel: 'Set up this booth phone'
    }
  });
  F.keepAwake();

  const CUST_CREDIT = F.parseUnitsXdc(F.CFG.customerCredit);
  const CUST_BELOW = F.parseUnitsXdc(F.CFG.customerCreditBelow);
  let float = null, credit = null;
  let request = null;

  const cents = () => (F.state.info && F.state.info.cents) || 100;
  const ticketsFor = (dollars) => Math.round(dollars * 100 / cents() * 100) / 100;

  // ---------------------------------------------------------------- rendering
  function renderQuick() {
    const amounts = [5, 10, 20, 50, 2, 100];
    $('#quick').innerHTML = amounts.map((d) =>
      '<button class="amount-btn" data-d="' + d + '"><b>' + F.dollars(d).replace(/\.00$/, '') + '</b><span>' + F.tix(ticketsFor(d)) + '</span></button>').join('');
    $$('#quick [data-d]').forEach((b) => (b.onclick = () => sell(Number(b.dataset.d))));
    $('#price').textContent = '1 ticket = ' + F.dollars(cents() / 100);
  }

  function sales(range) {
    return F.history.list().filter((e) => range === 'all' || F.isToday(e.t));
  }
  function row(e) {
    const label = e.type === 'sale' ? 'Sold · ' + (e.method === 'card' ? 'card' : 'cash') + (e.pending ? ' · still going through' : '') : e.type === 'buyback' ? 'Bought back' : e.type === 'topup' ? 'Phone top-up' : e.type === 'return' ? 'Returned to organiser' : e.type;
    const ico = { sale: e.method === 'card' ? '💳' : '💵', buyback: '↩️', topup: '⚡', return: '📦' }[e.type] || '•';
    return '<li><div class="ico">' + ico + '</div><div class="grow"><b>' + esc(label) + '</b><span>' + F.timeStr(e.t) + (e.dollars ? ' · ' + F.dollars(e.dollars) : '') + '</span></div>' +
      '<div class="amt">' + (e.amount ? F.fmt(e.amount) : '') + '</div></li>';
  }
  function totals(range) {
    const l = sales(range);
    const t = { cash: 0, card: 0, back: 0, sold: 0, n: 0 };
    l.forEach((e) => {
      if (e.type === 'sale') { t.n++; t.sold += e.amount; t[e.method === 'card' ? 'card' : 'cash'] += e.dollars; }
      if (e.type === 'buyback') t.back += e.dollars;
    });
    return t;
  }
  function render() {
    $('#float').textContent = float === null ? '–' : F.fmt(float);
    const t = totals('today');
    $('#tSold').textContent = F.fmt(t.sold);
    $('#tMoney').textContent = F.dollars(t.cash + t.card);
    const l = sales('today');
    $('#recent').innerHTML = l.length ? l.slice(0, 6).map(row).join('') : '<li class="empty">No sales yet today.</li>';
    $('#setupNote').hidden = !(float !== null && float === 0n && !F.history.list().length);
    $('#backupNag').hidden = !!F.store.get('booth.backedUp');
  }
  async function refresh() {
    try {
      [float, credit] = await Promise.all([F.ticketBalance(), F.creditBalance()]);
      const one = await F.costOfOne(true);
      const salesLeft = Number(credit / (one + CUST_CREDIT));
      const w = $('#creditWarn');
      if (credit < one) { w.innerHTML = '<b>Running credit is empty.</b> Ask the organiser to top up this booth (they scan this booth\'s code).'; w.hidden = false; }
      else if (salesLeft < 25) { w.innerHTML = '<b>Running credit is low</b> (about ' + salesLeft + ' sales left). Ask the organiser to top up this booth.'; w.hidden = false; }
      else w.hidden = true;
    } catch (e) { }
    render();
  }
  function home() { render(); F.showView('home'); refresh(); }

  // ---------------------------------------------------------------- selling
  async function sell(dollarsPaid, ticketsOverride) {
    const n = ticketsOverride != null ? ticketsOverride : ticketsFor(dollarsPaid);
    if (float !== null && F.toWei(n) > float) return F.alertSheet('Not enough tickets on this phone', 'This booth has ' + F.tix(float) + ' left to sell. Ask the organiser for more.');
    const r = await F.sheet({
      title: F.tix(n) + ' for ' + F.dollars(dollarsPaid),
      html: '<p class="muted">How did they pay?</p>',
      buttons: [
        { label: '<span class="emoji">💵</span> Cash — scan their phone', value: 'cash' },
        { label: '<span class="emoji">💳</span> Card — scan their phone', value: 'card', style: 'secondary' },
        { label: 'Cancel', value: null, style: 'ghost' }]
    });
    if (!r.value) return;
    const c = await F.scan({
      title: 'Scan the customer\'s code',
      hint: 'They open Fete Tickets and tap "Get tickets"',
      check: (p) => p.kind === 'C' ? null : p.kind === 'P' ? 'That\'s a payment code. Ask the customer to tap "Get tickets" instead.' : 'That\'s not a customer code.'
    });
    if (!c) return;
    const b = F.busy('Sending ' + F.tix(n) + '…');
    try {
      let give = 0n;
      try { if ((await F.creditBalance(c.address)) < CUST_BELOW) give = CUST_CREDIT; } catch (e) { }
      await F.sendTickets(c.address, F.toWei(n), give);
      F.history.add({ type: 'sale', amount: n, dollars: dollarsPaid, method: r.value, to: c.address });
      b.close();
      await F.splash('Done!', F.tix(n) + ' sent to the customer');
      home();
    } catch (e) {
      b.close();
      if (e.code === 'TIMEOUT' && e.hash) {
        // Almost certainly still going through: count the sale, and confirm it in the background.
        const id = Date.now();
        F.history.add({ id, type: 'sale', amount: n, dollars: dollarsPaid, method: r.value, to: c.address, pending: e.hash });
        confirmLater(id, e.hash);
        await F.alertSheet('Still going through', 'The network is slow. The customer\'s ' + F.tix(n) + ' should appear on their phone within a minute or two. Please don\'t sell them again — this sale is already counted. If they still haven\'t arrived in 5 minutes, ask the organiser.');
        home();
      } else { await F.showError(e); refresh(); }
    }
  }

  $('#otherBtn').onclick = async () => {
    let mode = 'dollars';
    const r = await F.sheet({
      title: 'Other amount',
      html: '<div class="seg" id="mode"><button data-m="dollars" class="on">By money</button><button data-m="tickets">By tickets</button></div>' +
        '<label class="field"><span id="amtLabel">Money received (' + esc(F.CFG.currency) + ')</span><input class="input money" id="amt" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0"></label>' +
        '<p class="center muted" id="amtCalc">&nbsp;</p>',
      buttons: [{ label: 'Next', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      onOpen: (ov) => {
        const calc = () => {
          const v = Number($('#amt', ov).value) || 0;
          $('#amtCalc', ov).textContent = v ? (mode === 'dollars' ? '= ' + F.tix(ticketsFor(v)) : '= ' + F.dollars(v * cents() / 100)) : ' ';
        };
        $$('#mode button', ov).forEach((b) => (b.onclick = () => {
          mode = b.dataset.m;
          $$('#mode button', ov).forEach((x) => x.classList.toggle('on', x === b));
          $('#amtLabel', ov).textContent = mode === 'dollars' ? 'Money received (' + F.CFG.currency + ')' : 'Number of tickets';
          calc();
        }));
        $('#amt', ov).oninput = calc;
      },
      validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter an amount.')
    });
    if (!r.value) return;
    const v = Number($('#amt', r.el).value);
    if (mode === 'dollars') sell(v);
    else sell(Math.round(v * cents()) / 100, v);
  };

  // A phone that can't pay (no running credit) — send credit only, no tickets.
  $('#topupBtn').onclick = async () => {
    const ok = await F.confirmSheet('Fix a customer\'s phone', 'If a customer\'s app says it needs a <b>top-up</b>, scan their code and it\'ll be fixed in seconds. No tickets are given and it costs them nothing.', '📷 Scan their code', 'Cancel');
    if (!ok) return;
    const c = await F.scan({ title: 'Scan the customer\'s code', hint: 'They tap "Get tickets" to show it', check: (p) => p.kind === 'C' ? null : 'That\'s not a customer code.' });
    if (!c) return;
    const b = F.busy('Topping up…');
    try {
      await F.sendTickets(c.address, 0n, CUST_CREDIT);
      F.history.add({ type: 'topup', to: c.address });
      b.close();
      await F.splash('Fixed!', 'Their app is ready to pay again');
      home();
    } catch (e) { b.close(); await F.showError(e); }
  };

  /** A sale whose confirmation timed out: keep checking; un-count it if it actually failed. */
  function confirmLater(id, hash) {
    F.waitTx(hash, 10 * 60000).then(() => setPending(id, null)).catch((err) => {
      if (err.code === 'TIMEOUT') return;
      const l = F.history.list().filter((x) => x.id !== id);
      F.fstore.set('history', l);
      render();
      F.alertSheet('A sale didn\'t go through', 'An earlier sale that was "still going through" failed, so it has been removed from the totals. The customer didn\'t receive those tickets — if they paid, please sell to them again.');
    });
  }
  function setPending(id, v) {
    const l = F.history.list();
    const e = l.find((x) => x.id === id);
    if (e) { e.pending = v; F.fstore.set('history', l); render(); }
  }
  F.history.list().filter((x) => x.pending).forEach((x) => confirmLater(x.id, x.pending));

  // ---------------------------------------------------------------- buy back (refund cash for tickets)
  $('#buybackBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Buy back tickets',
      html: '<p class="muted">The customer gives tickets back and you give them money from the tin.</p>' +
        '<label class="field"><span>How many tickets?</span><input class="input money" id="bb" type="number" inputmode="decimal" min="0" step="1" placeholder="0"></label><p class="center muted" id="bbCalc">&nbsp;</p>',
      buttons: [{ label: 'Show code to customer', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      onOpen: (ov) => ($('#bb', ov).oninput = () => { const v = Number($('#bb', ov).value) || 0; $('#bbCalc', ov).textContent = v ? 'You\'ll give back ' + F.dollars(v * cents() / 100) : ' '; }),
      validate: (ov) => (Number($('#bb', ov).value) > 0 ? null : 'Enter how many tickets.')
    });
    if (!r.value) return;
    const n = Number($('#bb', r.el).value);
    const amount = F.uniqueAmount(n);
    const [start, block] = await Promise.all([F.ticketBalance().catch(() => 0n), F.blockNumber().catch(() => 0)]);
    $('#reqTitle').textContent = 'Customer: scan this to return ' + F.tix(n);
    $('#reqSub').textContent = 'Scan with your phone\'s camera, or in Fete Tickets tap "Pay at a stall".';
    $('#reqQr').innerHTML = F.qrSvg(F.Codes.pay(F.myAddress(), amount, 'Ticket booth · buy back'));
    F.showView('request');
    const d = n * cents() / 100;
    const w = F.watchPayment(amount, block, start, async () => {
      F.history.add({ type: 'buyback', amount: n, dollars: d });
      if (request === w) {
        request = null;
        await F.splash('Received ' + F.tix(n), 'Give the customer ' + F.dollars(d));
        home();
      } else {
        // Cancelled, but the customer paid anyway.
        render();
        await F.splash('Late buy-back received', F.tix(n) + ' arrived after you cancelled. Give the customer ' + F.dollars(d) + '.');
      }
    });
    request = w;
  };
  $('#reqCancel').onclick = () => {
    const w = request;
    request = null;
    // Keep listening for a few minutes in case the customer already paid.
    if (w) setTimeout(() => w.stop(), 3 * 60000);
    home();
  };

  // ---------------------------------------------------------------- totals
  function renderTotals(range) {
    const t = totals(range);
    $('#cCash').textContent = F.dollars(t.cash);
    $('#cCard').textContent = F.dollars(t.card);
    $('#cBack').textContent = F.dollars(t.back);
    $('#cSales').textContent = t.n;
    $('#cTin').textContent = F.dollars(t.cash - t.back);
    const l = sales(range);
    $('#allList').innerHTML = l.length ? l.map(row).join('') : '<li class="empty">Nothing yet.</li>';
  }
  $('#totalsBtn').onclick = () => { renderTotals('today'); F.showView('totals'); };
  $$('#totalsRange button').forEach((b) => (b.onclick = () => {
    $$('#totalsRange button').forEach((x) => x.classList.toggle('on', x === b));
    renderTotals(b.dataset.r);
  }));

  $('#returnBtn').onclick = async () => {
    const bal = await F.ticketBalance().catch(() => float);
    if (!bal || bal === 0n) return F.alertSheet('Nothing to return', 'This booth has no tickets left.');
    const ok = await F.confirmSheet('Send unsold tickets back?', 'This sends all <b>' + F.tix(bal) + '</b> on this phone back to the organiser. Only do this when the booth has closed.', 'Send them back', 'Cancel');
    if (!ok) return;
    const b = F.busy('Returning tickets…');
    try {
      await F.sendTickets(F.state.info.organiser, bal);
      F.history.add({ type: 'return', amount: Number(F.toNum(bal).toFixed(2)) });
      b.close();
      await F.splash('Returned', F.tix(bal) + ' sent back to the organiser');
      home();
    } catch (e) { b.close(); await F.showError(e); }
  };

  // ---------------------------------------------------------------- misc
  const showCode = () => {
    $('#myQr').innerHTML = F.qrSvg(F.Codes.member('B', F.myAddress(), F.store.get('booth.name', 'Ticket booth')));
    F.showView('mycode');
  };
  $('#myCodeBtn').onclick = showCode;
  $('#showCode2').onclick = showCode;
  $$('[data-home]').forEach((b) => (b.onclick = home));
  $('#backupNow').onclick = async () => { await F.backupFlow(false); render(); };
  $('#settingsBtn').onclick = () => F.openSettings(
    '<button class="btn secondary" data-x="name">🏷️ Name this booth</button>',
    (ov, act) => ($('[data-x="name"]', ov).onclick = () => act('name'))
  ).then(async (a) => {
    if (a !== 'name') return;
    const r = await F.sheet({
      title: 'Name this booth', html: '<label class="field"><input class="input" id="nm" value="' + esc(F.store.get('booth.name', 'Ticket booth')) + '"></label>',
      buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => ($('#nm', ov).value.trim() ? null : 'Enter a name.')
    });
    if (r.value) F.store.set('booth.name', $('#nm', r.el).value.trim());
  });

  // live float updates (e.g. organiser loads more tickets)
  F.watchBalance((b, prev) => {
    float = b; render();
    if (prev !== null && b > prev && document.body.dataset.current === 'mycode') { F.splash('Tickets loaded', 'This booth now has ' + F.tix(b) + ' to sell'); home(); }
  }, () => (document.body.dataset.current === 'mycode' ? 3000 : 12000));

  if (!F.store.get('booth.name')) F.store.set('booth.name', 'Ticket booth');
  renderQuick();
  home();
})();
