const ALLOWED_PAIRS = new Set([
  'EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD','EUR/JPY'
]);
const ALLOWED_INTERVALS = new Set(['1min','5min','15min','1h','4h','1day']);
const CACHE = globalThis.__DITZ_FX_MARKET_CACHE__ || new Map();
globalThis.__DITZ_FX_MARKET_CACHE__ = CACHE;

function send(res, status, payload, maxAge = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    maxAge
      ? `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.max(maxAge * 4, 300)}`
      : 'no-store'
  );
  res.status(status).json(payload);
}

function sanitizeSymbol(input) {
  const symbol = String(input || '').trim().toUpperCase();
  return ALLOWED_PAIRS.has(symbol) ? symbol : null;
}

async function twelveData(path, params, ttlMs, staleMs = 30 * 60 * 1000) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    const error = new Error('TWELVE_DATA_API_KEY belum dikonfigurasi pada server.');
    error.status = 503;
    throw error;
  }

  const url = new URL(`https://api.twelvedata.com/${path}`);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  const cacheKey = url.toString();
  const cached = CACHE.get(cacheKey);
  const age = cached ? Date.now() - cached.time : Infinity;
  if (cached && age < ttlMs) return { data: cached.data, stale: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `apikey ${key}`, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === 'error' || data.code) {
      if (cached && age < staleMs) return { data: cached.data, stale: true };
      const message = data.message || `Twelve Data error (${response.status})`;
      const error = new Error(message);
      error.status = response.status === 429 || data.code === 429 ? 429 : 502;
      throw error;
    }
    CACHE.set(cacheKey, { time: Date.now(), data });
    return { data, stale: false };
  } catch (error) {
    if (cached && age < staleMs) return { data: cached.data, stale: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function candleCacheSeconds(interval) {
  return {
    '1min': 50,
    '5min': 180,
    '15min': 300,
    '1h': 600,
    '4h': 1800,
    '1day': 3600
  }[interval] || 180;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });
  const action = String(req.query.action || 'quotes');

  try {
    if (action === 'quotes') {
      const symbol = sanitizeSymbol(req.query.symbols || req.query.symbol);
      if (!symbol) return send(res, 400, { message: 'Kirim hanya satu pair forex yang valid.' });
      const result = await twelveData('quote', { symbol, dp: 8 }, 55_000);
      return send(res, 200, {
        provider: 'Twelve Data',
        fetchedAt: new Date().toISOString(),
        stale: result.stale,
        quotes: { [symbol]: result.data }
      }, 55);
    }

    if (action === 'candles') {
      const symbol = sanitizeSymbol(req.query.symbol);
      const interval = String(req.query.interval || '5min');
      const outputsize = Math.min(160, Math.max(30, Number(req.query.outputsize) || 120));
      if (!symbol) return send(res, 400, { message: 'Pair forex tidak didukung.' });
      if (!ALLOWED_INTERVALS.has(interval)) return send(res, 400, { message: 'Interval chart tidak valid.' });
      const cacheSeconds = candleCacheSeconds(interval);
      const result = await twelveData(
        'time_series',
        { symbol, interval, outputsize, order: 'asc', timezone: 'UTC', dp: 8 },
        cacheSeconds * 1000
      );
      return send(res, 200, {
        provider: 'Twelve Data',
        meta: result.data.meta,
        values: result.data.values || [],
        fetchedAt: new Date().toISOString(),
        stale: result.stale
      }, cacheSeconds);
    }

    return send(res, 400, { message: 'Action tidak dikenal.' });
  } catch (error) {
    const status = error.status || (error.name === 'AbortError' ? 504 : 500);
    if (status === 429) res.setHeader('Retry-After', '60');
    return send(res, status, {
      message: error.name === 'AbortError' ? 'Market data provider timeout.' : error.message
    });
  }
}
