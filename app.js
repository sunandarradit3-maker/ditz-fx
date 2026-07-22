(() => {
  'use strict';

  const PAIRS = [
    { symbol: 'EUR/USD', name: 'Euro / US Dollar', short: 'EU', decimals: 5, pip: 0.0001 },
    { symbol: 'GBP/USD', name: 'British Pound / US Dollar', short: 'GU', decimals: 5, pip: 0.0001 },
    { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', short: 'UJ', decimals: 3, pip: 0.01 },
    { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', short: 'AU', decimals: 5, pip: 0.0001 },
    { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', short: 'UC', decimals: 5, pip: 0.0001 },
    { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar', short: 'UC', decimals: 5, pip: 0.0001 },
    { symbol: 'NZD/USD', name: 'New Zealand Dollar / US Dollar', short: 'NU', decimals: 5, pip: 0.0001 },
    { symbol: 'EUR/JPY', name: 'Euro / Japanese Yen', short: 'EJ', decimals: 3, pip: 0.01 }
  ];

  const DEFAULT_ACCOUNT = {
    balance: 10000,
    positions: [],
    pending: [],
    history: [],
    equitySeries: [{ time: Date.now(), value: 10000 }]
  };

  const state = {
    selectedPair: PAIRS[0],
    interval: '5min',
    chartType: 'candles',
    orderSide: 'buy',
    orderType: 'market',
    activeTable: 'positions',
    riskPercent: 1,
    quotes: {},
    candles: [],
    account: loadAccount(),
    lastMarketFetch: null,
    refreshTimer: null,
    chartHoverIndex: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {};

  function cacheElements() {
    [
      'watchlist','pairSearch','refreshBtn','connectionPill','connectionText','pairTitle','pairName','pairIcon','bidValue','askValue','spreadValue','changeValue','marketTime','buyPrice','sellPrice','depthMid','depthSpread','askDepth','bidDepth','marketChart','chartWrap','chartLoading','chartEmpty','chartStatus','ohlcBar','orderForm','lotInput','slInput','tpInput','limitPriceInput','limitPriceField','estimatedMargin','pipValue','placeOrderBtn','balanceValue','equityValue','freeMarginValue','marginValue','floatingValue','challengeProgress','challengeText','positionCount','pendingCount','tradeTableHead','tradeTableBody','tableEmpty','closeAllBtn','accountBtn','accountModal','notificationBtn','toastStack','fullscreenBtn','equityChart','netPnlStat','winRateStat','winsStat','totalTradesStat','bestTradeStat','riskRing','riskScore','riskChecks','resetAccountBtn','podium','leaderboardRows','seasonTimer'
    ].forEach(id => els[id] = document.getElementById(id));
  }

  function loadAccount() {
    try {
      const saved = JSON.parse(localStorage.getItem('ditzfx-account-v1'));
      return saved && typeof saved.balance === 'number'
        ? { ...structuredClone(DEFAULT_ACCOUNT), ...saved }
        : structuredClone(DEFAULT_ACCOUNT);
    } catch {
      return structuredClone(DEFAULT_ACCOUNT);
    }
  }

  function saveAccount() {
    localStorage.setItem('ditzfx-account-v1', JSON.stringify(state.account));
  }

  function formatMoney(value, signed = false) {
    const prefix = signed && value > 0 ? '+' : '';
    return prefix + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value || 0);
  }

  function formatPrice(value, pair = state.selectedPair) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(pair.decimals) : '—';
  }

  function quoteFor(symbol = state.selectedPair.symbol) {
    return state.quotes[symbol] || null;
  }

  function inferredSpread(pair, mid) {
    const pips = pair.symbol.includes('JPY') ? 1.4 : 1.1;
    return pair.pip * pips;
  }

  function normalizedQuote(pair, payload) {
    const raw = payload?.price ?? payload?.close ?? payload;
    const mid = Number(raw);
    if (!Number.isFinite(mid)) return null;
    const spread = Number(payload?.spread) || inferredSpread(pair, mid);
    return {
      symbol: pair.symbol,
      mid,
      bid: Number(payload?.bid) || mid - spread / 2,
      ask: Number(payload?.ask) || mid + spread / 2,
      spread,
      change: Number(payload?.percent_change) || 0,
      timestamp: payload?.timestamp ? Number(payload.timestamp) * 1000 : Date.now(),
      source: payload?.source || 'Twelve Data'
    };
  }

  async function apiFetch(params) {
    const url = new URL('/api/market', window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchQuotes({ silent = false } = {}) {
    if (!silent) setConnection('loading', 'Menghubungkan');
    try {
      const symbols = PAIRS.map(p => p.symbol).join(',');
      const data = await apiFetch({ action: 'quotes', symbols });
      const rawQuotes = data.quotes || {};
      PAIRS.forEach(pair => {
        const source = rawQuotes[pair.symbol] || rawQuotes[pair.symbol.replace('/', '')];
        const q = normalizedQuote(pair, source);
        if (q) state.quotes[pair.symbol] = q;
      });
      state.lastMarketFetch = Date.now();
      setConnection('live', 'Market live');
      updateAllMarketUI();
      processPendingOrders();
      return true;
    } catch (error) {
      setConnection('error', 'API belum aktif');
      if (!silent) showToast('Data pasar belum terhubung', humanizeApiError(error), 'error');
      updateAllMarketUI();
      return false;
    }
  }

  async function fetchCandles() {
    els.chartLoading.classList.remove('hidden');
    els.chartEmpty.classList.add('hidden');
    try {
      const data = await apiFetch({ action: 'candles', symbol: state.selectedPair.symbol, interval: state.interval, outputsize: '160' });
      const values = Array.isArray(data.values) ? data.values : [];
      state.candles = values
        .map(v => ({
          time: new Date((v.datetime || '').replace(' ', 'T') + (String(v.datetime).endsWith('Z') ? '' : 'Z')).getTime(),
          open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close)
        }))
        .filter(v => [v.open,v.high,v.low,v.close].every(Number.isFinite))
        .sort((a,b) => a.time - b.time);
      if (!state.candles.length) throw new Error('Provider tidak mengirim candle untuk pair ini.');
      const last = state.candles.at(-1);
      if (!state.quotes[state.selectedPair.symbol]) {
        state.quotes[state.selectedPair.symbol] = normalizedQuote(state.selectedPair, { price: last.close });
      }
      els.chartEmpty.classList.add('hidden');
      els.chartStatus.textContent = `${state.candles.length} candle · ${data.meta?.symbol || state.selectedPair.symbol} · ${data.meta?.interval || state.interval}`;
      drawMarketChart();
      updateOHLC(last);
    } catch (error) {
      state.candles = [];
      drawMarketChart();
      els.chartEmpty.classList.remove('hidden');
      els.chartStatus.textContent = 'Data chart tidak tersedia';
    } finally {
      els.chartLoading.classList.add('hidden');
    }
  }

  function humanizeApiError(error) {
    const msg = String(error?.message || error || 'Unknown error');
    if (/API key|TWELVE/i.test(msg)) return 'Tambahkan TWELVE_DATA_API_KEY pada Environment Variables lalu deploy ulang.';
    if (/limit|429|credits/i.test(msg)) return 'Kuota API gratis sedang habis. Tunggu reset limit atau naikkan paket provider.';
    if (/abort/i.test(msg)) return 'Permintaan data terlalu lama dan dihentikan.';
    return msg;
  }

  function setConnection(type, text) {
    els.connectionPill.classList.remove('live','error');
    if (type === 'live') els.connectionPill.classList.add('live');
    if (type === 'error') els.connectionPill.classList.add('error');
    els.connectionText.textContent = text;
  }

  function renderWatchlist(filter = '') {
    const query = filter.trim().toLowerCase();
    const visible = PAIRS.filter(p => `${p.symbol} ${p.name}`.toLowerCase().includes(query));
    els.watchlist.innerHTML = visible.map(pair => {
      const q = quoteFor(pair.symbol);
      const changeClass = (q?.change || 0) >= 0 ? 'positive' : 'negative';
      const active = pair.symbol === state.selectedPair.symbol ? 'active' : '';
      return `<button class="watch-row ${active}" data-symbol="${pair.symbol}">
        <span class="watch-pair"><i class="mini-flag">${pair.short}</i><span><strong>${pair.symbol}</strong><small>${pair.name.split(' / ')[0]}</small></span></span>
        <span class="watch-price">${q ? formatPrice(q.mid, pair) : '—'}</span>
        <span class="change ${q ? changeClass : ''}">${q ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}</span>
      </button>`;
    }).join('');
    $$('.watch-row', els.watchlist).forEach(btn => btn.addEventListener('click', () => selectPair(btn.dataset.symbol)));
  }

  async function selectPair(symbol) {
    const pair = PAIRS.find(p => p.symbol === symbol);
    if (!pair || pair.symbol === state.selectedPair.symbol) return;
    state.selectedPair = pair;
    state.chartHoverIndex = null;
    renderWatchlist(els.pairSearch.value);
    updatePairHeader();
    updateOrderUI();
    updateDepth();
    await fetchCandles();
  }

  function updatePairHeader() {
    const pair = state.selectedPair;
    const q = quoteFor();
    els.pairTitle.textContent = pair.symbol;
    els.pairName.textContent = pair.name;
    els.pairIcon.textContent = pair.short;
    els.bidValue.textContent = q ? formatPrice(q.bid) : '—';
    els.askValue.textContent = q ? formatPrice(q.ask) : '—';
    els.spreadValue.textContent = q ? `${(q.spread / pair.pip).toFixed(1)} pips` : '—';
    els.changeValue.textContent = q ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—';
    els.changeValue.className = q ? (q.change >= 0 ? 'positive' : 'negative') : '';
    els.marketTime.textContent = q ? new Date(q.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';
  }

  function updateOrderUI() {
    const q = quoteFor();
    els.buyPrice.textContent = q ? formatPrice(q.ask) : '—';
    els.sellPrice.textContent = q ? formatPrice(q.bid) : '—';
    if (q && !els.limitPriceInput.value) els.limitPriceInput.value = formatPrice(state.orderSide === 'buy' ? q.ask : q.bid);
    const lot = Math.max(0, Number(els.lotInput.value) || 0);
    const margin = lot * 1000;
    const pipVal = lot * 10;
    els.estimatedMargin.textContent = formatMoney(margin);
    els.pipValue.textContent = formatMoney(pipVal);
    els.placeOrderBtn.className = `place-order ${state.orderSide}`;
    els.placeOrderBtn.textContent = `Place ${state.orderSide === 'buy' ? 'Buy' : 'Sell'} Order`;
    els.placeOrderBtn.disabled = !q;
  }

  function updateDepth() {
    const q = quoteFor();
    if (!q) {
      els.askDepth.innerHTML = els.bidDepth.innerHTML = '';
      els.depthMid.textContent = '—';
      els.depthSpread.textContent = 'Spread —';
      return;
    }
    const pair = state.selectedPair;
    const step = pair.pip * 0.5;
    const sizes = [0.42, 0.86, 1.24, 1.88, 2.41, 3.05];
    let total = 0;
    const asks = sizes.map((size, i) => {
      total += size;
      return { price: q.ask + step * (sizes.length - i), size, total };
    });
    total = 0;
    const bids = [...sizes].reverse().map((size, i) => {
      total += size;
      return { price: q.bid - step * i, size, total };
    });
    const maxTotal = Math.max(...asks.map(x => x.total), ...bids.map(x => x.total));
    els.askDepth.innerHTML = asks.map(x => depthRow(x, maxTotal)).join('');
    els.bidDepth.innerHTML = bids.map(x => depthRow(x, maxTotal)).join('');
    els.depthMid.textContent = formatPrice(q.mid);
    els.depthSpread.textContent = `Spread ${(q.spread / pair.pip).toFixed(1)} pips`;
  }

  function depthRow(item, max) {
    return `<div class="depth-row" style="--depth:${Math.max(8,(item.total/max)*100)}%"><span>${formatPrice(item.price)}</span><span>${item.size.toFixed(2)}</span><span>${item.total.toFixed(2)}</span></div>`;
  }

  function updateAllMarketUI() {
    renderWatchlist(els.pairSearch.value);
    updatePairHeader();
    updateOrderUI();
    updateDepth();
    updateAccountUI();
  }

  function calculatePositionPnl(position) {
    const q = quoteFor(position.symbol);
    if (!q) return position.pnl || 0;
    const pair = PAIRS.find(p => p.symbol === position.symbol) || state.selectedPair;
    const exit = position.side === 'buy' ? q.bid : q.ask;
    const pips = (exit - position.entry) / pair.pip * (position.side === 'buy' ? 1 : -1);
    return pips * position.lot * 10;
  }

  function accountMetrics() {
    const floating = state.account.positions.reduce((sum,p) => sum + calculatePositionPnl(p), 0);
    const margin = state.account.positions.reduce((sum,p) => sum + p.lot * 1000, 0);
    const equity = state.account.balance + floating;
    return { floating, margin, equity, freeMargin: equity - margin };
  }

  function updateAccountUI() {
    const m = accountMetrics();
    els.balanceValue.textContent = formatMoney(state.account.balance);
    els.equityValue.textContent = formatMoney(m.equity);
    els.freeMarginValue.textContent = formatMoney(m.freeMargin);
    els.marginValue.textContent = formatMoney(m.margin);
    els.floatingValue.textContent = formatMoney(m.floating, true);
    els.floatingValue.className = m.floating >= 0 ? 'positive' : 'negative';
    const progress = Math.max(0, Math.min(100, ((m.equity - 10000) / 1000) * 100));
    els.challengeProgress.style.width = `${progress}%`;
    els.challengeText.textContent = `${progress.toFixed(1)}%`;
    renderTradeTable();
    updatePortfolioStats();
  }

  function placeOrder(event) {
    event.preventDefault();
    const q = quoteFor();
    if (!q) return showToast('Order ditolak', 'Data harga belum tersedia.', 'error');
    const lot = Number(els.lotInput.value);
    if (!Number.isFinite(lot) || lot < 0.01 || lot > 100) return showToast('Volume tidak valid', 'Masukkan volume antara 0.01 sampai 100 lot.', 'error');
    const metrics = accountMetrics();
    const requiredMargin = lot * 1000;
    if (requiredMargin > metrics.freeMargin) return showToast('Margin tidak cukup', 'Kurangi ukuran lot atau tutup posisi lain.', 'error');

    const sidePrice = state.orderSide === 'buy' ? q.ask : q.bid;
    const requestedPrice = state.orderType === 'limit' ? Number(els.limitPriceInput.value) : sidePrice;
    if (!Number.isFinite(requestedPrice)) return showToast('Limit price tidak valid', 'Masukkan harga limit yang benar.', 'error');

    const order = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      symbol: state.selectedPair.symbol,
      side: state.orderSide,
      lot,
      entry: requestedPrice,
      sl: Number(els.slInput.value) || null,
      tp: Number(els.tpInput.value) || null,
      openedAt: Date.now(),
      type: state.orderType
    };

    if (state.orderType === 'limit') {
      state.account.pending.unshift(order);
      showToast('Pending order dibuat', `${order.side.toUpperCase()} ${order.lot.toFixed(2)} ${order.symbol} @ ${formatPrice(order.entry)}`, 'success');
    } else {
      state.account.positions.unshift(order);
      showToast('Position opened', `${order.side.toUpperCase()} ${order.lot.toFixed(2)} ${order.symbol} @ ${formatPrice(sidePrice)}`, 'success');
    }
    saveAccount();
    updateAccountUI();
  }

  function processPendingOrders() {
    const triggered = [];
    state.account.pending = state.account.pending.filter(order => {
      const q = quoteFor(order.symbol);
      if (!q) return true;
      const price = order.side === 'buy' ? q.ask : q.bid;
      const shouldTrigger = order.side === 'buy' ? price <= order.entry : price >= order.entry;
      if (shouldTrigger) {
        order.entry = price;
        order.openedAt = Date.now();
        order.type = 'market';
        state.account.positions.unshift(order);
        triggered.push(order);
        return false;
      }
      return true;
    });
    triggered.forEach(o => showToast('Limit order terpicu', `${o.side.toUpperCase()} ${o.symbol} @ ${formatPrice(o.entry, PAIRS.find(p => p.symbol === o.symbol))}`, 'success'));
    if (triggered.length) { saveAccount(); updateAccountUI(); }
    checkStops();
  }

  function checkStops() {
    const toClose = [];
    state.account.positions.forEach(p => {
      const q = quoteFor(p.symbol);
      if (!q) return;
      const exit = p.side === 'buy' ? q.bid : q.ask;
      const hitSL = p.sl && (p.side === 'buy' ? exit <= p.sl : exit >= p.sl);
      const hitTP = p.tp && (p.side === 'buy' ? exit >= p.tp : exit <= p.tp);
      if (hitSL || hitTP) toClose.push({ id: p.id, reason: hitTP ? 'Take profit' : 'Stop loss' });
    });
    toClose.forEach(x => closePosition(x.id, x.reason));
  }

  function closePosition(id, reason = 'Manual close') {
    const index = state.account.positions.findIndex(p => p.id === id);
    if (index < 0) return;
    const position = state.account.positions[index];
    const q = quoteFor(position.symbol);
    const exit = q ? (position.side === 'buy' ? q.bid : q.ask) : position.entry;
    const pnl = calculatePositionPnl(position);
    state.account.positions.splice(index, 1);
    state.account.balance += pnl;
    state.account.history.unshift({ ...position, exit, pnl, closedAt: Date.now(), reason });
    state.account.equitySeries.push({ time: Date.now(), value: state.account.balance });
    saveAccount();
    updateAccountUI();
    showToast(reason, `${position.symbol} ditutup · ${formatMoney(pnl, true)}`, pnl >= 0 ? 'success' : 'error');
  }

  function cancelPending(id) {
    const order = state.account.pending.find(o => o.id === id);
    state.account.pending = state.account.pending.filter(o => o.id !== id);
    saveAccount();
    updateAccountUI();
    if (order) showToast('Pending order dibatalkan', `${order.symbol} dihapus.`, 'success');
  }

  function closeAll() {
    if (!state.account.positions.length) return showToast('Tidak ada posisi', 'Belum ada posisi terbuka.', 'error');
    [...state.account.positions].forEach(p => closePosition(p.id, 'Close all'));
  }

  function renderTradeTable() {
    const views = {
      positions: {
        head: ['Symbol','Side','Volume','Entry','Current','S/L','T/P','P/L',''],
        rows: state.account.positions.map(p => {
          const pair = PAIRS.find(x => x.symbol === p.symbol) || state.selectedPair;
          const q = quoteFor(p.symbol);
          const current = q ? (p.side === 'buy' ? q.bid : q.ask) : p.entry;
          const pnl = calculatePositionPnl(p);
          return [
            `<strong>${p.symbol}</strong>`, `<span class="${p.side === 'buy' ? 'positive' : 'negative'}">${p.side.toUpperCase()}</span>`, p.lot.toFixed(2), formatPrice(p.entry,pair), formatPrice(current,pair), p.sl ? formatPrice(p.sl,pair) : '—', p.tp ? formatPrice(p.tp,pair) : '—', `<strong class="${pnl >= 0 ? 'positive' : 'negative'}">${formatMoney(pnl,true)}</strong>`, `<button class="row-action" data-close="${p.id}">Close</button>`
          ];
        })
      },
      pending: {
        head: ['Symbol','Side','Type','Volume','Limit price','S/L','T/P','Created',''],
        rows: state.account.pending.map(p => {
          const pair = PAIRS.find(x => x.symbol === p.symbol) || state.selectedPair;
          return [`<strong>${p.symbol}</strong>`, `<span class="${p.side === 'buy' ? 'positive' : 'negative'}">${p.side.toUpperCase()}</span>`, 'LIMIT', p.lot.toFixed(2), formatPrice(p.entry,pair), p.sl ? formatPrice(p.sl,pair) : '—', p.tp ? formatPrice(p.tp,pair) : '—', new Date(p.openedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}), `<button class="row-action" data-cancel="${p.id}">Cancel</button>`];
        })
      },
      history: {
        head: ['Symbol','Side','Volume','Entry','Exit','P/L','Reason','Closed'],
        rows: state.account.history.map(p => {
          const pair = PAIRS.find(x => x.symbol === p.symbol) || state.selectedPair;
          return [`<strong>${p.symbol}</strong>`, `<span class="${p.side === 'buy' ? 'positive' : 'negative'}">${p.side.toUpperCase()}</span>`, p.lot.toFixed(2), formatPrice(p.entry,pair), formatPrice(p.exit,pair), `<strong class="${p.pnl >= 0 ? 'positive' : 'negative'}">${formatMoney(p.pnl,true)}</strong>`, p.reason, new Date(p.closedAt).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})];
        })
      }
    };
    const view = views[state.activeTable];
    els.tradeTableHead.innerHTML = `<tr>${view.head.map(h => `<th>${h}</th>`).join('')}</tr>`;
    els.tradeTableBody.innerHTML = view.rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
    els.tableEmpty.classList.toggle('hidden', view.rows.length > 0);
    els.positionCount.textContent = state.account.positions.length;
    els.pendingCount.textContent = state.account.pending.length;
    $$('[data-close]', els.tradeTableBody).forEach(b => b.addEventListener('click', () => closePosition(b.dataset.close)));
    $$('[data-cancel]', els.tradeTableBody).forEach(b => b.addEventListener('click', () => cancelPending(b.dataset.cancel)));
  }

  function setupChartCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function drawMarketChart() {
    const { ctx, width, height } = setupChartCanvas(els.marketChart);
    ctx.clearRect(0,0,width,height);
    const data = state.candles;
    drawChartGrid(ctx,width,height);
    if (!data.length) return;

    const pad = { top: 18, right: 68, bottom: 26, left: 12 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const highs = data.map(d => d.high), lows = data.map(d => d.low);
    let max = Math.max(...highs), min = Math.min(...lows);
    const rangePad = (max-min || max*0.002) * .08;
    max += rangePad; min -= rangePad;
    const x = i => pad.left + (i + .5) * (plotW / data.length);
    const y = value => pad.top + ((max-value)/(max-min))*plotH;

    ctx.save();
    ctx.beginPath(); ctx.rect(pad.left,pad.top,plotW,plotH); ctx.clip();
    if (state.chartType === 'line') {
      const gradient = ctx.createLinearGradient(0,pad.top,0,pad.top+plotH);
      gradient.addColorStop(0,'rgba(55,229,155,.2)'); gradient.addColorStop(1,'rgba(55,229,155,0)');
      ctx.beginPath();
      data.forEach((d,i) => i ? ctx.lineTo(x(i),y(d.close)) : ctx.moveTo(x(i),y(d.close)));
      ctx.lineTo(x(data.length-1),pad.top+plotH); ctx.lineTo(x(0),pad.top+plotH); ctx.closePath(); ctx.fillStyle=gradient; ctx.fill();
      ctx.beginPath(); data.forEach((d,i) => i ? ctx.lineTo(x(i),y(d.close)) : ctx.moveTo(x(i),y(d.close))); ctx.strokeStyle='#37e59b'; ctx.lineWidth=1.7; ctx.stroke();
    } else {
      const step = plotW/data.length;
      const bodyW = Math.max(1.5, Math.min(8, step*.58));
      data.forEach((d,i) => {
        const up = d.close >= d.open;
        const color = up ? '#37e59b' : '#ff6376';
        ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(x(i),y(d.high)); ctx.lineTo(x(i),y(d.low)); ctx.stroke();
        const top = Math.min(y(d.open),y(d.close));
        const bodyH = Math.max(1,Math.abs(y(d.close)-y(d.open)));
        ctx.fillRect(x(i)-bodyW/2,top,bodyW,bodyH);
      });
    }
    ctx.restore();

    ctx.fillStyle='#657a71'; ctx.font='9px DM Sans'; ctx.textAlign='left';
    for(let i=0;i<5;i++){
      const val=max-((max-min)/4)*i;
      const yy=pad.top+(plotH/4)*i;
      ctx.fillText(formatPrice(val), width-pad.right+8, yy+3);
    }
    ctx.textAlign='center';
    [0,.25,.5,.75,1].forEach(frac => {
      const idx=Math.min(data.length-1,Math.floor((data.length-1)*frac));
      const d=new Date(data[idx].time);
      const label=state.interval==='1day' ? d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) : d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
      ctx.fillText(label,pad.left+plotW*frac,height-8);
    });

    const last=data.at(-1);
    const lastY=y(last.close);
    ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(55,229,155,.45)'; ctx.beginPath(); ctx.moveTo(pad.left,lastY); ctx.lineTo(width-pad.right,lastY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#37e59b'; roundRect(ctx,width-pad.right+4,lastY-10,60,20,5); ctx.fill();
    ctx.fillStyle='#07110f'; ctx.font='700 9px Space Grotesk'; ctx.textAlign='center'; ctx.fillText(formatPrice(last.close),width-pad.right+34,lastY+3);

    if (state.chartHoverIndex != null && data[state.chartHoverIndex]) {
      const i=state.chartHoverIndex, d=data[i], xx=x(i), yy=y(d.close);
      ctx.setLineDash([3,3]); ctx.strokeStyle='rgba(200,220,212,.22)';
      ctx.beginPath(); ctx.moveTo(xx,pad.top); ctx.lineTo(xx,pad.top+plotH); ctx.moveTo(pad.left,yy); ctx.lineTo(pad.left+plotW,yy); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawChartGrid(ctx,width,height) {
    ctx.strokeStyle='rgba(163,202,188,.055)'; ctx.lineWidth=1;
    for(let i=1;i<6;i++){ const x=width*i/6; ctx.beginPath(); ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke(); }
    for(let i=1;i<5;i++){ const y=height*i/5; ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke(); }
  }

  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath();ctx.roundRect ? ctx.roundRect(x,y,w,h,r) : ctx.rect(x,y,w,h); }

  function updateOHLC(candle) {
    if (!candle) return;
    els.ohlcBar.innerHTML = `<span>O ${formatPrice(candle.open)}</span><span>H ${formatPrice(candle.high)}</span><span>L ${formatPrice(candle.low)}</span><span>C ${formatPrice(candle.close)}</span>`;
  }

  function onChartMove(event) {
    if (!state.candles.length) return;
    const rect=els.marketChart.getBoundingClientRect();
    const padL=12,padR=68;
    const plotW=rect.width-padL-padR;
    const pos=Math.max(0,Math.min(plotW,event.clientX-rect.left-padL));
    state.chartHoverIndex=Math.min(state.candles.length-1,Math.floor((pos/plotW)*state.candles.length));
    updateOHLC(state.candles[state.chartHoverIndex]);
    drawMarketChart();
  }

  function updatePortfolioStats() {
    const history = state.account.history;
    const wins = history.filter(t => t.pnl > 0).length;
    const losses = history.filter(t => t.pnl < 0).length;
    const net = state.account.balance - 10000;
    els.netPnlStat.textContent = formatMoney(net,true);
    els.netPnlStat.className = net >= 0 ? 'positive' : 'negative';
    els.winRateStat.textContent = history.length ? `${((wins/history.length)*100).toFixed(1)}%` : '0%';
    els.winsStat.textContent = `${wins} menang / ${losses} kalah`;
    els.totalTradesStat.textContent = history.length;
    els.bestTradeStat.textContent = formatMoney(Math.max(0,...history.map(t=>t.pnl)),true);
    drawEquityChart();
    updateRiskScore();
  }

  function drawEquityChart() {
    if (!els.equityChart) return;
    const {ctx,width,height}=setupChartCanvas(els.equityChart);
    ctx.clearRect(0,0,width,height); drawChartGrid(ctx,width,height);
    const data=state.account.equitySeries.length > 1 ? state.account.equitySeries : [{time:Date.now()-86400000,value:10000},...state.account.equitySeries];
    const pad={top:28,right:25,bottom:28,left:55}, w=width-pad.left-pad.right,h=height-pad.top-pad.bottom;
    let min=Math.min(...data.map(d=>d.value)),max=Math.max(...data.map(d=>d.value));
    if(min===max){min-=100;max+=100;} else {const p=(max-min)*.15;min-=p;max+=p;}
    const x=i=>pad.left+(i/(data.length-1))*w, y=v=>pad.top+((max-v)/(max-min))*h;
    const grad=ctx.createLinearGradient(0,pad.top,0,pad.top+h);grad.addColorStop(0,'rgba(55,229,155,.2)');grad.addColorStop(1,'rgba(55,229,155,0)');
    ctx.beginPath();data.forEach((d,i)=>i?ctx.lineTo(x(i),y(d.value)):ctx.moveTo(x(i),y(d.value)));ctx.lineTo(x(data.length-1),pad.top+h);ctx.lineTo(x(0),pad.top+h);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();data.forEach((d,i)=>i?ctx.lineTo(x(i),y(d.value)):ctx.moveTo(x(i),y(d.value)));ctx.strokeStyle='#37e59b';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#657a71';ctx.font='9px DM Sans';ctx.textAlign='right';
    for(let i=0;i<5;i++){const v=max-((max-min)/4)*i;ctx.fillText(`$${v.toFixed(0)}`,pad.left-8,pad.top+(h/4)*i+3);}
  }

  function updateRiskScore() {
    const open=state.account.positions;
    const margin=accountMetrics().margin;
    let score=100;
    if(open.length>5) score-=15;
    if(margin>5000) score-=20;
    if(open.some(p=>!p.sl)) score-=15;
    if(open.some(p=>p.lot>1)) score-=15;
    score=Math.max(0,score);
    els.riskScore.textContent=score;
    els.riskRing.style.setProperty('--risk-angle',`${score}%`);
    const checks=[
      ['Position count',open.length<=5],
      ['Margin exposure',margin<=5000],
      ['Stop loss coverage',!open.some(p=>!p.sl)],
      ['Lot discipline',!open.some(p=>p.lot>1)]
    ];
    els.riskChecks.innerHTML=checks.map(([label,ok])=>`<li><span>${label}</span><b class="${ok?'positive':'negative'}">${ok?'GOOD':'CHECK'}</b></li>`).join('');
  }

  function renderLeaderboard() {
    const traders=[
      {rank:1,name:'Aldo Pratama',user:'@aldofx',ret:28.47,win:72,trades:148,score:9870},
      {rank:2,name:'Nadia Aurelia',user:'@nadia.trade',ret:23.15,win:68,trades:121,score:9412},
      {rank:3,name:'Kevin Wijaya',user:'@kevcharts',ret:19.82,win:65,trades:104,score:9038},
      {rank:4,name:'Radit Sunandar',user:'@ditztrader',ret:Math.max(0,(state.account.balance-10000)/100),win:state.account.history.length ? Math.round(state.account.history.filter(t=>t.pnl>0).length/state.account.history.length*100):0,trades:state.account.history.length,score:8800+Math.round(Math.max(0,state.account.balance-10000)),me:true},
      {rank:5,name:'Raka Mahendra',user:'@rakamarket',ret:15.27,win:61,trades:97,score:8541},
      {rank:6,name:'Salsa Nabila',user:'@salsapips',ret:13.94,win:59,trades:88,score:8210},
      {rank:7,name:'Bima Arsyad',user:'@bimafx',ret:12.80,win:57,trades:110,score:7994},
      {rank:8,name:'Cindy Lestari',user:'@cindyl',ret:11.32,win:55,trades:79,score:7730}
    ];
    const podiumOrder=[traders[1],traders[0],traders[2]];
    els.podium.innerHTML=podiumOrder.map(t=>`<article class="podium-card ${t.rank===1?'first':t.rank===2?'second':'third'}"><span class="rank-medal">${t.rank}</span><div class="trader-avatar">${initials(t.name)}</div><h3>${t.name}</h3><p>${t.user}</p><strong>+${t.ret.toFixed(2)}%</strong></article>`).join('');
    els.leaderboardRows.innerHTML=traders.map(t=>`<div class="leaderboard-row ${t.me?'me':''}"><strong>#${t.rank}</strong><div class="trader-cell"><div class="trader-avatar">${initials(t.name)}</div><div><strong>${t.name}${t.me?' · You':''}</strong><small>${t.user}</small></div></div><span class="positive">+${t.ret.toFixed(2)}%</span><span>${t.win}%</span><span>${t.trades}</span><span>${t.score.toLocaleString('en-US')}</span></div>`).join('');
  }

  const initials=name=>name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

  function showToast(title,message,type='success') {
    const toast=document.createElement('div');toast.className=`toast ${type}`;toast.innerHTML=`<strong>${title}</strong><span>${message}</span>`;els.toastStack.appendChild(toast);setTimeout(()=>toast.remove(),4200);
  }

  function switchView(view) {
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    $$('.view').forEach(v=>v.classList.remove('active'));
    $(`#${view}View`).classList.add('active');
    if(view==='portfolio') setTimeout(drawEquityChart,30);
    if(view==='leaderboard') renderLeaderboard();
  }

  function resetAccount() {
    state.account=structuredClone(DEFAULT_ACCOUNT);saveAccount();updateAccountUI();renderLeaderboard();showToast('Demo account direset','Balance kembali menjadi $10,000.00.','success');
  }

  function bindEvents() {
    els.pairSearch.addEventListener('input',e=>renderWatchlist(e.target.value));
    els.refreshBtn.addEventListener('click',async()=>{await fetchQuotes();await fetchCandles();});
    els.orderForm.addEventListener('submit',placeOrder);
    els.lotInput.addEventListener('input',updateOrderUI);
    els.closeAllBtn.addEventListener('click',closeAll);
    els.accountBtn.addEventListener('click',()=>els.accountModal.classList.remove('hidden'));
    $$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>els.accountModal.classList.add('hidden')));
    els.accountModal.addEventListener('click',e=>{if(e.target===els.accountModal)els.accountModal.classList.add('hidden');});
    els.notificationBtn.addEventListener('click',()=>showToast('DiTz FX','Notifikasi market dan eksekusi order akan muncul di sini.'));
    els.fullscreenBtn.addEventListener('click',()=>els.chartCard?.requestFullscreen?.() || els.chartWrap.requestFullscreen?.());
    els.resetAccountBtn.addEventListener('click',resetAccount);
    window.addEventListener('resize',()=>{drawMarketChart();drawEquityChart();});
    els.marketChart.addEventListener('mousemove',onChartMove);
    els.marketChart.addEventListener('mouseleave',()=>{state.chartHoverIndex=null;updateOHLC(state.candles.at(-1));drawMarketChart();});
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $$('#intervalButtons button').forEach(b=>b.addEventListener('click',async()=>{$$('#intervalButtons button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.interval=b.dataset.interval;await fetchCandles();}));
    $('#candleBtn').addEventListener('click',()=>{state.chartType='candles';$('#candleBtn').classList.add('active');$('#lineBtn').classList.remove('active');drawMarketChart();});
    $('#lineBtn').addEventListener('click',()=>{state.chartType='line';$('#lineBtn').classList.add('active');$('#candleBtn').classList.remove('active');drawMarketChart();});
    $$('#orderTypeTabs button').forEach(b=>b.addEventListener('click',()=>{$$('#orderTypeTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.orderType=b.dataset.orderType;els.limitPriceField.classList.toggle('hidden',state.orderType!=='limit');updateOrderUI();}));
    $$('#sideToggle button').forEach(b=>b.addEventListener('click',()=>{$$('#sideToggle button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.orderSide=b.dataset.side;els.limitPriceInput.value='';updateOrderUI();}));
    $$('#riskPresets button').forEach(b=>b.addEventListener('click',()=>{$$('#riskPresets button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.riskPercent=Number(b.dataset.risk);const risk=state.account.balance*state.riskPercent/100;els.lotInput.value=Math.max(.01,Math.min(5,risk/100)).toFixed(2);updateOrderUI();}));
    $$('#positionTabs button').forEach(b=>b.addEventListener('click',()=>{$$('#positionTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.activeTable=b.dataset.table;renderTradeTable();}));
  }

  async function init() {
    cacheElements();
    els.chartCard=$('.chart-card');
    renderWatchlist();
    bindEvents();
    updateAccountUI();
    renderLeaderboard();
    updateOrderUI();
    const quotesOk=await fetchQuotes();
    await fetchCandles();
    if(quotesOk) showToast('DiTz FX connected','Harga forex asli berhasil dimuat dari provider.','success');
    state.refreshTimer=setInterval(()=>fetchQuotes({silent:true}),60000);
    setInterval(updateAccountUI,3000);
  }

  document.addEventListener('DOMContentLoaded',init);
})();
