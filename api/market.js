const ALLOWED_PAIRS = new Set([
  'EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD','EUR/JPY'
]);
const ALLOWED_INTERVALS = new Set(['1min','5min','15min','1h','4h','1day']);
const CACHE = new Map();

function send(res, status, payload, maxAge = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', maxAge ? `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}` : 'no-store');
  res.status(status).json(payload);
}

function sanitizeSymbols(input) {
  const symbols = String(input || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  if (!symbols.length || symbols.length > 8 || symbols.some(s => !ALLOWED_PAIRS.has(s))) return null;
  return [...new Set(symbols)];
}

async function twelveData(path, params, ttlMs) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    const error = new Error('TWELVE_DATA_API_KEY belum dikonfigurasi pada server.');
    error.status = 503;
    throw error;
  }
  const url = new URL(`https://api.twelvedata.com/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const cacheKey = url.toString().replace(key, '***');
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `apikey ${key}`, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === 'error' || data.code) {
      const message = data.message || `Twelve Data error (${response.status})`;
      const error = new Error(message);
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    CACHE.set(cacheKey, { time: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });
  const action = String(req.query.action || 'quotes');

  try {
    if (action === 'quotes') {
      const symbols = sanitizeSymbols(req.query.symbols);
      if (!symbols) return send(res, 400, { message: 'Daftar pair forex tidak valid.' });
      const raw = await twelveData('quote', { symbol: symbols.join(','), dp: 8 }, 15000);
      const quotes = {};
      if (symbols.length === 1 && raw.symbol) {
        quotes[symbols[0]] = raw;
      } else {
        symbols.forEach(symbol => {
          if (raw[symbol]) quotes[symbol] = raw[symbol];
        });
      }
      return send(res, 200, { provider: 'Twelve Data', fetchedAt: new Date().toISOString(), quotes }, 10);
    }

    if (action === 'candles') {
      const symbol = String(req.query.symbol || '').toUpperCase();
      const interval = String(req.query.interval || '5min');
      const outputsize = Math.min(300, Math.max(30, Number(req.query.outputsize) || 160));
      if (!ALLOWED_PAIRS.has(symbol)) return send(res, 400, { message: 'Pair forex tidak didukung.' });
      if (!ALLOWED_INTERVALS.has(interval)) return send(res, 400, { message: 'Interval chart tidak valid.' });
      const raw = await twelveData('time_series', { symbol, interval, outputsize, order: 'asc', timezone: 'UTC', dp: 8 }, interval === '1min' ? 15000 : 30000);
      return send(res, 200, { provider: 'Twelve Data', meta: raw.meta, values: raw.values || [], fetchedAt: new Date().toISOString() }, interval === '1min' ? 10 : 20);
    }

    return send(res, 400, { message: 'Action tidak dikenal.' });
  } catch (error) {
    const status = error.status || (error.name === 'AbortError' ? 504 : 500);
    return send(res, status, { message: error.name === 'AbortError' ? 'Market data provider timeout.' : error.message });
  }
}
