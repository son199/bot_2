// Hàm tìm swing high/low gần nhất (20 nến)
function findSwingHighLow(candles, lookback = 20) {
  let swingHigh = candles[0].high;
  let swingLow = candles[0].low;
  let highIdx = 0, lowIdx = 0;
  for (let i = candles.length - lookback; i < candles.length; i++) {
    if (candles[i].high > swingHigh) {
      swingHigh = candles[i].high;
      highIdx = i;
    }
    if (candles[i].low < swingLow) {
      swingLow = candles[i].low;
      lowIdx = i;
    }
  }
  return { swingHigh, swingLow, highIdx, lowIdx };
}

// Hàm tính vùng Fibo 0.5–0.618 cho sóng gần nhất
function getFiboZone(swingHigh, swingLow, isLong) {
  if (isLong) {
    const fibo618 = swingHigh - (swingHigh - swingLow) * 0.618;
    const fibo50 = swingHigh - (swingHigh - swingLow) * 0.5;
    return { fiboMin: fibo618, fiboMax: fibo50 };
  } else {
    const fibo618 = swingLow + (swingHigh - swingLow) * 0.618;
    const fibo50 = swingLow + (swingHigh - swingLow) * 0.5;
    return { fiboMin: fibo50, fiboMax: fibo618 };
  }
}
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

// Lưu thời điểm gửi lệnh cho từng cặp symbol-timeframe-type
const sentSignals = new Map();
const SIGNAL_COOLDOWN_MS = 15 * 60 * 1000; // 15 phút
const DEFAULT_LEVERAGE = 20;

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

      const bullish = isBullishEngulfingLoose(prev, curr, opts) || isStrongBullish(prev, curr, opts);
      const bearish = isBearishEngulfingLoose(prev, curr, opts) || isStrongBearish(prev, curr, opts);

        const trendSlope = detectTrendline(closes, 30);
        const isTrendUp = trendSlope > 0;
        const isTrendDown = trendSlope < 0;

        console.log(`\n${symbol} ${timeframe} | EMA20: ${ema20.toFixed(2)} | EMA50: ${ema50.toFixed(2)} | EMA200: ${ema200.toFixed(2)} | RSI: ${rsi.toFixed(2)}`);
        console.log(`Bullish pattern: ${bullish}, Bearish pattern: ${bearish}`);
        console.log(`Trend slope: ${trendSlope.toFixed(6)} (${isTrendUp ? 'Uptrend' : isTrendDown ? 'Downtrend' : 'Sideways'})`);

        // === Điều kiện LONG: EMA trend + Fibo pullback + confluence + nến xác nhận ===
        if (
          ema20 > ema50 &&
          ema50 > ema200 &&
          rsi > 30 &&
          rsi < 50 &&
          isTrendUp
        ) {
          // 1. Xác định swing và vùng Fibo
          const { swingHigh, swingLow } = findSwingHighLow(candles);
          const { fiboMin, fiboMax } = getFiboZone(swingHigh, swingLow, true);
          // 2. Kiểm tra giá hồi về vùng Fibo
          const inFiboZone = curr.low <= fiboMax && curr.high >= fiboMin;
          // 3. EMA50 nằm trong vùng Fibo (confluence)
          const ema50InFibo = ema50 >= fiboMin && ema50 <= fiboMax;
          // 4. Nến xác nhận tại vùng hợp lưu
          if (inFiboZone && ema50InFibo && (isPinBar(curr, 'bull') || isBullishEngulfingLoose(prev, curr) || isStrongBullish(prev, curr))) {
            const entry = curr.close;
            const sl = curr.low * 0.995; // SL gần hơn: dưới đáy nến xác nhận
            const risk = entry - sl;
            const tp1 = entry + risk * 1;
            const tp2 = entry + risk * 1.5;
            const tp3 = entry + risk * 2;
            console.log(`🚀 LONG Fibo signal for ${symbol} at ${timeframe}`);
            // Chống gửi lại lệnh trong 15 phút
            const signalKey = `${symbol}_${timeframe}_LONG`;
            const now = Date.now();
            if (!sentSignals.has(signalKey) || now - sentSignals.get(signalKey) > SIGNAL_COOLDOWN_MS) {
              await sendMessage(
                `🚀 *LONG Fibo Signal*\n` +
                `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
                `*Entry:* ${entry.toFixed(5)}\n` +
                `*Stop Loss:* ${sl.toFixed(5)}\n` +
                `*TP1:* ${tp1.toFixed(5)}\n*TP2:* ${tp2.toFixed(5)}\n*TP3:* ${tp3.toFixed(5)}\n\n` +
                `*Đòn Bẩy:* ${DEFAULT_LEVERAGE}x\n` +
                `EMA20>EMA50>EMA200\nRSI=${rsi.toFixed(2)}\nFibo: [${fiboMin.toFixed(2)} - ${fiboMax.toFixed(2)}]\nEMA50: ${ema50.toFixed(2)}`
              );
              sentSignals.set(signalKey, now);
            } else {
              console.log(`LONG signal for ${symbol} at ${timeframe} đã gửi trong 15 phút qua, bỏ qua.`);
            }
          }
        }

        // === Điều kiện SHORT: EMA trend + Fibo pullback + confluence + nến xác nhận ===
        if (
          ema20 < ema50 &&
          ema50 < ema200 &&
          rsi > 50 &&
          rsi < 100 &&
          isTrendDown
        ) {
          // 1. Xác định swing và vùng Fibo
          const { swingHigh, swingLow } = findSwingHighLow(candles);
          const { fiboMin, fiboMax } = getFiboZone(swingHigh, swingLow, false);
          // 2. Kiểm tra giá hồi về vùng Fibo
          const inFiboZone = curr.high >= fiboMin && curr.low <= fiboMax;
          // 3. EMA50 nằm trong vùng Fibo (confluence)
          const ema50InFibo = ema50 >= fiboMin && ema50 <= fiboMax;
          // 4. Nến xác nhận tại vùng hợp lưu
          if (inFiboZone && ema50InFibo && (isPinBar(curr, 'bear') || isBearishEngulfingLoose(prev, curr) || isStrongBearish(prev, curr))) {
            const entry = curr.close;
            const sl = curr.high * 1.005; // SL gần hơn: trên đỉnh nến xác nhận
            const risk = sl - entry;
            const tp1 = entry - risk * 1;
            const tp2 = entry - risk * 1.5;
            const tp3 = entry - risk * 2;
            console.log(`🔻 SHORT Fibo signal for ${symbol} at ${timeframe}`);
            // Chống gửi lại lệnh trong 15 phút
            const signalKey = `${symbol}_${timeframe}_SHORT`;
            const now = Date.now();
            if (!sentSignals.has(signalKey) || now - sentSignals.get(signalKey) > SIGNAL_COOLDOWN_MS) {
              await sendMessage(
                `🔻 *SHORT Fibo Signal*\n` +
                `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
                `*Entry:* ${entry.toFixed(5)}\n` +
                `*Stop Loss:* ${sl.toFixed(5)}\n` +
                `*TP1:* ${tp1.toFixed(5)}\n*TP2:* ${tp2.toFixed(5)}\n*TP3:* ${tp3.toFixed(5)}\n\n` +
                `*Đòn Bẩy:* ${DEFAULT_LEVERAGE}x\n` +
                `EMA20<EMA50<EMA200\nRSI=${rsi.toFixed(2)}\nFibo: [${fiboMin.toFixed(2)} - ${fiboMax.toFixed(2)}]\nEMA50: ${ema50.toFixed(2)}`
              );
              sentSignals.set(signalKey, now);
            } else {
              console.log(`SHORT signal for ${symbol} at ${timeframe} đã gửi trong 15 phút qua, bỏ qua.`);
            }
          }
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
