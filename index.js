const ccxt = require("ccxt");
const {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  isBullishEngulfing,
  isBearishEngulfing,
  isBullishEngulfingLoose,
  isBearishEngulfingLoose,
  isStrongBullish,
  isStrongBearish,
  isPinBar,
  detectTrendline
} = require("./indicators");
const { sendMessage } = require("./telegram");
const { INTERVALS, SCAN_INTERVAL, SYMBOLS_LIMIT } = require("./config");

const exchange = new ccxt.binance({
  options: { defaultType: "future" },
});

async function getSignals() {
  const markets = await exchange.loadMarkets();
  console.log(`Loaded ${Object.keys(markets).length} markets.`);
  const symbols = Object.keys(markets).filter(s => s.endsWith("/USDT")).slice(0, SYMBOLS_LIMIT);

  for (const symbol of symbols) {
    for (const timeframe of INTERVALS) {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 200);
        const closes = ohlcv.map(c => c[4]);
        const candles = ohlcv.map(([t, o, h, l, c, v]) => ({ open: o, high: h, low: l, close: c, volume: v }));

        const ema20 = calculateEMA(closes, 20).pop();
        const ema50 = calculateEMA(closes, 50).pop();
        const ema200 = calculateEMA(closes, 200).pop();
        const rsi = calculateRSI(closes).pop();
        const macd = calculateMACD(closes).pop();

        const prev = candles[candles.length - 2];
        const curr = candles[candles.length - 1];

        const opts = { minBodyPct: 0.22, partialEngulfPct: 0.55, requireVolume: false };

        // const bullish = isBullishEngulfingLoose(prev, curr, opts) || isPinBar(curr, 'bull') || isStrongBullish(prev, curr);
        // const bearish = isBearishEngulfingLoose(prev, curr, opts) || isPinBar(curr, 'bear') || isStrongBearish(prev, curr);

        const bullish = isBullishEngulfingLoose(prev, curr, opts);
        const bearish = isBearishEngulfingLoose(prev, curr, opts);

        const trendSlope = detectTrendline(closes, 20);
        const isTrendUp = trendSlope > 0;
        const isTrendDown = trendSlope < 0;

        console.log(`\n${symbol} ${timeframe} | EMA20: ${ema20.toFixed(2)} | EMA50: ${ema50.toFixed(2)} | EMA200: ${ema200.toFixed(2)} | RSI: ${rsi.toFixed(2)}`);
        console.log(`Bullish pattern: ${bullish}, Bearish pattern: ${bearish}`);
        console.log(`Trend slope: ${trendSlope.toFixed(6)} (${isTrendUp ? 'Uptrend' : isTrendDown ? 'Downtrend' : 'Sideways'})`);

        // === Điều kiện LONG ===
        if (
          ema20 > ema50 &&
          ema50 > ema200 &&
          rsi > 40 &&
          rsi < 50 &&
          bullish && 
          isTrendUp
        ) {
          const entry = curr.close;
          const sl = curr.low * 0.995; // SL cách 0.5% dưới đáy nến
          const risk = entry - sl;

          const tp1 = entry + risk * 1;   // R:R 1:1
          const tp2 = entry + risk * 1.5; // R:R 1:1.5
          const tp3 = entry + risk * 2;   // R:R 1:2

          console.log(`🚀 LONG signal detected for ${symbol} at ${timeframe}`);
          console.log(`Entry=${entry}, SL=${sl}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`);

          await sendMessage(
            `🚀 *LONG Signal Detected*\n` +
            `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
            `*Entry:* ${entry}\n` +
            `*Stop Loss:* ${sl}\n` +
            `*TP1:* ${tp1}\n*TP2:* ${tp2}\n*TP3:* ${tp3}\n\n` +
            `EMA20>EMA50>EMA200\nRSI=${rsi.toFixed(2)}` +
            `Bullish: ${bullish}`+
            `Trend: ${isTrendUp ? 'Uptrend' : 'Sideways'}`
          );
        }

        // === Điều kiện SHORT ===
        if (
          ema20 < ema50 &&
          ema50 < ema200 &&
          rsi > 50 &&
          rsi < 60 &&
          bearish &&
          isTrendDown
        ) {
          const entry = curr.close;
          const sl = curr.high * 1.005; // SL cách 0.5% trên đỉnh nến
          const risk = sl - entry;

          const tp1 = entry - risk * 1;   // R:R 1:1
          const tp2 = entry - risk * 1.5; // R:R 1:1.5
          const tp3 = entry - risk * 2;   // R:R 1:2

          console.log(`🔻 SHORT signal detected for ${symbol} at ${timeframe}`);
          console.log(`Entry=${entry}, SL=${sl}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`);

          await sendMessage(
            `🔻 *SHORT Signal Detected*\n` +
            `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
            `*Entry:* ${entry}\n` +
            `*Stop Loss:* ${sl}\n` +
            `*TP1:* ${tp1}\n*TP2:* ${tp2}\n*TP3:* ${tp3}\n\n` +
            `EMA20<EMA50<EMA200\nRSI=${rsi.toFixed(2)}` +
            `Bearish: ${bearish}` +
            `Trend: ${isTrendDown ? 'Downtrend' : 'Sideways'}`
          );
        }

        else {
          console.log(`No signal for ${symbol} at ${timeframe}`);
        }

      } catch (err) {
        console.log(`Error ${symbol} ${timeframe}:`, err.message);
      }
    }
  }
}

(async () => {
  console.log("🚀 Scalping bot started...");
  await getSignals();
  setInterval(getSignals, SCAN_INTERVAL);
})();
