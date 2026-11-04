/* Fete Tickets — organiser app */
(async function () {
  'use strict';
  const F = window.Fete;
  const { $, $$, esc } = F;

  await F.start('organiser', {
    needsFete: false,
    account: {
      welcomeTitle: 'Fete Organiser',
      welcomeText: 'Run your school fete on phones. This app walks you through it: create your tickets, invite your ticket booth and stall helpers, put up posters, and see the totals at the end.',
      startLabel: 'Start setting up'
    }
  });

  $$('[data-cur]').forEach((e) => (e.textContent = F.CFG.currency));
  const XDC = (v) => F.parseUnitsXdc(v);
  const me = () => F.myAddress();
  const cents = () => (F.state.info && F.state.info.cents) || 100;
  const xdcAddr = () => 'xdc' + me().slice(2);
  const practice = () => F.state.chainId === 51;
  const flags = () => F.store.get('organiser.flags.' + (F.feteAddress() || '').toLowerCase(), {});
  const setFlag = (k) => { const f = flags(); f[k] = Date.now(); F.store.set('organiser.flags.' + F.feteAddress().toLowerCase(), f); };

  // Team = booths and stalls, recorded on the network by addHelper() so any phone can rebuild it.
  let teamList = F.feteAddress() ? F.cachedHelpers() : [];
  const team = () => teamList.filter((m) => !m.removed);     // current team
  const everyone = () => teamList;                           // incl. removed (for totals)

  // ---------------------------------------------------------------- running credit
  let creditTimer = null;
  function creditBox(el) {
    el.innerHTML =
      '<p>Send XDC to this organiser account:</p>' +
      '<div class="qr">' + F.qrSvg(xdcAddr()) + '</div>' +
      '<div class="input" style="font-size:14px;word-break:break-all;user-select:all;text-align:center">' + esc(xdcAddr()) + '</div>' +
      '<p class="small muted" style="margin-top:6px">Some apps want it starting with <b>0x</b> instead: <span style="user-select:all;word-break:break-all">' + esc(me()) + '</span></p>' +
      '<div class="grid2"><button class="btn secondary small" style="width:100%" data-copy>Copy</button><button class="btn secondary small" style="width:100%" data-copy0x>Copy 0x version</button></div>' +
      '<div class="notice info" style="margin:14px 0 0">Running credit now: <b data-cbal>checking…</b></div>';
    $('[data-copy]', el).onclick = () => F.copyText(xdcAddr());
    $('[data-copy0x]', el).onclick = () => F.copyText(me());
    clearInterval(creditTimer);
    const upd = async () => { try { const b = await F.creditBalance(); $$('[data-cbal]').forEach((x) => (x.textContent = F.xdc(b) + ' XDC')); } catch (e) { } };
    upd();
    creditTimer = setInterval(upd, 5000);
  }
  function howToGetXdc() {
    if (practice()) {
      return '<ol class="steps"><li>Open the free practice faucet: <a href="https://faucet.blocksscan.io/" target="_blank" rel="noopener">faucet.blocksscan.io</a> (choose <b>Apothem</b>).</li>' +
        '<li>Paste your organiser address (the <b>xdc…</b> one below) and request credit.</li><li>It appears below within a minute.</li></ol>';
    }
    return '<ol class="steps"><li>Buy XDC on a cryptocurrency exchange that lists it (most large ones do), or ask someone in your school community who already has some. A few dollars\' worth is usually plenty.</li>' +
      '<li>Choose <b>Withdraw / Send</b>, pick the <b>XDC Network</b>, and paste your organiser address (below).</li>' +
      '<li>It shows up below within a minute or two. Leftover credit stays in your account for next year.</li></ol>';
  }
  function estimate(people) {
    const t = team();
    const booths = Math.max(2, t.filter((m) => m.kind === 'B').length);
    const stalls = Math.max(10, t.filter((m) => m.kind === 'S').length);
    return Math.ceil(people * Number(F.CFG.customerCredit) * 1.3 + booths * Number(F.CFG.boothCredit) * 0.2 + stalls * Number(F.CFG.stallCredit) + 5);
  }

  // ---------------------------------------------------------------- setup
  function showSetup() {
    $('#practiceOffer').hidden = practice();
    $('#practiceOn').hidden = !practice();
    $('#howXdcBody').innerHTML = howToGetXdc();
    $('#howXdc').open = practice();
    creditBox($('#creditBox'));
    $('#needEst').textContent = estimate(500) + ' XDC';
    F.showView('setup');
  }
  const switchNet = (test) => {
    if (test) F.store.set('rpc', F.SERVERS[1].url); else F.store.del('rpc');
    F.setFete('');
    location.reload();
  };
  $('#practiceGo').onclick = () => switchNet(true);
  $('#practiceOff').onclick = () => switchNet(false);
  $('#restoreOrg').onclick = async () => { if (await F.restoreFlow()) location.reload(); };

  $('#createBtn').onclick = async () => {
    const name = $('#fName').value.trim();
    const price = Number($('#fPrice').value);
    const supply = Math.floor(Number($('#fSupply').value));
    if (!name) return F.toast('Enter your fete\'s name', 'bad');
    if (!(price >= 0.01)) return F.toast('Enter a ticket price', 'bad');
    if (!(supply >= 1)) return F.toast('Enter how many tickets to create', 'bad');
    try {
      const [bal, gp] = await Promise.all([F.creditBalance(), F.gasPrice()]);
      if (bal < 2000000n * gp) {
        $('#howXdc').open = true;
        return F.alertSheet('Add running credit first', 'Step 1 needs a little XDC before your tickets can be created. Open "How do I get XDC?" for help.');
      }
    } catch (e) { return F.showError(e); }
    const ok = await F.confirmSheet('Create ' + supply.toLocaleString() + ' tickets?',
      '<b>' + esc(name) + '</b><br>1 ticket = ' + F.dollars(price) + (practice() ? '<br><br><b>Practice fete</b> (pretend credit).' : '') + '<br><br>You can change the name and price later.', 'Create tickets', 'Cancel');
    if (!ok) return;
    const b = F.busy('Creating your tickets…');
    try {
      await F.createFete(name, supply, Math.round(price * 100));
      teamList = [];
      b.close();
      F.$$('[data-fete-name]').forEach((e) => (e.textContent = name));
      showPublished();
    } catch (e) {
      b.close();
      if (e.code === 'TIMEOUT') {
        await F.alertSheet('Still creating your tickets', 'The network is slow. Please don\'t tap Create again — reopen this app in a minute or two and it will carry on from here automatically.');
        const again = await F.recoverPendingFete();
        if (again) { teamList = []; showPublished(); }
      } else F.showError(e);
    }
  };

  function showPublished() {
    clearInterval(creditTimer);
    $('#pubBackupDone').hidden = !flags().backup;
    F.showView('published');
  }
  $('#pubBackup').onclick = async () => {
    if (await F.backupFlow(false)) { setFlag('backup'); $('#pubBackupDone').hidden = false; }
  };
  $('#pubInvite').onclick = () => showInvite();
  $('#pubDone').onclick = async () => {
    if (!flags().backup && !(await F.confirmSheet('Skip the backup?', 'Your backup is how you get the fete back if this phone is lost. It takes 20 seconds.', 'Skip for now', 'Save it now', true))) {
      return $('#pubBackup').click();
    }
    dash();
  };

  // ---------------------------------------------------------------- invite helpers
  function inviteText(role) {
    const fete = F.state.info ? F.state.info.name : 'our fete';
    const app = role === 'booth' ? 'Ticket Booth' : 'Fete Stall';
    return 'Hi! Thanks for helping at ' + fete + '. Please open this link on your phone to set up the ' + app + ' app (takes a minute), then show me your code:\n' + F.appUrl(role, true);
  }
  function showInvite() {
    $$('[data-share]').forEach((b) => (b.onclick = async () => {
      const text = inviteText(b.dataset.share);
      setFlag('invited');
      if (navigator.share) { try { await navigator.share({ text }); } catch (e) { } }
      else { F.copyText(text); F.toast('Message copied — paste it into a text or email', 'ok'); }
    }));
    $$('[data-copylink]').forEach((b) => (b.onclick = () => { setFlag('invited'); F.copyText(F.appUrl(b.dataset.copylink, true)); }));
    F.showView('invite');
  }
  $('#inviteBtn2').onclick = showInvite;

  // ---------------------------------------------------------------- dashboard
  async function dash() {
    clearInterval(creditTimer);
    $('#backupNag').hidden = !!flags().backup;
    $('#dPrice').textContent = F.state.info ? '1 ticket = ' + F.dollars(cents() / 100) + (practice() ? ' · Practice fete' : '') : '';
    renderTeam();
    renderChecklist();
    F.showView('dash');
    refreshDash();
  }
  let lastCredit = null;
  async function refreshDash() {
    try {
      const [t, c, one] = await Promise.all([F.ticketBalance(), F.creditBalance(), F.costOfOne(true)]);
      lastCredit = c;
      $('#dTickets').textContent = F.fmt(t);
      $('#dCredit').textContent = F.xdc(c) + ' XDC';
      const w = $('#creditWarn');
      w.hidden = c > one * 50n;
      w.innerHTML = '<b>Running credit is low.</b> Tap <b>Credit</b> to add more.';
    } catch (e) { }
    await refreshTeam();
    renderChecklist();
  }

  function renderChecklist() {
    const f = flags(), t = team();
    const items = [
      ['Tickets created', true],
      ['Organiser backup saved', !!f.backup, () => $('#backupNow').click()],
      ['Helpers invited', !!f.invited || t.length > 0, showInvite],
      ['At least one ticket booth added', t.some((m) => m.kind === 'B'), () => $('#addMember').click()],
      ['Stalls added', t.some((m) => m.kind === 'S'), () => $('#addMember').click()],
      ['Posters printed or shared', !!f.posters, () => $('#postersBtn').click()],
      ['Read "On the day"', !!f.dayguide, () => $('#dayGuideBtn').click()]
    ];
    const done = items.filter((i) => i[1]).length;
    $('#checklistCard').hidden = done === items.length;
    $('#checklist').innerHTML = items.map((it, i) =>
      '<li data-ck="' + i + '" style="cursor:' + (it[1] ? 'default' : 'pointer') + '"><div class="ico" style="background:' + (it[1] ? 'var(--ok-soft)' : 'var(--bg)') + '">' + (it[1] ? '✓' : (i + 1)) + '</div>' +
      '<div class="grow"><b style="' + (it[1] ? 'color:var(--muted);font-weight:500' : '') + '">' + it[0] + '</b></div>' + (it[1] ? '' : '<div class="muted">›</div>') + '</li>').join('');
    $$('#checklist [data-ck]').forEach((li) => { const it = items[Number(li.dataset.ck)]; if (!it[1] && it[2]) li.onclick = it[2]; });
  }

  let teamBal = {};
  function renderTeam() {
    const t = team();
    $('#team').innerHTML = t.length ? t.map((m, i) => {
      const b = teamBal[m.address.toLowerCase()];
      return '<li data-m="' + i + '" style="cursor:pointer"><div class="ico">' + (m.kind === 'B' ? '🎟️' : '🍭') + '</div><div class="grow"><b>' + esc(m.name) + '</b><span>' +
        (m.kind === 'B' ? 'Ticket booth' : 'Stall') + (b ? ' · credit ' + F.xdc(b.c) + ' XDC' : '') + '</span></div>' +
        '<div class="amt">' + (b ? F.fmt(b.t) : '…') + '<div class="small muted" style="font-weight:400">tickets</div></div></li>';
    }).join('') : '<li class="empty">No booths or stalls yet. Tap <b>Invite helpers</b> to send them their link, then scan each helper\'s code.</li>';
    $$('#team [data-m]').forEach((li) => (li.onclick = () => memberActions(Number(li.dataset.m))));
  }
  let lastTeamRefresh = 0;
  async function refreshTeam(force) {
    // Many stalls = many balance look-ups; don't repeat them every time the dashboard opens.
    if (!force && Date.now() - lastTeamRefresh < 15000) return renderTeam();
    lastTeamRefresh = Date.now();
    try { teamList = await F.helperList(); } catch (e) { }
    await Promise.all(team().map(async (m) => {
      try {
        const [tk, c] = await Promise.all([F.ticketBalance(m.address), F.creditBalance(m.address)]);
        teamBal[m.address.toLowerCase()] = { t: tk, c };
      } catch (e) { }
    }));
    renderTeam();
  }
  $('#refreshTeam').onclick = () => { lastTeamRefresh = 0; refreshDash(); F.toast('Updated'); };
  $$('[data-dash]').forEach((b) => (b.onclick = dash));
  $('#backupNow').onclick = async () => { if (await F.backupFlow(false)) setFlag('backup'); dash(); };

  // ---------------------------------------------------------------- team: add & manage
  $('#addMember').onclick = async () => {
    const c = await F.scan({
      title: 'Scan the helper\'s code',
      hint: 'In their Ticket Booth or Fete Stall app, they tap "Show this booth\'s / stall\'s code"',
      check: (p) => (p.kind === 'B' || p.kind === 'S') ? null : p.kind === 'C' ? 'That\'s a customer code. Use "Give tickets" for customers.' : 'That\'s not a booth or stall code.'
    });
    if (!c) return;
    const existing = team().findIndex((m) => F.sameAddr(m.address, c.address));
    if (existing >= 0) { F.toast('Already on your team'); return memberActions(existing); }
    const isBooth = c.kind === 'B';
    const r = await F.sheet({
      title: isBooth ? 'Add a ticket booth' : 'Add a stall',
      html: '<label class="field"><span>Name</span><input class="input" id="mName" maxlength="30" value="' + esc(c.name || (isBooth ? 'Ticket booth' : 'Stall')) + '"></label>' +
        (isBooth ? '<label class="field"><span>Tickets to load for selling</span><input class="input" id="mTix" type="number" inputmode="numeric" value="2000"></label>' : '') +
        '<label class="field"><span>Running credit to give (XDC)</span><input class="input" id="mCred" type="number" inputmode="decimal" value="' + esc(isBooth ? F.CFG.boothCredit : F.CFG.stallCredit) + '"></label>' +
        '<p class="small muted">' + (isBooth ? 'The booth passes a little credit to each customer it sells to, so customers can pay at stalls.' : 'Stalls only use credit when giving refunds, so a little goes a long way.') + '</p>',
      buttons: [{ label: 'Add &amp; send', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => ($('#mName', ov).value.trim() ? null : 'Enter a name.')
    });
    if (!r.value) return;
    const name = $('#mName', r.el).value.trim();
    const tix = isBooth ? Math.max(0, Number($('#mTix', r.el).value) || 0) : 0;
    const cred = Math.max(0, Number($('#mCred', r.el).value) || 0);
    const b = F.busy('Adding ' + name + '…');
    try {
      await F.addHelper(c.address, F.toWei(tix), XDC(cred), isBooth ? 1 : 2, name);
      b.close();
      await F.splash('Added ' + name, [tix ? F.tix(tix) : '', cred ? cred + ' XDC credit' : ''].filter(Boolean).join(' + '));
    } catch (e) { b.close(); await F.showError(e); }
    lastTeamRefresh = 0;
    dash();
  };

  async function sendTo(m, tix, cred) {
    const b = F.busy('Sending to ' + m.name + '…');
    try {
      await F.sendTickets(m.address, F.toWei(tix), XDC(cred));
      b.close();
      await F.splash('Sent to ' + m.name, [tix ? F.tix(tix) : '', cred ? cred + ' XDC credit' : ''].filter(Boolean).join(' + '));
    } catch (e) { b.close(); await F.showError(e); }
  }

  async function memberActions(i) {
    const m = team()[i];
    if (!m) return;
    const bal = teamBal[m.address.toLowerCase()];
    const r = await F.sheet({
      title: m.name,
      html: '<p class="muted">' + (m.kind === 'B' ? 'Ticket booth' : 'Stall') + (bal ? ' · ' + F.tix(bal.t) + ' · ' + F.xdc(bal.c) + ' XDC credit' : '') + '</p>',
      buttons: [
        ...(m.kind === 'B' ? [{ label: '🎟️ Load more tickets', value: 'tix' }] : []),
        { label: '⚡ Top up running credit', value: 'cred', style: m.kind === 'B' ? 'secondary' : '' },
        { label: '🏷️ Rename', value: 'name', style: 'secondary' },
        { label: 'Remove from team', value: 'del', style: 'ghost' },
        { label: 'Close', value: null, style: 'ghost' }]
    });
    if (r.value === 'tix' || r.value === 'cred') {
      const isT = r.value === 'tix';
      const a = await F.sheet({
        title: isT ? 'Load tickets onto ' + m.name : 'Top up ' + m.name,
        html: '<label class="field"><span>' + (isT ? 'Tickets' : 'Running credit (XDC)') + '</span><input class="input money" id="amt" type="number" inputmode="decimal" value="' + (isT ? 1000 : (m.kind === 'B' ? F.CFG.boothCredit : F.CFG.stallCredit)) + '"></label>',
        buttons: [{ label: 'Send', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
        validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter an amount.')
      });
      if (!a.value) return;
      const v = Number($('#amt', a.el).value);
      await sendTo(m, isT ? v : 0, isT ? 0 : v);
      dash();
    } else if (r.value === 'name' || r.value === 'del') {
      let name = m.name, kind = m.kind === 'B' ? 1 : 2;
      if (r.value === 'name') {
        const a = await F.sheet({
          title: 'Rename', html: '<label class="field"><input class="input" id="nm" maxlength="30" value="' + esc(m.name) + '"></label>',
          buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
          validate: (ov) => ($('#nm', ov).value.trim() ? null : 'Enter a name.')
        });
        if (!a.value) return;
        name = $('#nm', a.el).value.trim();
      } else {
        if (!(await F.confirmSheet('Remove ' + esc(m.name) + '?', 'This only removes it from your team list. Any tickets on that phone stay there.', 'Remove', 'Cancel', true))) return;
        kind = 0; name = '';
      }
      const b = F.busy('Saving…');
      try { await F.addHelper(m.address, 0n, 0n, kind, name); b.close(); F.toast('Saved', 'ok'); }
      catch (e) { b.close(); await F.showError(e); }
      lastTeamRefresh = 0;
      dash();
    }
  }

  // ---------------------------------------------------------------- give tickets (prizes, volunteers)
  $('#giftBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Give tickets',
      html: '<p class="muted">For prizes, volunteers or fixing a mistake. The person shows their code in the Fete Tickets app (tap <b>Get tickets</b>).</p>' +
        '<label class="field"><span>Tickets</span><input class="input money" id="amt" type="number" inputmode="decimal" placeholder="0"></label>',
      buttons: [{ label: '📷 Scan their code', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => (Number($('#amt', ov).value) > 0 ? null : 'Enter how many tickets.')
    });
    if (!r.value) return;
    const n = Number($('#amt', r.el).value);
    const c = await F.scan({ title: 'Scan their code', check: (p) => (p.kind === 'C' || p.kind === 'B' || p.kind === 'S') ? null : 'That\'s not a person\'s code.' });
    if (!c) return;
    const b = F.busy('Sending…');
    try {
      let cred = 0n;
      try { if ((await F.creditBalance(c.address)) < XDC(F.CFG.customerCreditBelow)) cred = XDC(F.CFG.customerCredit); } catch (e) { }
      await F.sendTickets(c.address, F.toWei(n), cred);
      b.close();
      await F.splash('Sent!', F.tix(n));
      dash();
    } catch (e) { b.close(); F.showError(e); }
  };

  // ---------------------------------------------------------------- credit view
  $('#creditBtn').onclick = () => {
    creditBox($('#creditBox2'));
    $('#creditBox2').insertAdjacentHTML('afterbegin', '<details style="margin-bottom:12px"><summary><b>How do I get XDC?</b></summary><div style="margin-top:10px">' + howToGetXdc() + '</div></details>');
    const calc = () => {
      const n = Number($('#estPeople').value) || 0;
      $('#estOut').innerHTML = 'Suggested running credit: <b>about ' + estimate(n) + ' XDC</b>. Any credit left over stays in your account for next year.';
    };
    $('#estPeople').oninput = calc;
    calc();
    F.showView('credit');
  };

  // ---------------------------------------------------------------- report
  let lastCsv = '';
  $('#reportBtn').onclick = async () => {
    F.showView('report');
    $('#csvBtn').hidden = true;
    $('#repBody').innerHTML = '<div class="card center"><div class="spinner"></div><p id="repProg">Adding everything up…</p></div>';
    try {
      try { teamList = await F.helperList(); } catch (e) { }
      const transfers = await F.allTransfers((p) => { const el = $('#repProg'); if (el) el.textContent = 'Adding everything up… ' + Math.round(p * 100) + '%'; });
      await buildReport(transfers);
    } catch (e) {
      $('#repBody').innerHTML = '<div class="notice bad">Couldn\'t load the totals. Check the connection and try again.</div>';
    }
  };

  async function buildReport(transfers) {
    const org = F.state.info.organiser.toLowerCase();
    const t = everyone(); // removed booths/stalls still count towards the totals
    const byAddr = {};
    t.forEach((m) => (byAddr[m.address.toLowerCase()] = Object.assign({ given: 0n, sold: 0n, back: 0n, taken: 0n, refunded: 0n, returned: 0n, holding: 0n }, m)));
    const ZERO = '0x0000000000000000000000000000000000000000';
    const customers = new Set();
    let prizes = 0n;
    transfers.forEach((x) => {
      const f = x.from.toLowerCase(), to = x.to.toLowerCase(), v = x.value;
      if (f === ZERO) return;
      const mf = byAddr[f], mt = byAddr[to];
      const fCust = !mf && f !== org, tCust = !mt && to !== org;
      if (f === org && mt) mt.given += v;
      if (mf && to === org) mf.returned += v;
      if (f === org && tCust) prizes += v;
      if (mf && mf.kind === 'B' && tCust) mf.sold += v;
      if (mt && mt.kind === 'B' && fCust) mt.back += v;
      if (mt && mt.kind === 'S' && fCust) mt.taken += v;
      if (mf && mf.kind === 'S' && tCust) mf.refunded += v;
      if (tCust) customers.add(to);
    });
    const holdings = await Promise.all(t.map((m) => F.ticketBalance(m.address).catch(() => 0n)));
    t.forEach((m, i) => (byAddr[m.address.toLowerCase()].holding = holdings[i]));
    const [orgBal, supply] = await Promise.all([F.ticketBalance(org), F.state.token.totalSupply()]);
    const teamHeld = holdings.reduce((a, b) => a + b, 0n);
    const withCustomers = supply - orgBal - teamHeld;

    const booths = Object.values(byAddr).filter((m) => m.kind === 'B');
    const stalls = Object.values(byAddr).filter((m) => m.kind === 'S');
    const soldTotal = booths.reduce((s, m) => s + m.sold, 0n);
    const backTotal = booths.reduce((s, m) => s + m.back, 0n);
    const takenTotal = stalls.reduce((s, m) => s + m.taken - m.refunded, 0n);
    const M = (w) => F.money(w);

    const stat = (v, l) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>';
    let html = '<div class="card"><h2>Whole fete</h2><div class="stat-grid">' +
      stat(M(soldTotal - backTotal), 'ticket sales (after buy-backs)') +
      stat(F.fmt(soldTotal), 'tickets sold') +
      stat(F.fmt(takenTotal), 'tickets spent at stalls') +
      stat(customers.size, 'customer phones') +
      '</div><p class="small muted" style="margin:10px 0 0">Tickets still on customers\' phones: <b>' + F.fmt(withCustomers) + '</b> (' + M(withCustomers) + ').' +
      (prizes ? ' Given directly by you: ' + F.fmt(prizes) + '.' : '') + '</p></div>';

    html += '<div class="card"><h2>Ticket booths</h2>' + (booths.length ? '<ul class="list">' + booths.map((m) =>
      '<li><div class="grow"><b>' + esc(m.name) + (m.removed ? ' (removed)' : '') + '</b><span style="white-space:normal">Loaded ' + F.fmt(m.given) + ' · sold ' + F.fmt(m.sold) + ' · bought back ' + F.fmt(m.back) + ' · holding ' + F.fmt(m.holding) + (m.returned ? ' · returned ' + F.fmt(m.returned) : '') + '</span></div>' +
      '<div class="amt">' + M(m.sold - m.back) + '<div class="small muted" style="font-weight:400">cash + card</div></div></li>').join('') + '</ul>' : '<p class="empty">No booths on your team.</p>') +
      '<p class="small muted">Each booth\'s cash + card should match the amount shown. The booth app also splits cash and card.</p></div>';

    html += '<div class="card"><h2>Stalls</h2>' + (stalls.length ? '<ul class="list">' + stalls.sort((a, b) => (b.taken > a.taken ? 1 : -1)).map((m) =>
      '<li><div class="grow"><b>' + esc(m.name) + (m.removed ? ' (removed)' : '') + '</b><span style="white-space:normal">Took ' + F.fmt(m.taken) + (m.refunded ? ' · refunded ' + F.fmt(m.refunded) : '') + ' · holding ' + F.fmt(m.holding) + (m.returned ? ' · handed in ' + F.fmt(m.returned) : '') + '</span></div>' +
      '<div class="amt">' + M(m.taken - m.refunded) + '</div></li>').join('') + '</ul>' : '<p class="empty">No stalls on your team.</p>') + '</div>';
    $('#repBody').innerHTML = html;

    const n = (w) => F.toNum(w).toFixed(2);
    const rows = [['Type', 'Name', 'Code', 'Loaded by organiser', 'Sold to customers', 'Bought back', 'Taken from customers', 'Refunded', 'Handed in / returned', 'Holding now', 'Money value']];
    booths.forEach((m) => rows.push(['Ticket booth', m.name, m.address, n(m.given), n(m.sold), n(m.back), '', '', n(m.returned), n(m.holding), (F.toNum(m.sold - m.back) * cents() / 100).toFixed(2)]));
    stalls.forEach((m) => rows.push(['Stall', m.name, m.address, n(m.given), '', '', n(m.taken), n(m.refunded), n(m.returned), n(m.holding), (F.toNum(m.taken - m.refunded) * cents() / 100).toFixed(2)]));
    rows.push([], ['Customer phones', customers.size], ['Tickets still with customers', n(withCustomers)], ['Ticket price (cents)', cents()]);
    lastCsv = rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
    $('#csvBtn').hidden = false;
  }
  $('#csvBtn').onclick = () => {
    const blob = new Blob([lastCsv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fete-totals-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------------------------------------------------------------- posters & helper sheets
  $('#postersBtn').onclick = () => {
    const name = esc(F.state.info ? F.state.info.name : 'Our fete');
    const price = F.dollars(cents() / 100);
    const big = 'style="text-align:left;font-size:20px"';
    const P = [
      { id: 'cust', title: 'Pay with your phone!', sub: name, qr: F.appUrl('customer', true),
        body: '<ol class="steps" ' + big + '><li>Scan this code with your phone’s camera.</li><li>Tap <b>Get started</b> — no download needed.</li><li>Buy tickets at the <b>ticket booth</b> (1 ticket = ' + price + '). At stalls, scan their code to pay.</li></ol>' },
      { id: 'booth', title: 'Ticket Booth helper', sub: name + ' — scan with your phone’s camera', qr: F.appUrl('booth', true),
        body: '<ol class="steps" ' + big + '><li>Open the link, tap <b>Add to my home screen</b> (or follow the steps), then open <b>Ticket Booth</b>.</li><li>Tap <b>Set up this booth phone</b> and text yourself the backup.</li><li>Tap <b>Show this booth’s code</b> and show it to the organiser.</li></ol>' +
          '<div class="notice info" style="text-align:left;font-size:17px"><b>Selling:</b> take the money → tap the amount → <b>Cash</b> or <b>Card</b> → scan the customer’s code → green tick.<br><b>Customer can’t pay?</b> Tap <b>Fix a phone</b> and scan them.</div>' },
      { id: 'stall', title: 'Stall helper', sub: name + ' — scan with your phone’s camera', qr: F.appUrl('stall', true),
        body: '<ol class="steps" ' + big + '><li>Open the link, add <b>Fete Stall</b> to your home screen, then open it.</li><li>Tap <b>Set up my stall</b>, text yourself the backup, enter your stall name and items.</li><li>Open <b>Today</b> → <b>Show this stall’s code</b> and show it to the organiser.</li></ol>' +
          '<div class="notice info" style="text-align:left;font-size:17px"><b>Selling:</b> tap the items → <b>Charge</b> → the customer scans → big green <b>PAID</b>. No tick, no sale.</div>' }
    ];
    $('#posterList').innerHTML = P.map((p) =>
      '<div class="card center poster" data-p="' + p.id + '" style="padding:28px 20px">' +
      '<h1 style="font-size:34px;margin:0 0 4px">' + p.title + '</h1><p class="muted" style="font-size:18px">' + p.sub + '</p>' +
      '<div class="qr big" style="box-shadow:none;border:3px solid var(--line)">' + F.qrSvg(p.qr) + '</div>' + p.body +
      '<p class="small muted print-only">Built by ' + esc(F.CFG.builtBy) + '</p>' +
      '<div class="no-print grid2" style="margin-top:12px"><button class="btn small" style="width:100%" data-print="' + p.id + '">🖨️ Print</button>' +
      '<button class="btn secondary small" style="width:100%" data-copy="' + esc(p.qr) + '">Copy link</button></div></div>').join('');
    $$('[data-print]').forEach((b) => (b.onclick = () => {
      setFlag('posters');
      const el = $('[data-p="' + b.dataset.print + '"]');
      el.classList.add('print-area');
      window.print();
      setTimeout(() => el.classList.remove('print-area'), 500);
    }));
    $$('[data-copy]').forEach((b) => (b.onclick = () => { setFlag('posters'); F.copyText(b.dataset.copy); }));
    F.showView('posters');
  };

  $('#dayGuideBtn').onclick = () => { setFlag('dayguide'); F.showView('dayguide'); };

  // ---------------------------------------------------------------- fete name / price
  $('#feteSettingsBtn').onclick = async () => {
    const r = await F.sheet({
      title: 'Fete name & ticket price',
      html: '<label class="field"><span>Fete name</span><input class="input" id="sName" maxlength="40" value="' + esc(F.state.info.name) + '"></label>' +
        '<label class="field"><span>Price of one ticket (' + esc(F.CFG.currency) + ')</span><input class="input" id="sPrice" type="number" inputmode="decimal" step="0.05" value="' + (cents() / 100).toFixed(2) + '"></label>' +
        '<p class="small muted">Booths pick up a new price straight away. Avoid changing the price once selling has started.</p>',
      buttons: [{ label: 'Save', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      validate: (ov) => !$('#sName', ov).value.trim() ? 'Enter a name.' : !(Number($('#sPrice', ov).value) >= 0.01) ? 'Enter a price.' : null
    });
    if (!r.value) return;
    const b = F.busy('Saving…');
    try {
      await F.sendAndWait({
        to: F.feteAddress(), gasLimit: 200000n,
        data: F.iface.encodeFunctionData('setSettings', [$('#sName', r.el).value.trim(), Math.round(Number($('#sPrice', r.el).value) * 100)])
      });
      await F.loadInfo(true);
      b.close();
      F.toast('Saved', 'ok');
      dash();
    } catch (e) { b.close(); F.showError(e); }
  };

  $('#settingsBtn').onclick = () => F.openSettings(
    F.feteAddress() ? '<button class="btn secondary" data-x="new">➕ Set up a different fete (e.g. next year)</button>' : '',
    (ov, act) => { const b = $('[data-x="new"]', ov); if (b) b.onclick = () => act('new'); }
  ).then(async (a) => {
    if (a !== 'new') return;
    if (await F.confirmSheet('Set up a different fete?', 'This phone will stop showing the current fete (nothing is deleted — your backup message still opens it). Use this for next year\'s fete.', 'Continue', 'Cancel')) {
      F.setFete('');
      location.reload();
    }
  });

  // ---------------------------------------------------------------- start
  if (!F.feteAddress()) {
    // Was creating tickets interrupted (app closed / slow network)? Pick it up again.
    const recovered = await F.recoverPendingFete();
    if (recovered) { teamList = []; return showPublished(); }
    return showSetup();
  }
  // Restored from a backup that already contained this fete? Then the backup is clearly saved.
  if (F.store.get('organiser.restoredFete') === F.feteAddress().toLowerCase() && !flags().backup) setFlag('backup');
  if (F.state.info && !F.sameAddr(F.state.info.organiser, me())) {
    const r = await F.sheet({
      title: 'This phone isn\'t the organiser yet',
      html: '<p><b>' + esc(F.state.info.name) + '</b> was set up on another phone. To run it from this phone, restore the organiser\'s backup message.</p>',
      buttons: [{ label: 'Restore organiser backup', value: 'restore' }, { label: 'Set up a new fete instead', value: 'new', style: 'secondary' }],
      dismissable: false
    });
    if (r.value === 'restore') { if (await F.restoreFlow()) return location.reload(); }
    F.setFete('');
    return location.reload();
  }
  dash();
})();
