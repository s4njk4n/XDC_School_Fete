/* Fete Tickets — customer app */
(async function () {
  'use strict';
  const F = window.Fete;
  const { $, $$, esc } = F;
  const CREDIT_GIFT = F.parseUnitsXdc('0.01');

  // Opened from a stall's payment code with the phone's normal camera? (…/customer/?fete=…&pay=…&amt=…)
  let linkPay = null;
  {
    const qp = new URLSearchParams(location.search);
    if (qp.get('pay')) {
      linkPay = F.Codes.parse(location.href);
      ['pay', 'amt', 'for'].forEach((k) => qp.delete(k));
      const qs = qp.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    }
  }
  const hadAccount = !!F.store.get('customer.key');

  const { created } = await F.start('customer', {
    account: linkPay && !hadAccount ? {
      welcomeTitle: 'Paying at a stall?',
      welcomeText: 'If you already have fete tickets, they\'re in the app or browser where you got them. Open that one, tap <b>Pay at a stall</b> and scan the stall\'s code again.',
      startLabel: 'I\'m new — get started',
      note: 'Changed phone or lost your tickets? Tap <b>I\'ve used this before</b> and paste your backup text.'
    } : {
      welcomeTitle: 'Your fete tickets, on your phone',
      welcomeText: 'Buy tickets at the ticket booth, then pay at any stall by scanning their code. No cash to lose!',
      startLabel: 'Get started',
      note: 'No download needed — it works right here in your browser. Please don\'t use a private / incognito tab, as it forgets your tickets when closed.'
    }
  });

  let balance = null;
  let pending = null; // payment being confirmed

  // ---------------------------------------------------------------- rendering
  function renderBalance() {
    if (balance === null) return;
    $('#bal').textContent = F.fmt(balance);
    $('#balUnit').textContent = F.ticketWord(balance);
    const m = F.money(balance);
    $('#balMoney').hidden = !m;
    $('#balMoney').textContent = 'worth ' + m;
    $('#liveBal').textContent = 'You have ' + F.tix(balance);
  }

  const ICON = { pay: '🛍️', gift: '🎁', got: '🎉' };
  function row(e) {
    const plus = e.type === 'got';
    return '<li><div class="ico">' + (ICON[e.type] || '•') + '</div><div class="grow"><b>' + esc(e.title) + '</b><span>' +
      F.timeStr(e.t) + (e.sub ? ' · ' + esc(e.sub) : '') + '</span></div>' +
      '<div class="amt ' + (plus ? 'plus' : 'minus') + '">' + (plus ? '+' : '−') + F.fmt(e.amount) + '</div></li>';
  }
  function renderHistory() {
    const l = F.history.list();
    $('#recent').innerHTML = l.length ? l.slice(0, 5).map(row).join('') : '<li class="empty">Nothing yet. Tap <b>Get tickets</b> to start!</li>';
    $('#allBtn').hidden = l.length <= 5;
    $('#allList').innerHTML = l.length ? l.map(row).join('') : '<li class="empty">Nothing yet.</li>';
  }

  // Optional home-screen tip: only in a mobile browser, only once they have tickets, and only until dismissed.
  function showInstallTip() {
    const p = F.platform();
    const hasTickets = (balance !== null && balance > 0n) || F.history.list().length > 0;
    return p.mobile && !p.inApp && !F.isStandalone() && hasTickets && !F.store.get('customer.installTipDone');
  }

  function home() {
    $('#backupNag').hidden = !!F.store.get('customer.backedUp');
    $('#installTip').hidden = !$('#backupNag').hidden || !showInstallTip();
    renderBalance(); renderHistory();
    F.showView('home');
  }

  // ---------------------------------------------------------------- balance watcher
  // Any increase we didn't cause ourselves = tickets arrived (booth sale, refund or gift).
  const watcher = F.watchBalance((b, prev) => {
    balance = b;
    renderBalance();
    if (prev !== null && b > prev) {
      const got = b - prev;
      const onCode = document.body.dataset.current === 'mycode';
      F.history.add({ type: 'got', title: 'Tickets received', amount: Number(F.toNum(got).toFixed(2)) });
      renderHistory();
      F.splash('+' + F.tix(got), 'You now have ' + F.tix(b)).then(() => { if (onCode) home(); });
    }
  }, () => (document.body.dataset.current === 'mycode' ? 3000 : 12000));

  // ---------------------------------------------------------------- actions
  $('#getBtn').onclick = () => {
    $('#myQr').innerHTML = F.qrSvg(F.Codes.person(F.myAddress()));
    F.showView('mycode');
  };
  $$('[data-home]').forEach((b) => (b.onclick = home));
  $('#allBtn').onclick = () => F.showView('history');
  $('#backupNow').onclick = async () => { await F.backupFlow(false); home(); };
  $('#settingsBtn').onclick = () => F.openSettings();
  $('#installTipX').onclick = () => { F.store.set('customer.installTipDone', Date.now()); $('#installTip').hidden = true; };
  $('#installTipGo').onclick = () => F.installSheet();

  $('#payBtn').onclick = async () => {
    const c = await F.scan({
      title: 'Scan the stall\'s code',
      hint: 'The stall shows a code on their phone with the price',
      check: (p) => {
        if (p.kind === 'P') return null;
        if (p.kind === 'C') return 'That\'s a person\'s code. To give them tickets, use "Give tickets".';
        return 'That\'s not a payment code. Ask the stall to show their payment code.';
      }
    });
    if (!c) return;
    showPay(c);
  };

  async function showPay(c) {
    // Payment code from a different fete than this phone is set to? Offer to switch (tickets are per fete).
    if (c.fete && !F.sameAddr(c.fete, F.feteAddress())) {
      const ok = await F.confirmSheet('This stall is at a different fete',
        'Your app is set to <b>' + esc(F.state.info ? F.state.info.name : 'another fete') + '</b>, but this payment code belongs to a different fete. Switch to that fete to pay? (Your tickets here stay safe.)',
        'Switch and pay', 'Cancel');
      if (ok && c.raw) { F.setFete(c.fete, c.chainId, true); location.href = c.raw; } // they chose to switch: no extra notice
      return;
    }
    pending = c;
    const amt = F.toNum(c.amount);
    $('#payAmt').textContent = F.fmt(amt);
    $('#payUnit').textContent = F.ticketWord(amt);
    const parts = (c.label || '').split(' · ');
    $('#payTo').textContent = parts[0] ? 'to ' + parts[0] : 'to the stall';
    $('#payLabel').textContent = parts.slice(1).join(' · ');
    const paidBefore = F.fstore.get('paid', []).includes(c.address.toLowerCase() + ':' + c.amount);
    const warn = $('#payWarn');
    warn.hidden = true;
    $('#payGo').disabled = false;
    if (paidBefore) {
      warn.innerHTML = '<b>You already paid this one.</b> Only pay again if the stall asks you to.';
      warn.hidden = false;
    }
    if (balance !== null && balance < c.amount) {
      warn.innerHTML = '<b>Not enough tickets.</b> You have ' + F.tix(balance) + '. Visit the ticket booth to get more.';
      warn.hidden = false;
      $('#payGo').disabled = true;
    }
    $('#payAfter').textContent = balance !== null && balance >= c.amount ? 'You\'ll have ' + F.tix(balance - c.amount) + ' left' : '';
    F.showView('pay');
    // Is this a real stall/booth of this fete? (Guards against prank or fake QR codes.)
    F.isTeamMember(c.address).then((ok) => {
      if (ok !== false || pending !== c || document.body.dataset.current !== 'pay') return;
      const w = $('#payWarn');
      w.innerHTML = '<b>Check before paying.</b> This code isn\'t from one of the fete\'s registered stalls. Only pay if you\'re sure it\'s a real fete stall — if unsure, ask a fete helper.' + (w.hidden ? '' : '<br><br>' + w.innerHTML);
      w.hidden = false;
    });
  }

  /** Remember a payment (for the "already paid" warning) and add it to Recent. */
  function recordPayment(c, sub) {
    const paid = F.fstore.get('paid', []);
    paid.unshift(c.address.toLowerCase() + ':' + c.amount);
    F.fstore.set('paid', paid.slice(0, 50));
    const parts = (c.label || '').split(' · ');
    F.history.add({ type: 'pay', title: parts[0] || 'Stall payment', sub: sub != null ? sub : parts.slice(1).join(' · '), amount: Number(F.toNum(c.amount).toFixed(2)) });
  }

  $('#payGo').onclick = async () => {
    const c = pending;
    if (!c) return;
    const b = F.busy('Paying…');
    try {
      await F.sendTickets(c.address, c.amount);
      recordPayment(c);
      balance = await F.ticketBalance();
      watcher.set(balance);
      b.close();
      pending = null;
      await F.splash('Paid!', F.tix(c.amount) + ' · You have ' + F.tix(balance) + ' left');
      home();
    } catch (e) {
      b.close();
      if (e.code === 'TIMEOUT') {
        recordPayment(c, 'going through');
        await F.alertSheet('Payment going through', 'The network is slow right now. Your payment has been sent and should reach the stall within a minute — their phone will show PAID. Please don\'t pay again.');
        home();
      } else await F.showError(e);
    }
  };

  $('#giveBtn').onclick = async () => {
    if (balance !== null && balance === 0n) return F.alertSheet('No tickets yet', 'Get some tickets from the ticket booth first.');
    const r = await F.sheet({
      title: 'Give tickets to someone',
      html: '<p class="muted">Great for sharing with family. They\'ll need the Fete Tickets app open on their phone, showing their code (they tap <b>Get tickets</b>).</p>' +
        '<label class="field"><span>How many tickets?</span><input class="input money" id="giveAmt" type="number" inputmode="decimal" min="0" step="1" placeholder="0"></label>',
      buttons: [{ label: '📷 Scan their code', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => {
        const n = Number($('#giveAmt', ov).value);
        if (!(n > 0)) return 'Enter how many tickets to give.';
        if (balance !== null && F.toWei(n) > balance) return 'You only have ' + F.tix(balance) + '.';
        return null;
      }
    });
    if (!r.value) return;
    const n = Number($('#giveAmt', r.el).value);
    const c = await F.scan({
      title: 'Scan their code', hint: 'On their phone: Fete Tickets → Get tickets',
      check: (p) => p.kind === 'C' ? (F.sameAddr(p.address, F.myAddress()) ? 'That\'s your own code!' : null) : 'That\'s not a person\'s code.'
    });
    if (!c) return;
    const b = F.busy('Sending tickets…');
    try {
      // If the other phone is brand new, pass along a little running credit so they can pay too.
      let credit = 0n;
      try {
        const [theirs, mine, one] = await Promise.all([F.creditBalance(c.address), F.creditBalance(), F.costOfOne(true)]);
        if (theirs < one * 3n && mine > CREDIT_GIFT + one * 6n) credit = CREDIT_GIFT;
      } catch (e) { }
      await F.sendTickets(c.address, F.toWei(n), credit);
      F.history.add({ type: 'gift', title: 'Gave tickets', amount: n });
      balance = await F.ticketBalance();
      watcher.set(balance);
      b.close();
      await F.splash('Sent!', F.tix(n) + ' given');
      home();
    } catch (e) { b.close(); await F.showError(e); }
  };

  try { balance = await F.ticketBalance(); watcher.set(balance); } catch (e) { }
  home();
  if (linkPay && linkPay.kind === 'P' && (hadAccount || created)) showPay(linkPay);
})();
