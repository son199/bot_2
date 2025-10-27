const { EMA, RSI, MACD } = require("technicalindicators");

function calculateEMA(values, period) {
    if (!values || values.length < period) return [];
    return EMA.calculate({ period, values });
}

function calculateRSI(values, period = 14) {
    if (!values || values.length < period) return [];
    return RSI.calculate({ values, period });
}

function calculateMACD(values) {
    if (!values || values.length < 26) return [];
    return MACD.calculate({
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        values,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
}

function isBullishEngulfing(prev, curr) {
    return prev.close < prev.open && curr.close > curr.open && curr.close > prev.open && curr.open < prev.close;
}

function isBearishEngulfing(prev, curr) {
    return prev.close > prev.open && curr.close < curr.open && curr.close < prev.open && curr.open > prev.close;
}

/**
 * Improved pattern detection helpers
 * - Uses thresholds so patterns are looser but still meaningful
 * - Optional volume check (pass undefined if you don't want to use volume)
 */

/**
 * percent helper
 */
const pct = (a, b) => Math.abs((a - b) / b);

/**
 * isBullishEngulfingLoose:
 * - Accepts full engulfing OR partial engulfing above a threshold
 * - Requires that current candle has a reasonably large body (not doji)
 * - Optional volume check: require curr.volume > prev.volume * volMul
 */
function isBullishEngulfingLoose(prev, curr, opts = {}) {
  const {
    minBodyPct = 0.4,       // thân nến ít nhất 40% range
    partialEngulfPct = 0.8, // phải bao phủ ít nhất 80% thân nến trước
    requireVolume = true,   // bật lọc khối lượng
    volMul = 1.2,           // volume lớn hơn ít nhất 20% so với nến trước
    emaNear = undefined,    // truyền ema nếu muốn lọc giá gần ema
    maxEmaDistance = 0.005, // giá cách ema < 0.5%
  } = opts;

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  const currRange = curr.high - curr.low || 1;
  const currBodyPct = currBody / currRange;

  // Thân quá nhỏ -> bỏ
  if (currBodyPct < minBodyPct) return false;

  // Volume check
  if (
    requireVolume &&
    curr.volume !== undefined &&
    prev.volume !== undefined &&
    curr.volume <= prev.volume * volMul
  )
    return false;

  // Giá gần EMA (nếu có)
  if (emaNear) {
    const dist = Math.abs(curr.close - emaNear) / emaNear;
    if (dist > maxEmaDistance) return false;
  }

  // Engulf mạnh: nến trước đỏ, nến hiện xanh và đóng cửa trên high trước
  const fullEngulf =
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.close >= prev.high && // đóng trên đỉnh nến trước
    curr.open <= prev.close; // mở thấp hơn hoặc bằng close trước

  if (fullEngulf) return true;

  // Bao phủ một phần thân nến trước (>=80%)
  const overlap =
    Math.min(curr.close, prev.open) - Math.max(curr.open, prev.close);
  if (prevBody > 0 && overlap / prevBody >= partialEngulfPct) {
    return curr.close > prev.close && curr.close > prev.high;
  }

  return false;
}

function isBearishEngulfingLoose(prev, curr, opts = {}) {
  const {
    minBodyPct = 0.4,
    partialEngulfPct = 0.8,
    requireVolume = true,
    volMul = 1.2,
    emaNear = undefined,
    maxEmaDistance = 0.005,
  } = opts;

  const prevBody = Math.abs(prev.close - prev.open);
  const currBody = Math.abs(curr.close - curr.open);
  const currRange = curr.high - curr.low || 1;
  const currBodyPct = currBody / currRange;

  if (currBodyPct < minBodyPct) return false;

  if (
    requireVolume &&
    curr.volume !== undefined &&
    prev.volume !== undefined &&
    curr.volume <= prev.volume * volMul
  )
    return false;

  if (emaNear) {
    const dist = Math.abs(curr.close - emaNear) / emaNear;
    if (dist > maxEmaDistance) return false;
  }

  const fullEngulf =
    prev.close > prev.open &&
    curr.close < curr.open &&
    curr.close <= prev.low && // đóng dưới đáy nến trước
    curr.open >= prev.close;

  if (fullEngulf) return true;

  const overlap =
    Math.min(prev.open, curr.open) - Math.max(prev.close, curr.close);
  if (prevBody > 0 && overlap / prevBody >= partialEngulfPct) {
    return curr.close < prev.close && curr.close < prev.low;
  }

  return false;
}


/**
 * Pinbar detection (tail-based)
 * - pin must have small body relative to range, and long tail on one side
 * - direction: 'bull' means long lower wick (bullish rejection)
 */
function isPinBar(c, direction = 'bull', opts = {}) {
    const {
        maxBodyRatio = 0.3, // body <= 30% of total range
        minTailRatio = 0.6  // tail >= 60% of total range
    } = opts;

    const body = Math.abs(c.close - c.open);
    const range = (c.high - c.low) || 1;
    const bodyRatio = body / range;

    if (bodyRatio > maxBodyRatio) return false;

    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    if (direction === 'bull') {
        return (lowerWick / range) >= minTailRatio;
    } else {
        return (upperWick / range) >= minTailRatio;
    }
}

/**
 * Strong bar helper: simple strong bullish / bearish candlestick
 */
function isStrongBullish(prev, curr, opts = {}) {
    const { minBodyPct = 0.35 } = opts;
    const currBody = Math.abs(curr.close - curr.open);
    const currRange = curr.high - curr.low || 1;
    const currBodyPct = currBody / currRange;
    return curr.close > curr.open && curr.close > prev.close && currBodyPct >= minBodyPct;
}
function isStrongBearish(prev, curr, opts = {}) {
    const { minBodyPct = 0.35 } = opts;
    const currBody = Math.abs(curr.close - curr.open);
    const currRange = curr.high - curr.low || 1;
    const currBodyPct = currBody / currRange;
    return curr.close < curr.open && curr.close < prev.close && currBodyPct >= minBodyPct;
}

function detectTrendline(closes, lookback = 20) {
  if (closes.length < lookback) return 0;

  const slice = closes.slice(-lookback);
  const highs = [];
  const lows = [];

  for (let i = 2; i < slice.length - 2; i++) {
    // đỉnh
    if (slice[i] > slice[i - 1] && slice[i] > slice[i + 1]) highs.push({ i, price: slice[i] });
    // đáy
    if (slice[i] < slice[i - 1] && slice[i] < slice[i + 1]) lows.push({ i, price: slice[i] });
  }

  if (lows.length >= 2) {
    const last = lows[lows.length - 1];
    const prev = lows[lows.length - 2];
    const slope = (last.price - prev.price) / (last.i - prev.i);
    return slope; // > 0 là uptrend
  }

  if (highs.length >= 2) {
    const last = highs[highs.length - 1];
    const prev = highs[highs.length - 2];
    const slope = (last.price - prev.price) / (last.i - prev.i);
    return slope; // < 0 là downtrend
  }

  return 0;
}



module.exports = {
    calculateEMA,
    calculateRSI,
    calculateMACD,
    isBullishEngulfing,
    isBearishEngulfing,
    isBullishEngulfingLoose,
    isBearishEngulfingLoose,
    isPinBar,
    isStrongBullish,
    isStrongBearish,
    detectTrendline
};
