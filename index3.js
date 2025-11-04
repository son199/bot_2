// Hàm lấy danh sách các swing high/low gần nhất làm vùng hỗ trợ/kháng cự
function getSupportResistanceZones(candles, lookback = 50, count = 3) {
    let highs = [], lows = [];
    for (let i = candles.length - lookback; i < candles.length; i++) {
        let isHigh = true, isLow = true;
        for (let j = -2; j <= 2; j++) {
            if (j === 0 || i + j < 0 || i + j >= candles.length) continue;
            if (candles[i].high < candles[i + j].high) isHigh = false;
            if (candles[i].low > candles[i + j].low) isLow = false;
        }
        if (isHigh) highs.push(candles[i].high);
        if (isLow) lows.push(candles[i].low);
    }
    // Lấy các vùng mạnh nhất (gần hiện tại nhất)
    highs = highs.slice(-count);
    lows = lows.slice(-count);
    return { resistances: highs, supports: lows };
}
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
    // Xác định vùng hỗ trợ/kháng cự gần nhất
    const markets = await exchange.loadMarkets();
    console.log(`Loaded ${Object.keys(markets).length} markets.`);
    const symbols = Object.keys(markets).filter(s => s.endsWith("/USDT")).slice(0, SYMBOLS_LIMIT);

    for (const symbol of symbols) {
        for (const timeframe of INTERVALS) {
            try {
                const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 200);
                const closes = ohlcv.map(c => c[4]);
                const candles = ohlcv.map(([t, o, h, l, c, v]) => ({ open: o, high: h, low: l, close: c, volume: v }));


                // Chọn lookback theo timeframe
                let lookback = 20;
                if (timeframe === '3m' || timeframe === '5m' || timeframe === '15m') lookback = 50;
                else if (timeframe === '1h') lookback = 30;
                else if (timeframe === '4h') lookback = 20;


                const zones = getSupportResistanceZones(candles, lookback * 2, 3);
                // Hàm kiểm tra giá có gần vùng hỗ trợ/kháng cự không
                function nearZone(price, zones, threshold = 0.002) {
                    return zones.some(z => Math.abs(price - z) / z < threshold);
                }

                const ema20 = calculateEMA(closes, 20).pop();
                const ema50 = calculateEMA(closes, 50).pop();
                const ema200 = calculateEMA(closes, 200).pop();
                const rsiArr = calculateRSI(closes);
                const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;
                const macdArr = calculateMACD(closes);
                const macd = macdArr.length > 0 ? macdArr[macdArr.length - 1] : null;

                // === Hàm kiểm tra divergence đảo chiều trên RSI hoặc MACD ===
                function hasBullishDivergence() {
                    // Giá tạo đáy thấp hơn, RSI/MACD tạo đáy cao hơn
                    if (closes.length < 20 || rsiArr.length < 20 || macdArr.length < 20) return false;
                    const priceLow1 = Math.min(...closes.slice(-20, -10));
                    const priceLow2 = Math.min(...closes.slice(-10));
                    const rsiLow1 = Math.min(...rsiArr.slice(-20, -10));
                    const rsiLow2 = Math.min(...rsiArr.slice(-10));
                    const macdLow1 = Math.min(...macdArr.slice(-20, -10).map(m => m.MACD));
                    const macdLow2 = Math.min(...macdArr.slice(-10).map(m => m.MACD));
                    return (priceLow2 < priceLow1 && (rsiLow2 > rsiLow1 || macdLow2 > macdLow1));
                }
                function hasBearishDivergence() {
                    // Giá tạo đỉnh cao hơn, RSI/MACD tạo đỉnh thấp hơn
                    if (closes.length < 20 || rsiArr.length < 20 || macdArr.length < 20) return false;
                    const priceHigh1 = Math.max(...closes.slice(-20, -10));
                    const priceHigh2 = Math.max(...closes.slice(-10));
                    const rsiHigh1 = Math.max(...rsiArr.slice(-20, -10));
                    const rsiHigh2 = Math.max(...rsiArr.slice(-10));
                    const macdHigh1 = Math.max(...macdArr.slice(-20, -10).map(m => m.MACD));
                    const macdHigh2 = Math.max(...macdArr.slice(-10).map(m => m.MACD));
                    return (priceHigh2 > priceHigh1 && (rsiHigh2 < rsiHigh1 || macdHigh2 < macdHigh1));
                }

                // Hàm kiểm tra khoảng cách tới EMA50/200 < 10%
                function nearEMA(close, ema) {
                    return Math.abs(close - ema) / ema < 0.1;
                }

                const prev = candles[candles.length - 2];
                const curr = candles[candles.length - 1];

                const opts = { minBodyPct: 0.22, partialEngulfPct: 0.55, requireVolume: false };

                // const bullish = isBullishEngulfingLoose(prev, curr, opts) || isPinBar(curr, 'bull') || isStrongBullish(prev, curr);
                // const bearish = isBearishEngulfingLoose(prev, curr, opts) || isPinBar(curr, 'bear') || isStrongBearish(prev, curr);

                const bullish = isBullishEngulfingLoose(prev, curr, opts) || isStrongBullish(prev, curr, opts);
                const bearish = isBearishEngulfingLoose(prev, curr, opts) || isStrongBearish(prev, curr, opts);

                // Chọn số nến cho detectTrendline theo timeframe
                let trendlineLen = 30;
                if (timeframe === '5m' || timeframe === '15m' || timeframe === '30m') trendlineLen = 100;
                else if (timeframe === '1h') trendlineLen = 80;
                else if (timeframe === '4h') trendlineLen = 60;
                const trendSlope = detectTrendline(closes, trendlineLen);
                const isTrendUp = trendSlope > 0;
                const isTrendDown = trendSlope < 0;

                console.log(`\n${symbol} ${timeframe} | EMA20: ${ema20.toFixed(2)} | EMA50: ${ema50.toFixed(2)} | EMA200: ${ema200.toFixed(2)} | RSI: ${rsi.toFixed(2)}`);
                console.log(`Bullish pattern: ${bullish}, Bearish pattern: ${bearish}`);
                console.log(`Trend slope: ${trendSlope.toFixed(6)} (${isTrendUp ? 'Uptrend' : isTrendDown ? 'Downtrend' : 'Sideways'})`);
                console.log(`Support zones: ${zones.supports.map(z => z.toFixed(2)).join(', ')}`);
                console.log(`Resistance zones: ${zones.resistances.map(z => z.toFixed(2)).join(', ')}`);
                console.log(`Current price: ${curr.close.toFixed(6)}`);
                console.log(`Near support: ${nearZone(curr.low, zones.supports)}`);
                console.log(`Near resistance: ${nearZone(curr.high, zones.resistances)}`);

                const { swingHigh, swingLow } = findSwingHighLow(candles, lookback);
                const { fiboMin, fiboMax } = getFiboZone(swingHigh, swingLow, true);


                // === Điều kiện LONG: EMA trend + Fibo pullback + confluence + nến xác nhận ===
                // === LONG thuận trend + Fibo ===
                if (
                    ema20 > ema50 &&
                    ema50 > ema200 &&
                    rsi > 30 &&
                    rsi < 50 &&
                    isTrendUp &&
                    nearZone(curr.low, zones.supports)
                ) {
                    // 1. Xác định swing và vùng Fibo

                    // 2. Kiểm tra giá hồi về vùng Fibo
                    const inFiboZone = curr.low <= fiboMax && curr.high >= fiboMin;
                    // 3. EMA50 nằm trong hoặc gần vùng Fibo (confluence, cho phép lệch 0.3%)
                    const fiboZone = [fiboMin, fiboMax];
                    const ema50InFibo = (ema50 >= fiboMin && ema50 <= fiboMax) ||
                        (ema50 < fiboMin && Math.abs(ema50 - fiboMin) / fiboMin < 0.003) ||
                        (ema50 > fiboMax && Math.abs(ema50 - fiboMax) / fiboMax < 0.003);
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
                                `🚀 *LONG EMA + Fibo Signal*\n` +
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

                // === BẮT ĐỈNH: Short tại swing high với nến đảo chiều, RSI cao, divergence và không quá xa EMA (độc lập) ===
                if (
                    curr.high >= swingHigh * 0.998 &&
                    (isPinBar(curr, 'bear') || isBearishEngulfingLoose(prev, curr) || isStrongBearish(prev, curr)) &&
                    rsi > 70 &&
                    hasBearishDivergence() &&
                    (nearEMA(curr.close, ema50) || nearEMA(curr.close, ema200))
                ) {
                    const entry = curr.close;
                    let sl;
                    if (timeframe === '4h') {
                        sl = swingHigh * 1.003; // SL ngoài swing high 0.3%
                    } else if (timeframe === '1h') {
                        sl = swingHigh * 1.0025; // SL ngoài swing high 0.25%
                    } else if (timeframe === '30m') {
                        sl = swingHigh * 1.0015; // SL ngoài swing high 0.15%
                    } else {
                        sl = swingHigh * 1.0015;
                    }
                    const risk = sl - entry;
                    const tp1 = entry - risk * 1;
                    const tp2 = entry - risk * 1.5;
                    const tp3 = entry - risk * 2;
                    console.log(`🔻 SHORT ĐỈNH cho ${symbol} tại ${timeframe}`);
                    const signalKey = `${symbol}_${timeframe}_SHORT_TOP`;
                    const now = Date.now();
                    if (!sentSignals.has(signalKey) || now - sentSignals.get(signalKey) > SIGNAL_COOLDOWN_MS) {
                        await sendMessage(
                            `🔻 *SHORT ĐỈNH*\n` +
                            `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
                            `*Entry:* ${entry.toFixed(5)}\n` +
                            `*Stop Loss:* ${sl.toFixed(5)}\n` +
                            `*TP1:* ${tp1.toFixed(5)}\n*TP2:* ${tp2.toFixed(5)}\n*TP3:* ${tp3.toFixed(5)}\n\n` +
                            `RSI=${rsi.toFixed(2)}\nSwing High: ${swingHigh.toFixed(2)}\nDivergence: Bearish\nNear EMA: ${(nearEMA(curr.close, ema50) ? 'EMA50' : 'EMA200')}`
                        );
                        sentSignals.set(signalKey, now);
                    } else {
                        console.log(`SHORT ĐỈNH cho ${symbol} tại ${timeframe} đã gửi trong 15 phút qua, bỏ qua.`);
                    }
                }

                // === BẮT ĐÁY: Long tại swing low với nến đảo chiều, RSI thấp, divergence và không quá xa EMA (độc lập) ===
                if (
                    curr.low <= swingLow * 1.002 &&
                    (isPinBar(curr, 'bull') || isBullishEngulfingLoose(prev, curr) || isStrongBullish(prev, curr)) &&
                    rsi < 30 &&
                    hasBullishDivergence() &&
                    (nearEMA(curr.close, ema50) || nearEMA(curr.close, ema200))
                ) {
                    const entry = curr.close;
                    let sl;
                    if (timeframe === '4h') {
                        sl = swingLow * 0.997; // SL ngoài swing low 0.3%
                    } else if (timeframe === '1h') {
                        sl = swingLow * 0.9975; // SL ngoài swing low 0.25%
                    } else if (timeframe === '30m') {
                        sl = swingLow * 0.9985; // SL ngoài swing low 0.15%
                    } else {
                        sl = swingLow * 0.9985;
                    }
                    const risk = entry - sl;
                    const tp1 = entry + risk * 1;
                    const tp2 = entry + risk * 1.5;
                    const tp3 = entry + risk * 2;
                    console.log(`🚀 LONG ĐÁY cho ${symbol} tại ${timeframe}`);
                    const signalKey = `${symbol}_${timeframe}_LONG_BOTTOM`;
                    const now = Date.now();
                    if (!sentSignals.has(signalKey) || now - sentSignals.get(signalKey) > SIGNAL_COOLDOWN_MS) {
                        await sendMessage(
                            `🚀 *LONG ĐÁY*\n` +
                            `Symbol: ${symbol}\nTimeframe: ${timeframe}\n\n` +
                            `*Entry:* ${entry.toFixed(5)}\n` +
                            `*Stop Loss:* ${sl.toFixed(5)}\n` +
                            `*TP1:* ${tp1.toFixed(5)}\n*TP2:* ${tp2.toFixed(5)}\n*TP3:* ${tp3.toFixed(5)}\n\n` +
                            `RSI=${rsi.toFixed(2)}\nSwing Low: ${swingLow.toFixed(2)}\nDivergence: Bullish\nNear EMA: ${(nearEMA(curr.close, ema50) ? 'EMA50' : 'EMA200')}`
                        );
                        sentSignals.set(signalKey, now);
                    } else {
                        console.log(`LONG ĐÁY cho ${symbol} tại ${timeframe} đã gửi trong 15 phút qua, bỏ qua.`);
                    }
                }

                // === Điều kiện SHORT: EMA trend + Fibo pullback + confluence + nến xác nhận ===
                if (
                    ema20 < ema50 &&
                    ema50 < ema200 &&
                    rsi > 50 &&
                    rsi < 100 &&
                    isTrendDown &&
                    nearZone(curr.high, zones.resistances)
                ) {
                    // 1. Xác định swing và vùng Fibo
                    const { swingHigh, swingLow } = findSwingHighLow(candles, lookback);
                    const { fiboMin, fiboMax } = getFiboZone(swingHigh, swingLow, false);
                    // 2. Kiểm tra giá hồi về vùng Fibo
                    const inFiboZone = curr.high >= fiboMin && curr.low <= fiboMax;
                    // 3. EMA50 nằm trong hoặc gần vùng Fibo (confluence, cho phép lệch 0.3%)
                    const fiboZone = [fiboMin, fiboMax];
                    const ema50InFibo = (ema50 >= fiboMin && ema50 <= fiboMax) ||
                        (ema50 < fiboMin && Math.abs(ema50 - fiboMin) / fiboMin < 0.003) ||
                        (ema50 > fiboMax && Math.abs(ema50 - fiboMax) / fiboMax < 0.003);
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
                                `🔻 *SHORT EMA + Fibo Signal*\n` +
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
