/*
 * Fete Tickets — shared engine used by every app.
 * Built by XDC Outpost.
 *
 * Plain-language rule: nothing the user sees should mention blockchains,
 * wallets, keys, gas or contracts. Inside the code we use the real terms.
 *   "tickets"         = the fete's token
 *   "running credit"  = XDC used to pay network fees
 *   "your code"       = the phone's address, shown as a QR
 *   "backup code"     = the phone's private key, sent to itself by text
 */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const CFG = Object.assign({
    feteAddress: '',
    defaultRpc: 'https://rpc.plugin.global/xdcmainnet',
    currency: '$',
    customerCredit: '0.05',
    customerCreditBelow: '0.01',
    stallCredit: '0.5',
    boothCredit: '10',
    builtBy: 'XDC Outpost',
    builtByUrl: 'https://xdcoutpost.xyz'
  }, window.FETE_CONFIG || {});

  const SERVERS = [
    { id: 'main', label: 'Normal (recommended)', url: 'https://rpc.plugin.global/xdcmainnet', chainId: 50 },
    { id: 'test', label: 'Practice mode (test network)', url: 'https://rpc.plugin.global/xdcapothem', chainId: 51 }
  ];

  const APPS = {
    customer:  { name: 'Fete Tickets',   path: 'customer/',  icon: 'customer' },
    booth:     { name: 'Ticket Booth',   path: 'booth/',     icon: 'booth' },
    stall:     { name: 'Fete Stall',     path: 'stall/',     icon: 'stall' },
    organiser: { name: 'Fete Organiser', path: 'organiser/', icon: 'organiser' }
  };

  // Gas limits are fixed (no estimate round-trip) so payments feel instant.
  const GAS_TRANSFER = 90000n;
  const GAS_GIVE = 150000n;

  const ethers = window.ethers;
  const ABI = window.FETE_CONTRACT.abi;
  const BYTECODE = window.FETE_CONTRACT.bytecode;
  const iface = new ethers.Interface(ABI);
  const TRANSFER_TOPIC = iface.getEvent('Transfer').topicHash;
  const HELPER_TOPIC = iface.getEvent('HelperSet').topicHash;

  // ------------------------------------------------------------------ storage
  const NS = 'xdcfete.';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage full / private */ } },
    del(k) { try { localStorage.removeItem(NS + k); } catch (e) { } }
  };

  let ROLE = 'customer';
  const rk = (k) => ROLE + '.' + k;  // role-scoped key (several apps may share one phone)
  // role + fete scoped key: history, "already paid" lists, totals etc. never mix between fetes
  const fk = (k) => rk(k) + '.' + (feteAddress() || 'none').toLowerCase();
  const fstore = { get: (k, d) => store.get(fk(k), d), set: (k, v) => store.set(fk(k), v), del: (k) => store.del(fk(k)) };

  // The fete (and which network) travels in the page address: ?fete=0x…[&net=test][&rpc=…]
  // We remember it on the phone AND keep it in the address bar, so a bookmark or
  // "Add to Home Screen" saves a link that already knows the fete. (The manifests
  // deliberately have no start_url, so the home-screen app opens that exact link.)
  // Nothing in the website needs editing for a new fete or a new school.
  (function readLinkParams() {
    const p = new URLSearchParams(location.search);
    const f = p.get('fete');
    if (f && /^(0x|xdc)[0-9a-f]{40}$/i.test(f)) noteSwitch('0x' + f.slice(-40));
    if (p.get('rpc')) store.set('rpc', p.get('rpc'));
    else if (p.get('net') === 'test') store.set('rpc', SERVERS[1].url);
    else if (f || p.get('net') === 'main') store.del('rpc');
  })();

  /** Remember the new fete, and which fete this phone was on before (so we can tell the person). */
  function noteSwitch(next) {
    const prev = store.get('fete');
    if (next && prev && prev !== 'none' && prev.toLowerCase() !== next.toLowerCase()) store.set('switchedFrom', prev);
    store.set('fete', next || 'none');
  }

  const rpcUrl = () => store.get('rpc') || CFG.defaultRpc;
  const feteAddress = () => { const s = store.get('fete'); if (s === 'none') return ''; return s || CFG.feteAddress || ''; };

  function linkQuery(fete) {
    const q = new URLSearchParams();
    if (fete) q.set('fete', fete);
    const r = rpcUrl();
    if (r === SERVERS[1].url) q.set('net', 'test');
    else if (r !== CFG.defaultRpc && r !== SERVERS[0].url) q.set('rpc', r);
    return q.toString();
  }
  /** Keep the address bar in step with the fete this phone belongs to. */
  function syncUrl() {
    const extra = new URLSearchParams(location.search);
    ['fete', 'net', 'rpc'].forEach((k) => extra.delete(k));
    const q = new URLSearchParams(linkQuery(feteAddress()));
    extra.forEach((v, k) => q.set(k, v));
    const qs = q.toString();
    const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      try { history.replaceState(null, '', url); } catch (e) { }
    }
  }
  /** Switch this phone to a fete (or to none). chainId picks the matching server. */
  function setFete(addr, chainId, quiet) {
    noteSwitch(addr);
    if (quiet || !addr) store.del('switchedFrom');
    if (chainId) {
      const srv = SERVERS.find((x) => x.chainId === chainId);
      if (srv) { if (srv.url === CFG.defaultRpc) store.del('rpc'); else store.set('rpc', srv.url); }
    }
    syncUrl();
  }

  // ------------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';

  function toWei(n) {
    const v = Math.round(Number(n) * 100) / 100;
    if (!isFinite(v) || v < 0) throw new Error('Bad amount');
    return ethers.parseUnits(v.toFixed(2), 18);
  }
  const toNum = (wei) => Number(ethers.formatUnits(wei, 18));
  function fmt(n, dp = 2) {
    const v = typeof n === 'bigint' ? toNum(n) : Number(n);
    const r = Math.round(v * 100) / 100;
    return r.toLocaleString(undefined, { maximumFractionDigits: dp });
  }
  const ticketWord = (n) => (Math.abs((typeof n === 'bigint' ? toNum(n) : n) - 1) < 0.005 ? 'ticket' : 'tickets');
  const tix = (n) => fmt(n) + ' ' + ticketWord(n);
  function money(ticketsNum, cents) {
    cents = cents == null ? (state.info && state.info.cents) : cents;
    if (!cents) return '';
    const v = (typeof ticketsNum === 'bigint' ? toNum(ticketsNum) : ticketsNum) * cents / 100;
    return CFG.currency + (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const dollars = (v) => CFG.currency + (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const xdc = (wei) => Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const isAddr = (a) => /^(0x|xdc)[0-9a-fA-F]{40}$/.test(String(a || '').trim());
  const normAddr = (a) => ethers.getAddress('0x' + String(a).trim().slice(-40).toLowerCase());
  const sameAddr = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  const timeStr = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayKey = (t) => new Date(t).toDateString();
  const isToday = (t) => dayKey(t) === dayKey(Date.now());

  class Friendly extends Error {
    constructor(title, msg, code) { super(msg); this.title = title; this.code = code; }
  }

  function friendly(err) {
    if (err instanceof Friendly) return err;
    const m = String((err && (err.shortMessage || err.message)) || err || '').toLowerCase();
    if (m.includes('insufficient funds')) return new Friendly('Running credit is empty', creditHelp(), 'NO_CREDIT');
    if (m.includes('not enough tickets')) return new Friendly('Not enough tickets', 'There aren\'t enough tickets on this phone for that.', 'NO_TICKETS');
    if (m.includes('only the organiser')) return new Friendly('Organiser only', 'Only the organiser\'s phone can do that.');
    if (m.includes('nonce') || m.includes('replacement')) return new Friendly('Please try again', 'The last action was still finishing. Wait a few seconds and try again.');
    if (m.includes('timeout') || m.includes('timed out')) return new Friendly('Still processing', 'This is taking longer than normal. Check the balance in a moment before trying again.', 'TIMEOUT');
    if (m.includes('failed to fetch') || m.includes('network') || m.includes('could not detect') || m.includes('fetch') || !navigator.onLine)
      return new Friendly('No connection', 'Can\'t reach the fete system. Check this phone has internet (Wi-Fi or mobile data) and try again.', 'OFFLINE');
    return new Friendly('Something went wrong', 'Please try again. If it keeps happening, ask a fete organiser for help.');
  }
  function creditHelp() {
    if (ROLE === 'customer') return 'This app needs a quick top-up. Visit the ticket booth and ask them to "top up my app" — it\'s free and takes a few seconds.';
    if (ROLE === 'organiser') return 'Your organiser account needs more running credit (XDC). Open "Running credit" on the main screen to add some.';
    return 'This phone needs more running credit. Ask the fete organiser to top it up — they just scan this phone\'s code.';
  }

  // ------------------------------------------------------------------ state
  const state = {
    provider: null, chainId: null, wallet: null, token: null, info: null,
    gasPrice: null, gasPriceAt: 0, online: true
  };

  async function rawRpc(url, method, params, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }), signal: ctl.signal
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } finally { clearTimeout(t); }
  }

  async function connect() {
    const url = rpcUrl();
    const cid = Number(await rawRpc(url, 'eth_chainId', []));
    const net = ethers.Network.from(cid);
    state.chainId = cid;
    state.provider = new ethers.JsonRpcProvider(url, net, { staticNetwork: net, batchMaxCount: 1, polling: true, pollingInterval: 1500 });
    if (state.wallet) state.wallet = state.wallet.connect(state.provider);
    const fa = feteAddress();
    state.token = fa ? new ethers.Contract(fa, ABI, state.wallet || state.provider) : null;
    setOnline(true);
    return state.provider;
  }

  async function retry(fn, tries = 3, delay = 700) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { const v = await fn(); setOnline(true); return v; }
      catch (e) { last = e; await sleep(delay * (i + 1)); }
    }
    if (friendly(last).code === 'OFFLINE') setOnline(false);
    throw last;
  }

  function setOnline(on) {
    if (state.online === on) return;
    state.online = on;
    let bar = $('#netbar');
    if (!on && !bar) {
      bar = document.createElement('div');
      bar.id = 'netbar'; bar.className = 'netbar';
      bar.textContent = 'No connection — retrying…';
      const top = $('.topbar');
      top ? top.after(bar) : document.body.prepend(bar);
    } else if (on && bar) bar.remove();
  }
  window.addEventListener('offline', () => setOnline(false));

  async function loadInfo(force) {
    const fa = feteAddress();
    if (!fa) return null;
    const cacheKey = 'info.' + fa.toLowerCase();
    const cached = store.get(cacheKey);
    if (cached && !force) state.info = cached;
    try {
      const t = state.token;
      const [name, cents, organiser, createdAtBlock] = await retry(() => Promise.all([
        t.name(), t.centsPerTicket(), t.organiser(), t.createdAtBlock()
      ]));
      state.info = { address: fa, name, cents: Number(cents), organiser, createdAtBlock: Number(createdAtBlock), chainId: state.chainId };
      store.set(cacheKey, state.info);
      const known = store.get('fetes', []).filter((x) => x.address.toLowerCase() !== fa.toLowerCase());
      known.unshift({ address: fa, name, chainId: state.chainId, rpc: store.get('rpc') || null, last: Date.now() });
      store.set('fetes', known.slice(0, 20));
    } catch (e) {
      if (!state.info) throw new Friendly('Fete not found', 'This phone can\'t find the fete\'s tickets. Check the connection, or scan the fete setup code again (Settings).', 'NOFETE');
    }
    $$('[data-fete-name]').forEach((el) => (el.textContent = state.info.name));
    return state.info;
  }

  // ------------------------------------------------------------------ wallet
  function loadWallet() {
    const pk = store.get(rk('key'));
    if (!pk) return null;
    try {
      state.wallet = new ethers.Wallet(pk, state.provider || undefined);
      if (state.token) state.token = state.token.connect(state.wallet);
      return state.wallet;
    } catch (e) { return null; }
  }
  function saveKey(pk) {
    store.set(rk('key'), pk);
    store.set(rk('created'), Date.now());
    loadWallet();
  }
  function parseBackup(text) {
    const s = String(text || '');
    let m = s.match(/FT1-([0-9a-fA-F]{64})/);
    if (!m) m = s.match(/(?:^|[^0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/);
    if (!m) return null;
    try { return new ethers.Wallet('0x' + m[1]).privateKey; } catch (e) { return null; }
  }
  /** A backup message also carries the fete link, so restoring brings the fete back too. */
  function parseFeteLink(text) {
    const s = String(text || '');
    const m = s.match(/[?&]fete=((?:0x|xdc)[0-9a-fA-F]{40})/);
    if (!m) return null;
    const rpc = s.match(/[?&]rpc=([^\s&]+)/);
    return { address: normAddr(m[1]), chainId: /[?&]net=test/.test(s) ? 51 : (rpc ? null : 50), rpc: rpc ? decodeURIComponent(rpc[1]) : null };
  }
  const myAddress = () => state.wallet && state.wallet.address;

  function appUrl(role, withFete) {
    const base = new URL('../', location.href);
    let u = new URL(APPS[role].path, base).href;
    const q = linkQuery(withFete ? feteAddress() : '');
    if (q) u += '?' + q;
    return u;
  }

  function backupText() {
    const app = APPS[ROLE].name;
    return app + ' backup – KEEP THIS MESSAGE.\n' +
      'If your tickets disappear (new phone, phone reset, browser cleared), open ' + app + ' again using the link below or the fete poster, tap "I\'ve used this before" and paste this whole message.\n\n' +
      'Backup code: FT1-' + state.wallet.privateKey.slice(2) + '\n\n' +
      'App: ' + appUrl(ROLE, true);
  }

  // ------------------------------------------------------------------ chain reads
  const ticketBalance = (addr) => retry(() => state.token.balanceOf(addr || myAddress()));
  const creditBalance = (addr) => retry(() => state.provider.getBalance(addr || myAddress()));
  // Ask the server directly (the library may hand back a briefly cached number).
  const blockNumber = () => retry(async () => Number(await state.provider.send('eth_blockNumber', [])));

  async function gasPrice() {
    if (state.gasPrice && Date.now() - state.gasPriceAt < 60000) return state.gasPrice;
    const gp = BigInt(await retry(() => state.provider.send('eth_gasPrice', [])));
    state.gasPrice = gp + gp / 10n;
    state.gasPriceAt = Date.now();
    return state.gasPrice;
  }
  async function costOfOne(give) { return (give ? GAS_GIVE : GAS_TRANSFER) * (await gasPrice()); }

  // ------------------------------------------------------------------ chain writes
  /**
   * Send tickets (and optionally running credit) to someone.
   * Resolves with { hash } once confirmed. Throws Friendly errors.
   */
  async function sendTickets(to, ticketsWei, creditWei = 0n) {
    if (!state.wallet || !state.token) throw new Friendly('Not ready', 'The app is still starting. Try again in a moment.');
    to = normAddr(to);
    if (sameAddr(to, myAddress())) throw new Friendly('That\'s this phone', 'You scanned this phone\'s own code. Scan the other person\'s code instead.');
    const useGive = creditWei > 0n || ticketsWei === 0n;
    const gp = await gasPrice();
    const gasLimit = useGive ? GAS_GIVE : GAS_TRANSFER;
    const [credit, tickets] = await Promise.all([creditBalance(), ticketsWei > 0n ? ticketBalance() : Promise.resolve(0n)]);
    if (ticketsWei > tickets) throw new Friendly('Not enough tickets', 'This phone only has ' + tix(tickets) + '.', 'NO_TICKETS');
    if (credit < gasLimit * gp + creditWei) {
      if (creditWei > 0n && ticketsWei > 0n && credit >= gasLimit * gp) {
        creditWei = 0n; // can still send tickets, just not pass credit along
      } else throw new Friendly('Running credit is empty', creditHelp(), 'NO_CREDIT');
    }
    const data = useGive && (creditWei > 0n || ticketsWei === 0n)
      ? iface.encodeFunctionData('give', [to, ticketsWei])
      : iface.encodeFunctionData('transfer', [to, ticketsWei]);
    let tx;
    try {
      tx = await state.wallet.sendTransaction({
        to: feteAddress(), data, value: creditWei, gasLimit, gasPrice: gp, type: 0, chainId: state.chainId
      });
    } catch (e) { throw friendly(e); }
    return waitTx(tx.hash);
  }

  /** Wait for a transaction to be confirmed by polling its receipt directly (no block subscriptions). */
  async function waitTx(hash, timeoutMs = 90000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      let rc = null;
      try { rc = await state.provider.send('eth_getTransactionReceipt', [hash]); setOnline(true); }
      catch (e) { if (friendly(e).code === 'OFFLINE') setOnline(false); }
      if (rc && rc.blockNumber) {
        if (Number(rc.status) !== 1) throw new Friendly('That didn\'t go through', 'Nothing was sent. Please try again.');
        return { hash, block: Number(rc.blockNumber) };
      }
      await sleep(900);
    }
    throw new Friendly('Still processing', 'This is taking longer than normal. Check the balance in a moment before trying again.', 'TIMEOUT');
  }

  async function createFete(name, wholeTickets, cents) {
    const gp = await gasPrice();
    const factory = new ethers.ContractFactory(ABI, BYTECODE, state.wallet);
    let c;
    try {
      c = await factory.deploy(name, BigInt(wholeTickets), BigInt(cents), { gasPrice: gp, type: 0, gasLimit: 2000000n, chainId: state.chainId });
    } catch (e) { throw friendly(e); }
    await waitTx(c.deploymentTransaction().hash);
    const addr = await c.getAddress();
    setFete(addr);
    state.token = new ethers.Contract(addr, ABI, state.wallet);
    await loadInfo(true);
    return addr;
  }

  async function sendCreditOnly(to, wei) {
    // Plain XDC transfer — used by the organiser for running credit.
    const gp = await gasPrice();
    let tx;
    try {
      tx = await state.wallet.sendTransaction({ to: normAddr(to), value: wei, gasLimit: 21000n, gasPrice: gp, type: 0, chainId: state.chainId });
    } catch (e) { throw friendly(e); }
    return waitTx(tx.hash);
  }

  // ------------------------------------------------------------------ payment requests
  /** A unique amount just under the asked price, so the stall can recognise this exact payment. */
  function uniqueAmount(tickets) {
    const base = toWei(tickets);
    const jitter = BigInt(1 + Math.floor(Math.random() * 999999)) * 1000000n; // < 0.000001 ticket
    return base - jitter;
  }

  /**
   * Watch for an incoming payment of exactly `amount`.
   * Returns { stop() }. Calls onPaid({ from, hash }) once.
   */
  function watchPayment(amount, fromBlock, startBalance, onPaid) {
    let stopped = false;
    const me = myAddress();
    const toTopic = ethers.zeroPadValue(me, 32).toLowerCase();
    (async function loop() {
      while (!stopped) {
        try {
          const logs = await state.provider.send('eth_getLogs', [{
            address: feteAddress(), fromBlock: ethers.toQuantity(Math.max(0, fromBlock - 2)), toBlock: 'latest',
            topics: [TRANSFER_TOPIC, null, toTopic]
          }]);
          setOnline(true);
          const hit = logs.find((l) => BigInt(l.data) === amount);
          if (hit && !stopped) { stopped = true; onPaid({ from: normAddr(hit.topics[1]), hash: hit.transactionHash }); return; }
        } catch (e) {
          // fallback: balance went up by at least the amount
          try {
            const b = await state.token.balanceOf(me);
            setOnline(true);
            if (b - startBalance >= amount && !stopped) { stopped = true; onPaid({ from: null, hash: null }); return; }
          } catch (e2) { setOnline(false); }
        }
        await sleep(1500);
      }
    })();
    return { stop() { stopped = true; } };
  }

  /** Poll this phone's ticket balance while the app is visible. */
  function watchBalance(cb, every = 4000) {
    let last = null, stopped = false;
    (async function loop() {
      while (!stopped) {
        if (document.visibilityState === 'visible' && state.token) {
          try {
            const b = await state.token.balanceOf(myAddress());
            setOnline(true);
            if (last === null || b !== last) { const prev = last; last = b; cb(b, prev); }
          } catch (e) { setOnline(false); }
        }
        await sleep(every);
      }
    })();
    return { stop() { stopped = true; }, set(v) { last = v; } };
  }

  /**
   * Read the fete's event logs in chunks. Public servers limit how many blocks one
   * request may cover, so we start big and halve on errors (remembering what worked).
   */
  async function scanLogs(topics, fromBlock, progress) {
    const end = await blockNumber();
    let size = store.get('logChunk', 50000);
    let from = fromBlock;
    const out = [];
    while (from <= end) {
      const to = Math.min(end, from + size - 1);
      try {
        const logs = await retry(() => state.provider.send('eth_getLogs', [{
          address: feteAddress(), fromBlock: ethers.toQuantity(from), toBlock: ethers.toQuantity(to), topics
        }]), 2, 500);
        for (const l of logs) out.push(l);
        from = to + 1;
        if (progress) progress((from - fromBlock) / Math.max(1, end - fromBlock + 1));
      } catch (e) {
        if (size <= 100) throw friendly(e);
        size = Math.max(100, Math.floor(size / 2));
        store.set('logChunk', size);
      }
    }
    return { logs: out, end };
  }

  /** All ticket movements since the fete was created. */
  async function allTransfers(progress) {
    const { logs } = await scanLogs([TRANSFER_TOPIC], state.info.createdAtBlock, progress);
    return logs.map((l) => ({ from: normAddr(l.topics[1]), to: normAddr(l.topics[2]), value: BigInt(l.data), block: parseInt(l.blockNumber, 16), hash: l.transactionHash }));
  }

  /** The organiser's team (booths + stalls), rebuilt from the network — works on any phone. */
  async function helperList() {
    const key = 'helpers.' + feteAddress().toLowerCase();
    const cache = store.get(key, null) || { next: state.info.createdAtBlock, map: {} };
    const { logs, end } = await scanLogs([HELPER_TOPIC], cache.next);
    logs.forEach((l) => {
      const ev = iface.parseLog(l);
      const a = normAddr(l.topics[1]);
      const kind = Number(ev.args.kind);
      if (kind === 0) delete cache.map[a.toLowerCase()];
      else cache.map[a.toLowerCase()] = Object.assign(cache.map[a.toLowerCase()] || { added: Date.now() }, { address: a, kind: kind === 1 ? 'B' : 'S', name: ev.args.label });
    });
    cache.next = end + 1;
    store.set(key, cache);
    return Object.values(cache.map);
  }
  const cachedHelpers = () => Object.values((store.get('helpers.' + feteAddress().toLowerCase(), null) || { map: {} }).map);

  /** Organiser: add / rename / remove a booth or stall, optionally sending tickets + credit. */
  async function addHelper(to, ticketsWei, creditWei, kind, label) {
    to = normAddr(to);
    const gp = await gasPrice();
    const gasLimit = 300000n;
    const [credit, tickets] = await Promise.all([creditBalance(), ticketsWei > 0n ? ticketBalance() : Promise.resolve(0n)]);
    if (ticketsWei > tickets) throw new Friendly('Not enough tickets', 'You only have ' + tix(tickets) + '.', 'NO_TICKETS');
    if (credit < gasLimit * gp + creditWei) throw new Friendly('Running credit is low', creditHelp(), 'NO_CREDIT');
    let tx;
    try {
      tx = await state.wallet.sendTransaction({
        to: feteAddress(), data: iface.encodeFunctionData('addHelper', [to, ticketsWei, kind, String(label || '').slice(0, 40)]),
        value: creditWei, gasLimit, gasPrice: gp, type: 0, chainId: state.chainId
      });
    } catch (e) { throw friendly(e); }
    return waitTx(tx.hash);
  }

  // ------------------------------------------------------------------ QR codes
  function qrSvg(text) {
    // Long links (payment codes) use lighter error correction so the code stays easy to scan off a screen.
    const q = window.qrcode(0, text.length > 120 ? 'L' : 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }

  const Codes = {
    person: (a) => 'FETE:C:' + a,
    member: (kind, a, name) => 'FETE:' + kind + ':' + a + ':' + encodeURIComponent(name || ''),
    // A payment request is a normal web link into the family app, so it works whether they
    // scan it with the Fete Tickets app or with their phone's ordinary camera.
    pay: (a, wei, label) => {
      const u = appUrl('customer', true);
      return u + (u.includes('?') ? '&' : '?') + 'pay=' + a + '&amt=' + wei.toString() + '&for=' + encodeURIComponent((label || '').slice(0, 60));
    },
    fete: (a, chainId) => 'FETE:F:' + a + ':' + (chainId || ''),
    parse(text) {
      text = String(text || '').trim();
      if (isAddr(text)) return { kind: 'C', address: normAddr(text) };
      if (/^https?:\/\//i.test(text)) {
        let u;
        try { u = new URL(text); } catch (e) { return null; }
        const l = parseFeteLink(text);
        const pay = u.searchParams.get('pay'), amt = u.searchParams.get('amt') || '';
        if (pay && isAddr(pay) && /^\d+$/.test(amt)) {
          return { kind: 'P', address: normAddr(pay), amount: BigInt(amt), label: u.searchParams.get('for') || '', fete: l && l.address, chainId: l && l.chainId, raw: text };
        }
        return l ? { kind: 'F', address: l.address, chainId: l.chainId } : null;
      }
      const m = text.match(/FETE:([CBSPF]):((?:0x|xdc)[0-9a-fA-F]{40})(?::(.*))?$/i);
      if (!m) return null;
      const kind = m[1].toUpperCase();
      const address = normAddr(m[2]);
      const rest = m[3] || '';
      if (kind === 'P') {
        const i = rest.indexOf(':');
        const amt = i < 0 ? rest : rest.slice(0, i);
        if (!/^\d+$/.test(amt)) return null;
        let label = '';
        try { label = decodeURIComponent(i < 0 ? '' : rest.slice(i + 1)); } catch (e) { }
        return { kind, address, amount: BigInt(amt), label };
      }
      if (kind === 'F') return { kind, address, chainId: Number(rest) || null };
      let name = '';
      try { name = decodeURIComponent(rest); } catch (e) { }
      return { kind, address, name };
    }
  };

  // ------------------------------------------------------------------ UI kit
  function showView(name) {
    const boot = $('#booting'); if (boot) boot.remove();
    $$('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== name));
    window.scrollTo(0, 0);
    document.body.dataset.current = name;
  }

  let toastTimer;
  function toast(msg, kind = '') {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3200);
  }

  /**
   * Bottom sheet. buttons: [{ label, value, style, submit }]
   * validate(el) may return an error string to keep the sheet open.
   * Resolves with { value, el } (value null if dismissed).
   */
  function sheet({ title, html = '', buttons = [{ label: 'OK', value: true }], dismissable = true, onOpen, validate }) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' +
        (title ? '<h2>' + esc(title) + '</h2>' : '') +
        '<div class="sheet-body">' + html + '</div><div class="err" hidden></div>' +
        '<div class="sheet-btns"></div></div>';
      const box = $('.sheet-btns', ov);
      const finish = (value) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve({ value, el: ov }); };
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (b.style || '');
        btn.innerHTML = b.label;
        btn.onclick = () => {
          if (b.submit && validate) {
            const err = validate(ov);
            if (err) { const e = $('.err', ov); e.textContent = err; e.hidden = false; return; }
          }
          finish(b.value);
        };
        box.appendChild(btn);
      });
      if (dismissable) ov.addEventListener('click', (e) => { if (e.target === ov) finish(null); });
      const onKey = (e) => {
        if (e.key === 'Escape' && dismissable) finish(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const s = buttons.findIndex((b) => b.submit); if (s >= 0) box.children[s].click(); }
      };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      if (onOpen) onOpen(ov);
      const first = $('input,textarea', ov);
      if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 50);
    });
  }

  async function alertSheet(title, msg, label = 'OK') {
    await sheet({ title, html: '<p>' + esc(msg) + '</p>', buttons: [{ label, value: true }] });
  }
  async function confirmSheet(title, msg, yes = 'Yes', no = 'Cancel', danger) {
    const r = await sheet({ title, html: '<p>' + msg + '</p>', buttons: [{ label: yes, value: true, style: danger ? 'danger' : '' }, { label: no, value: false, style: 'ghost' }] });
    return r.value === true;
  }
  async function showError(err) {
    const f = friendly(err);
    console.warn(err);
    await alertSheet(f.title, f.message);
  }

  function busy(text) {
    const el = document.createElement('div');
    el.className = 'busy';
    el.innerHTML = '<div><div class="spinner"></div><b></b><p class="muted">Please keep the app open</p></div>';
    $('b', el).textContent = text || 'Working…';
    document.body.appendChild(el);
    return { update(t) { $('b', el).textContent = t; }, close() { el.remove(); } };
  }

  let audioCtx;
  function chime(good = true) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = good ? [784, 1047, 1319] : [330, 262];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = audioCtx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.32);
      });
    } catch (e) { }
    try { navigator.vibrate && navigator.vibrate(good ? [60, 40, 120] : [200, 80, 200]); } catch (e) { }
  }

  /** Big full-screen tick (or cross). Tap or wait to close. */
  function splash(title, sub, good = true, ms = 2600) {
    return new Promise((resolve) => {
      chime(good);
      const el = document.createElement('div');
      el.className = 'splash ' + (good ? 'ok' : 'bad');
      el.innerHTML = '<div><div class="mark">' + (good ? '✓' : '✕') + '</div><h1></h1><p></p><p class="small" style="opacity:.75;margin-top:30px">Tap to continue</p></div>';
      $('h1', el).textContent = title;
      $('p', el).textContent = sub || '';
      const done = () => { el.remove(); resolve(); };
      el.onclick = done;
      document.body.appendChild(el);
      if (ms) setTimeout(() => el.isConnected && done(), ms);
    });
  }

  // ------------------------------------------------------------------ scanner
  /**
   * Open the camera and scan a QR code.
   * check(parsed, raw) returns an error string to keep scanning, or nothing to accept.
   * Resolves with the parsed code, or null if cancelled.
   */
  function scan({ title = 'Scan the code', hint = 'Point the camera at the QR code', check } = {}) {
    return new Promise((resolve) => {
      $$('.toast').forEach((t) => t.remove());
      const el = document.createElement('div');
      el.className = 'scanner';
      el.innerHTML =
        '<video playsinline muted autoplay></video><div class="frame"></div>' +
        '<div class="top"><b></b><span></span></div>' +
        '<div class="bottom"><div class="msg" hidden></div>' +
        '<button class="btn secondary" data-cancel>Cancel</button>' +
        '<button class="link" data-type>Camera not working? Type the code</button></div>';
      $('.top b', el).textContent = title;
      $('.top span', el).textContent = hint;
      document.body.appendChild(el);
      const video = $('video', el);
      const msg = $('.msg', el);
      let stream, done = false, lastBad = '', lastBadAt = 0, detector = null;

      const finish = (val) => {
        if (done) return;
        done = true;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        el.remove();
        resolve(val);
      };
      const consider = (raw) => {
        if (done || !raw) return false;
        const parsed = Codes.parse(raw);
        let err = parsed ? (check ? check(parsed, raw) : null) : 'That isn\'t a fete code. Try again.';
        if (err) {
          if (raw !== lastBad || Date.now() - lastBadAt > 2500) {
            msg.textContent = err; msg.hidden = false; chime(false);
          }
          lastBad = raw; lastBadAt = Date.now();
          return false;
        }
        chime(true);
        finish(parsed);
        return true;
      };
      $('[data-cancel]', el).onclick = () => finish(null);
      $('[data-type]', el).onclick = async () => {
        const r = await sheet({
          title: 'Type or paste the code',
          html: '<label class="field"><textarea class="input" id="manualcode" placeholder="Paste the code here"></textarea></label>',
          buttons: [{ label: 'Use this code', value: true, submit: true }, { label: 'Back', value: false, style: 'ghost' }],
          validate: (ov) => {
            const raw = $('#manualcode', ov).value.trim();
            const p = Codes.parse(raw);
            if (!p) return 'That isn\'t a fete code.';
            const e = check && check(p, raw);
            return e || null;
          }
        });
        if (r.value) consider($('#manualcode', r.el).value.trim());
      };

      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream;
          await video.play().catch(() => { });
        } catch (e) {
          msg.textContent = 'The camera isn\'t available. Allow camera access for this app in your phone settings, or type the code instead.';
          msg.hidden = false;
          return;
        }
        if ('BarcodeDetector' in window) {
          try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; }
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (done) return;
          if (video.readyState >= 2 && video.videoWidth) {
            try {
              if (detector) {
                const codes = await detector.detect(video);
                if (codes && codes[0]) consider(codes[0].rawValue);
              } else if (window.jsQR) {
                const scale = Math.min(1, 640 / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * scale);
                canvas.height = Math.round(video.videoHeight * scale);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (r && r.data) consider(r.data);
              }
            } catch (e) { /* keep trying */ }
          }
          setTimeout(() => requestAnimationFrame(tick), detector ? 120 : 160);
        };
        tick();
      })();
    });
  }

  // ------------------------------------------------------------------ install to home screen
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; document.dispatchEvent(new Event('fete-installable')); });

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  function platform() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|MicroMessenger|; wv\)/.test(ua);
    const samsung = /SamsungBrowser/.test(ua);
    const iosOther = ios && /CriOS|FxiOS|EdgiOS/.test(ua);
    return { ios, android, inApp, samsung, iosOther, mobile: ios || android };
  }

  const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';

  function installHow(p, app) {
    if (p.inApp) {
      return '<div class="notice warn"><b>Open this page in your normal browser first.</b><br>Tap the <b>⋯</b> menu and choose <b>Open in browser</b> (or <b>Open in Safari / Chrome</b>).</div>';
    }
    if (p.ios) {
      return '<ol class="steps">' +
        '<li>Tap the <b>Share</b> button ' + SHARE_ICON + (p.iosOther ? ' (top or bottom of the screen).' : ' at the bottom of the screen (on iPad it\'s at the top).') + '</li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
        '<li>Tap <b>Add</b>. Then open <b>' + esc(app.name) + '</b> from your home screen.</li></ol>';
    }
    if (p.android) {
      return '<div data-native-install hidden><button class="btn huge" data-install><span class="emoji">📲</span> Add to my home screen</button></div>' +
        '<ol class="steps" data-manual>' +
        (p.samsung
          ? '<li>Tap the <b>☰</b> menu at the bottom.</li><li>Tap <b>Add page to</b> → <b>Home screen</b>.</li>'
          : '<li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>') +
        '<li>Tap <b>Add</b> / <b>Install</b>. Then open <b>' + esc(app.name) + '</b> from your home screen.</li></ol>';
    }
    return '<p>Open this page on your phone to add it to your home screen. You can also keep using it here.</p>';
  }

  /** Wire up the one-tap Android install button inside `el` (if the browser offers it). */
  function wireNativeInstall(el, onAccepted) {
    const nativeBox = $('[data-native-install]', el);
    const showNative = () => { if (deferredPrompt && nativeBox) { nativeBox.hidden = false; const m = $('[data-manual]', el); if (m) m.hidden = true; } };
    showNative();
    document.addEventListener('fete-installable', showNative);
    const btn = $('[data-install]', el);
    if (btn) btn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') onAccepted && onAccepted();
      else showNative();
    };
  }

  /**
   * Helper apps (booth, stall, organiser): a full-screen "add to home screen" step first.
   * Customer app: no gate at all — it just works in the browser. The only exception is
   * in-app browsers (Facebook, Instagram, some QR scanner apps), whose storage can vanish.
   */
  function installGate() {
    if (isStandalone() || sessionStorage.getItem(NS + 'skipinstall') === '1') return Promise.resolve();
    const p = platform();
    if (!p.mobile && ROLE === 'organiser') return Promise.resolve(); // laptop organisers just use the browser
    if (ROLE === 'customer' && !p.inApp) return Promise.resolve();
    const app = APPS[ROLE];
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'fullscreen';
      const customer = ROLE === 'customer';
      el.innerHTML = '<div class="inner center">' +
        '<img class="appicon" src="../icons/' + app.icon + '-192.png" alt="">' +
        '<h1>' + esc(app.name) + '</h1>' +
        (customer
          ? '<p class="muted">This page is open inside another app, which may forget your tickets when you close it.</p>'
          : '<p class="muted">Put this app on your home screen — it takes 10 seconds and you\'ll be able to find it all day.</p>') +
        '<div class="card" style="text-align:left">' + installHow(p, app) +
        (p.ios && !p.iosOther && !p.inApp ? '<div class="install-arrow">⬇️</div>' : '') + '</div>' +
        '<button class="link" data-skip>' + (customer ? 'Continue here anyway' : 'Use it here without adding') + '</button>' +
        '<p class="small muted" style="margin-top:16px">Built by ' + esc(CFG.builtBy) + '</p></div>';
      document.body.appendChild(el);
      wireNativeInstall(el, () => {
        $('.card', el).innerHTML = '<div class="notice ok"><b>Done!</b> Now close this page and open <b>' + esc(app.name) + '</b> from your home screen.</div>';
      });
      $('[data-skip]', el).onclick = async () => {
        if (p.ios && !customer) {
          const ok = await confirmSheet('Use without adding?',
            'On iPhone, anything set up here <b>won\'t</b> show in the home-screen app later (your backup text can bring it across). Fine if you\'re only using it here today.',
            'Use it here', 'Go back');
          if (!ok) return;
        }
        sessionStorage.setItem(NS + 'skipinstall', '1');
        el.remove();
        resolve();
      };
    });
  }

  /** Optional "add to home screen" help, opened from the customer's banner. */
  async function installSheet() {
    const p = platform();
    const app = APPS[ROLE];
    await sheet({
      title: 'Add to your home screen',
      html: '<p class="muted">Optional — it just makes the app quicker to find today.' +
        (p.ios ? ' On iPhone, the home-screen app starts empty: open it, tap <b>I\'ve used this before</b>, and paste your backup text to bring your tickets across.' : ' Your tickets come with you.') +
        '</p>' + installHow(p, app),
      buttons: [{ label: 'Close', value: null, style: 'ghost' }],
      onOpen: (ov) => wireNativeInstall(ov, () => { ov.remove(); toast('Added! Find ' + app.name + ' on your home screen', 'ok'); })
    });
  }

  // ------------------------------------------------------------------ first-run: account + backup
  function smsLink(body) {
    const p = platform();
    return 'sms:' + (p.ios ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }

  async function backupFlow(firstTime) {
    const text = backupText();
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'fullscreen';
      el.innerHTML = '<div class="inner">' +
        '<h1>📩 Save your backup</h1>' +
        '<p>If your phone is lost or reset, or your browser forgets this page, this backup brings your tickets back.</p>' +
        '<div class="card"><ol class="steps">' +
        '<li>Tap <b>Text it to myself</b>.</li>' +
        '<li>In the <b>To</b> box, type <b>your own mobile number</b>.</li>' +
        '<li>Press <b>Send</b>, then come back to this app.</li></ol>' +
        '<a class="btn huge" data-sms href="' + smsLink(text) + '"><span class="emoji">💬</span> Text it to myself</a>' +
        '<button class="btn secondary" data-share>Save it another way (email, notes…)</button>' +
        '<button class="link" data-copy>Copy backup message</button></div>' +
        '<label class="check"><input type="checkbox" data-done> <span>I\'ve sent or saved my backup message</span></label>' +
        '<button class="btn ok" data-continue disabled>Continue</button>' +
        (firstTime ? '<button class="link" data-skip style="display:block;margin:0 auto">Skip for now</button>' : '<button class="link" data-skip style="display:block;margin:0 auto">Close</button>') +
        '<p class="small muted center" style="margin-top:14px">Keep the message private — anyone with it can use this phone\'s tickets.</p>' +
        '</div>';
      document.body.appendChild(el);
      const cb = $('[data-done]', el), cont = $('[data-continue]', el);
      const close = (ok) => { if (ok) store.set(rk('backedUp'), Date.now()); el.remove(); resolve(ok); };
      cb.onchange = () => (cont.disabled = !cb.checked);
      $('[data-sms]', el).addEventListener('click', () => setTimeout(() => { cb.checked = true; cont.disabled = false; }, 800));
      $('[data-share]', el).onclick = async () => {
        if (navigator.share) {
          try { await navigator.share({ title: APPS[ROLE].name + ' backup', text }); cb.checked = true; cont.disabled = false; } catch (e) { }
        } else copyText(text);
      };
      $('[data-copy]', el).onclick = () => copyText(text);
      cont.onclick = () => close(true);
      $('[data-skip]', el).onclick = async () => {
        if (!firstTime) return close(false);
        const ok = await confirmSheet('Skip the backup?', 'Without a backup, if anything happens to this phone the tickets on it can\'t be recovered.', 'Skip anyway', 'Go back', true);
        if (ok) close(false);
      };
    });
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied', 'ok'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied', 'ok'); } catch (e2) { toast('Couldn\'t copy'); }
      ta.remove();
    }
  }

  async function restoreFlow() {
    const r = await sheet({
      title: 'Restore from backup',
      html: '<p>Find the backup text message you sent yourself. Press and hold it, tap <b>Copy</b>, then paste it below.</p>' +
        '<label class="field"><textarea class="input" id="restoretext" placeholder="Paste the whole backup message here"></textarea></label>' +
        '<button class="btn secondary small" id="pastebtn" type="button">📋 Paste</button><div style="height:14px"></div>',
      buttons: [{ label: 'Restore', value: true, submit: true }, { label: 'Cancel', value: false, style: 'ghost' }],
      onOpen: (ov) => {
        const pb = $('#pastebtn', ov);
        if (!navigator.clipboard || !navigator.clipboard.readText) { pb.hidden = true; return; }
        pb.onclick = async () => { try { $('#restoretext', ov).value = await navigator.clipboard.readText(); } catch (e) { toast('Press and hold in the box, then tap Paste'); } };
      },
      validate: (ov) => parseBackup($('#restoretext', ov).value) ? null : 'That doesn\'t look like a backup message. Make sure you paste the whole message.'
    });
    if (!r.value) return false;
    const pk = parseBackup($('#restoretext', r.el).value);
    if (state.wallet && state.wallet.privateKey !== pk) {
      const ok = await confirmSheet('Replace what\'s on this phone?', 'This phone already has its own tickets account. Restoring will switch to the backed-up one. Make sure this phone\'s own backup is saved first.', 'Replace', 'Cancel', true);
      if (!ok) return false;
    }
    saveKey(pk);
    store.set(rk('backedUp'), Date.now());
    if (state.token) state.token = state.token.connect(state.wallet);
    toast('Restored!', 'ok');
    const link = parseFeteLink($('#restoretext', r.el).value);
    if (link) store.set(rk('restoredFete'), link.address.toLowerCase());
    if (link && !sameAddr(link.address, feteAddress())) {
      if (link.rpc) store.set('rpc', link.rpc);
      setFete(link.address, link.chainId);
      await sleep(400);
      location.reload();
      await sleep(5000);
    }
    return true;
  }

  function ensureAccount({ welcomeTitle, welcomeText, startLabel = 'Get started', note = '' }) {
    if (loadWallet()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const app = APPS[ROLE];
      const el = document.createElement('div');
      el.className = 'fullscreen';
      el.innerHTML = '<div class="inner center">' +
        '<img class="appicon" src="../icons/' + app.icon + '-192.png" alt="">' +
        '<h1>' + esc(welcomeTitle || ('Welcome to ' + app.name)) + '</h1>' +
        '<p class="muted">' + (welcomeText || '') + '</p>' +
        '<div style="height:10px"></div>' +
        '<button class="btn huge" data-new>' + esc(startLabel) + '</button>' +
        '<button class="btn secondary" data-restore>I\'ve used this before — restore</button>' +
        (note ? '<p class="small muted" style="margin-top:14px">' + note + '</p>' : '') +
        '<p class="small muted" style="margin-top:20px">Built by ' + esc(CFG.builtBy) + '</p></div>';
      document.body.appendChild(el);
      $('[data-new]', el).onclick = async () => {
        saveKey(ethers.Wallet.createRandom().privateKey);
        if (state.token) state.token = state.token.connect(state.wallet);
        el.remove();
        await backupFlow(true);
        resolve(true);
      };
      $('[data-restore]', el).onclick = async () => {
        if (await restoreFlow()) { el.remove(); resolve(true); }
      };
    });
  }

  /** Make sure we know which fete this phone belongs to. */
  function ensureFete() {
    if (feteAddress()) return Promise.resolve();
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'fullscreen';
      el.innerHTML = '<div class="inner center"><h1>Connect to your fete</h1>' +
        '<p>Open the link the fete organiser sent you, or scan any of the fete\'s QR codes (posters or the organiser\'s phone).</p>' +
        '<button class="btn huge" data-scan><span class="emoji">📷</span> Scan a fete QR code</button>' +
        '<p class="small muted" style="margin-top:14px">Organising a fete yourself? Start at the <a href="../">Fete Tickets home page</a>.</p></div>';
      document.body.appendChild(el);
      $('[data-scan]', el).onclick = async () => {
        const c = await scan({ title: 'Scan a fete QR code', hint: 'Any fete poster, or the organiser\'s phone', check: (p) => p.kind === 'F' ? null : 'That\'s not a fete QR code.' });
        if (!c) return;
        applyFeteCode(c);
        location.reload();
      };
    });
  }

  function applyFeteCode(c) { setFete(c.address, c.chainId); }

  // ------------------------------------------------------------------ settings
  async function openSettings(extraHtml = '', onExtra) {
    const cur = rpcUrl();
    const preset = SERVERS.find((s) => s.url === cur);
    const others = store.get('fetes', []).filter((x) => !sameAddr(x.address, feteAddress()));
    const html =
      (others.length ? '<div class="card" style="box-shadow:none;background:var(--bg)"><h3 style="margin-top:0">Your other fetes</h3>' +
        '<p class="small muted">This phone has been used at these too. Their tickets are safe — tap one to switch to it.</p>' +
        others.map((x, i) => '<button class="btn secondary" data-other="' + i + '">' + esc(x.name) + (x.chainId === 51 ? ' (practice)' : '') + '</button>').join('') + '</div>' : '') +
      '<div class="card" style="box-shadow:none;background:var(--bg)">' +
      '<button class="btn secondary" data-a="backup">📩 Text my backup again</button>' +
      '<button class="btn secondary" data-a="restore">♻️ Restore from backup</button>' +
      extraHtml +
      '</div>' +
      '<details class="small" style="margin-bottom:14px"><summary class="muted">Technical details (only if asked by a helper)</summary>' +
      '<label class="field" style="margin-top:12px"><span>Connection server</span><select class="input" id="srvsel">' +
      SERVERS.map((s) => '<option value="' + s.id + '"' + (preset && preset.id === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') +
      '<option value="custom"' + (!preset ? ' selected' : '') + '>Custom…</option></select></label>' +
      '<label class="field" id="customwrap"' + (preset ? ' hidden' : '') + '><span>Custom server address</span><input class="input" id="srvurl" value="' + esc(cur) + '" inputmode="url" autocapitalize="off" spellcheck="false"></label>' +
      '<button class="btn secondary small" data-a="server">Use this server</button>' +
      '<p class="muted" style="margin-top:12px;word-break:break-all">Fete: ' + esc(state.info ? state.info.name : '-') + '<br>This phone\'s code: ' + esc(myAddress() || '-') + '<br>' +
      'Fete code: ' + esc(feteAddress() || '-') + '<br>Network: ' + esc(state.chainId || '?') + ' · App ' + VERSION + '</p>' +
      '<button class="btn secondary small" data-a="fete">Change fete</button> ' +
      '<button class="btn danger small" data-a="wipe">Remove from this phone</button></details>' +
      '<p class="small muted center">Built by <a href="' + esc(CFG.builtByUrl) + '" target="_blank" rel="noopener">' + esc(CFG.builtBy) + '</a></p>';
    let action = null, serverUrl = null;
    const r = await sheet({
      title: 'Settings', html,
      buttons: [{ label: 'Close', value: null, style: 'ghost' }],
      onOpen: (ov) => {
        $('#srvsel', ov).onchange = (e) => ($('#customwrap', ov).hidden = e.target.value !== 'custom');
        $$('[data-a]', ov).forEach((b) => (b.onclick = () => {
          action = b.dataset.a;
          if (action === 'server') { const sel = $('#srvsel', ov).value; serverUrl = sel === 'custom' ? $('#srvurl', ov).value.trim() : SERVERS.find((x) => x.id === sel).url; }
          ov.remove(); handle();
        }));
        $$('[data-other]', ov).forEach((b) => (b.onclick = () => {
          const x = others[Number(b.dataset.other)];
          if (x.rpc) store.set('rpc', x.rpc); else store.del('rpc');
          setFete(x.address, null, true);
          location.reload();
        }));
        if (onExtra) onExtra(ov, (a) => { action = a; ov.remove(); handle(); });
      }
    });
    async function handle() {
      if (action === 'backup') await backupFlow(false);
      else if (action === 'restore') { if (await restoreFlow()) location.reload(); }
      else if (action === 'server') {
        if (!serverUrl || serverUrl === rpcUrl()) return;
        const b = busy('Checking server…');
        try { await rawRpc(serverUrl, 'eth_chainId', []); store.set('rpc', serverUrl); syncUrl(); b.close(); location.reload(); }
        catch (e) { b.close(); alertSheet('Server not reachable', 'That server didn\'t respond. Nothing was changed.'); }
      }
      else if (action === 'fete') {
        const c = await scan({ title: 'Scan a fete QR code', hint: 'Any fete poster, or the organiser\'s phone', check: (p) => p.kind === 'F' ? null : 'That\'s not a fete QR code.' });
        if (c) { applyFeteCode(c); location.reload(); }
      } else if (action === 'wipe') {
        const ok = await confirmSheet('Remove from this phone?', 'This deletes this app\'s tickets account from this phone. Only do this if you have your backup message, or the phone has no tickets left.', 'Remove', 'Cancel', true);
        if (ok) { store.del(rk('key')); store.del(rk('backedUp')); location.reload(); }
      }
    }
    return action;
  }

  // ------------------------------------------------------------------ history (per phone)
  const history_ = {
    list() { return fstore.get('history', []); },
    add(e) { const l = history_.list(); l.unshift(Object.assign({ t: Date.now() }, e)); fstore.set('history', l.slice(0, 1000)); },
    clear() { fstore.set('history', []); }
  };

  // ------------------------------------------------------------------ misc
  async function keepAwake() {
    let lock = null;
    const get = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch (e) { } };
    document.addEventListener('visibilitychange', get);
    get();
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => { });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  }

  function footer() {
    const f = document.createElement('div');
    f.className = 'footer no-print';
    f.innerHTML = 'Built by <a href="' + esc(CFG.builtByUrl) + '" target="_blank" rel="noopener">' + esc(CFG.builtBy) + '</a>';
    document.body.appendChild(f);
  }

  /** Standard start-up used by every app. */
  async function start(role, opts = {}) {
    ROLE = role;
    document.body.classList.add('role-' + role);
    registerSW();
    footer();
    const main = $('main');
    if (main) main.insertAdjacentHTML('afterbegin', '<div id="booting" class="center" style="padding:70px 0"><div class="spinner"></div><p class="muted">Loading…</p></div>');
    await installGate();
    if (opts.needsFete !== false) await ensureFete();
    syncUrl();
    loadWallet();
    let b;
    const connectLoop = async () => {
      for (let i = 0; ; i++) {
        try { await connect(); return; }
        catch (e) {
          setOnline(false);
          if (i === 1 && !b) b = busy('Connecting to the fete…');
          await sleep(Math.min(8000, 1000 * (i + 1)));
        }
      }
    };
    await connectLoop();
    if (b) b.close();
    if (state.chainId === 51 && !$('#practicebar')) {
      const bar = document.createElement('div');
      bar.id = 'practicebar'; bar.className = 'netbar no-print';
      bar.textContent = '🧪 Practice mode — tickets and credit are pretend';
      const top = $('.topbar');
      top ? top.after(bar) : document.body.prepend(bar);
    }
    if (feteAddress()) {
      try { await loadInfo(); } catch (e) { await showError(e); }
    }
    const created = await ensureAccount(opts.account || {});
    if (state.token && state.wallet) state.token = state.token.connect(state.wallet);
    const prev = store.get('switchedFrom');
    store.del('switchedFrom');
    if (prev && !created && state.info && !sameAddr(prev, feteAddress())) {
      const old = store.get('info.' + prev.toLowerCase());
      await sheet({
        title: 'You\'re now at ' + state.info.name,
        html: '<p>This phone was last used for <b>' + esc(old ? old.name : 'another fete') + '</b>. Anything from there is safe and kept separately.</p>' +
          '<p class="muted small">To go back to it, open ⚙️ Settings → <b>Your other fetes</b>.</p>',
        buttons: [{ label: 'OK', value: true }]
      });
    }
    return { created };
  }

  window.Fete = {
    VERSION, CFG, SERVERS, APPS, state, store, Friendly,
    $, $$, esc, sleep, short, fmt, tix, ticketWord, money, dollars, xdc, toWei, toNum, isAddr, normAddr, sameAddr, timeStr, isToday,
    rpcUrl, feteAddress, fstore, connect, loadInfo, myAddress, appUrl,
    ticketBalance, creditBalance, blockNumber, gasPrice, costOfOne,
    sendTickets, sendCreditOnly, createFete, waitTx, addHelper, helperList, cachedHelpers, setFete, syncUrl, linkQuery, uniqueAmount, watchPayment, watchBalance, allTransfers,
    qrSvg, Codes, scan, showView, toast, sheet, alertSheet, confirmSheet, showError, busy, splash, chime,
    backupFlow, backupText, restoreFlow, openSettings, applyFeteCode, history: history_, keepAwake, start, friendly,
    platform, isStandalone, installSheet, copyText, parseUnitsXdc: (v) => ethers.parseEther(String(v)), get ethers() { return ethers; }
  };
})();
