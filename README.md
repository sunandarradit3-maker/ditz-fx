# DiTz FX

Dashboard paper trading forex responsif dengan harga pasar asli melalui Twelve Data.

## Fitur

- Watchlist 8 pair forex mayor/minor.
- Candlestick dan line chart dengan interval 1m, 5m, 15m, 1H, 4H, dan 1D.
- Market order dan limit order untuk paper trading.
- Stop loss, take profit, margin, pip value, floating P/L, history, dan local persistence.
- Portfolio analytics, equity curve, discipline score, dan leaderboard demo.
- Indicative market depth yang diberi label jelas karena spot forex OTC tidak memiliki satu order book pusat.
- API key disimpan di serverless function, bukan di browser.

## Jalankan lokal

1. Instal Vercel CLI/dependency:

   ```bash
   npm install
   ```

2. Salin environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Isi `TWELVE_DATA_API_KEY` dengan API key milikmu.

4. Jalankan:

   ```bash
   npm run dev
   ```

## Deploy ke Vercel

1. Import folder/repository ini ke Vercel.
2. Buka **Project Settings → Environment Variables**.
3. Tambahkan `TWELVE_DATA_API_KEY`.
4. Deploy ulang.

## Batasan yang sengaja dibuat transparan

- Ini adalah **paper trading**, bukan broker dan tidak memproses uang asli.
- Harga berasal dari provider market data dan tingkat keterlambatan/refresh mengikuti paket API.
- Panel market depth bersifat indikatif, bukan order book terpusat atau data Level 2.
- Leaderboard pada versi ini adalah data komunitas demo; untuk multi-user sungguhan perlu autentikasi dan database.
