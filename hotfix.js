(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const responseCache = new Map();

  function selectedPair() {
    const value = document.getElementById('pairTitle')?.textContent?.trim().toUpperCase();
    return /^[A-Z]{3}\/[A-Z]{3}$/.test(value || '') ? value : 'EUR/USD';
  }

  function cachedResponse(entry) {
    return new Response(entry.body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers
    });
  }

  window.fetch = async (input, init) => {
    let url;
    try {
      const source = input instanceof Request ? input.url : String(input);
      url = new URL(source, window.location.href);
    } catch {
      return originalFetch(input, init);
    }

    if (url.origin !== window.location.origin || url.pathname !== '/api/market') {
      return originalFetch(input, init);
    }

    const action = url.searchParams.get('action') || 'quotes';
    if (action === 'quotes') {
      url.searchParams.set('symbols', selectedPair());
    }

    const key = url.toString();
    const freshFor = action === 'quotes' ? 55_000 : action === 'candles' ? 120_000 : 0;
    const staleFor = 10 * 60_000;
    const cached = responseCache.get(key);
    const age = cached ? Date.now() - cached.time : Infinity;

    if (cached && age < freshFor) return cachedResponse(cached);

    try {
      const response = await originalFetch(url, init);
      if (response.ok && freshFor) {
        const clone = response.clone();
        const body = await clone.text();
        responseCache.set(key, {
          time: Date.now(),
          body,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()]
        });
      }
      if (response.status === 429 && cached && age < staleFor) return cachedResponse(cached);
      return response;
    } catch (error) {
      if (cached && age < staleFor) return cachedResponse(cached);
      throw error;
    }
  };
})();
