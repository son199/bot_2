// index5.js
// Logic CRT (Change of Range and Trend) Pattern Detection
// Phát hiện mô hình CRT chỉ cần 2 cây nến: Range Candle + Liquidity Sweep & Pinbar

const {
    calculateEMA,
    calculateRSI
} = require('./indicators');
const { sendMessage } = require('./telegram');
const ccxt = require('ccxt');

const SYMBOLS_LIMIT = 500;
const INTERVALS = ['15m', '30m', "1h", '4h'];

const exchange = new ccxt.binance({
    options: { defaultType: "future" },
});

// Hàm kiểm tra Pinbar (điều kiện nới lỏng)
function isPinbar(candle, direction, minTailRatio = 0.2) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;

    if (range === 0) return false;

    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    if (direction === 'bullish') {
        // Pinbar đuôi dưới: râu dưới chỉ cần > 20% toàn bộ nến (nới lỏng)
        return (lowerWick / range) >= minTailRatio;
    } else if (direction === 'bearish') {
        // Pinbar đuôi trên: râu trên chỉ cần > 20% toàn bộ nến (nới lỏng)
        return (upperWick / range) >= minTailRatio;
    }

    return false;
}

// Hàm tìm Swing High/Low trong khoảng lookback nến
function findSwingPoints(candles, lookback = 40) {
    if (candles.length < lookback) lookback = candles.length;
    const recentCandles = candles.slice(-lookback);
    
    const swingHigh = Math.max(...recentCandles.map(c => c.high));
    const swingLow = Math.min(...recentCandles.map(c => c.low));
    
    return { swingHigh, swingLow };
}

// Hàm tính Premium/Discount Zone
function getPremiumDiscountZone(currentPrice, swingHigh, swingLow) {
    const range = swingHigh - swingLow;
    if (range === 0) return 'EQUILIBRIUM';
    
    const pricePosition = (currentPrice - swingLow) / range;
    
    if (pricePosition >= 0.7) return 'PREMIUM';      // >70% = Premium Zone
    if (pricePosition <= 0.3) return 'DISCOUNT';     // <30% = Discount Zone  
    return 'EQUILIBRIUM';                             // 30-70% = Neutral Zone
}

// Hàm phát hiện CRT Pattern với Premium/Discount filter
function detectCRTPattern(candles) {
    if (candles.length < 2) return null;

    const rangeCandle = candles[candles.length - 2]; // Nến thứ 1 (Range Candle)
    const currentCandle = candles[candles.length - 1]; // Nến thứ 2 (Liquidity Sweep + Pinbar)

    const rangeHigh = rangeCandle.high;
    const rangeLow = rangeCandle.low;
    const rangeBody = rangeHigh - rangeLow;

    // Tìm Swing High/Low để xác định Premium/Discount Zone
    const { swingHigh, swingLow } = findSwingPoints(candles, 40);
    const currentZone = getPremiumDiscountZone(currentCandle.close, swingHigh, swingLow);
    
    console.log(`Swing: ${swingLow.toFixed(2)} - ${swingHigh.toFixed(2)}, Current: ${currentCandle.close.toFixed(2)}, Zone: ${currentZone}`);

    // Kiểm tra nến 2 chỉ được phép phủ tối đa 35% của nến 1
    const overlapHigh = Math.min(currentCandle.high, rangeHigh);
    const overlapLow = Math.max(currentCandle.low, rangeLow);
    const overlapRange = Math.max(0, overlapHigh - overlapLow);
    const overlapRatio = overlapRange / rangeBody;
    console.log('Overlap Ratio:', overlapRatio);

    if (overlapRatio > 0.35) {
        return null; // Nến 2 phủ quá 35% nến 1, không hợp lệ
    }

    // 🔵 TH1 – Sweep xuống (Buy Setup) - Chỉ trong DISCOUNT Zone
    if (currentCandle.low < rangeLow && // Nến 2 low phá xuống Range Low
        currentCandle.close > rangeLow && // Nến 2 đóng cửa trên Range Low
        isPinbar(currentCandle, 'bullish') && // Tạo Pinbar đuôi dưới
        currentZone === 'DISCOUNT') { // Chỉ trong Discount Zone

        return {
            type: 'BUY_SETUP',
            direction: 'BULLISH',
            rangeHigh: rangeHigh,
            rangeLow: rangeLow,
            sweepLow: currentCandle.low,
            closePrice: currentCandle.close,
            zone: currentZone,
            swingRange: `${swingLow.toFixed(2)} - ${swingHigh.toFixed(2)}`,
            message: 'Setup CRT xuất hiện (Sweep xuống trong Discount Zone) – chờ entry nến 3'
        };
    }

    // 🔴 TH2 – Sweep lên (Sell Setup) - Chỉ trong PREMIUM Zone
    if (currentCandle.high > rangeHigh && // Nến 2 high phá Range High
        currentCandle.close < rangeHigh && // Nến 2 đóng cửa dưới Range High
        isPinbar(currentCandle, 'bearish') && // Tạo Pinbar đuôi trên
        currentZone === 'PREMIUM') { // Chỉ trong Premium Zone

        return {
            type: 'SELL_SETUP',
            direction: 'BEARISH',
            rangeHigh: rangeHigh,
            rangeLow: rangeLow,
            sweepHigh: currentCandle.high,
            closePrice: currentCandle.close,
            zone: currentZone,
            swingRange: `${swingLow.toFixed(2)} - ${swingHigh.toFixed(2)}`,
            message: 'Setup CRT xuất hiện (Sweep lên trong Premium Zone) – chờ entry nến 3'
        };
    }

    return null;
}

// Hàm kiểm tra thời gian còn lại của nến hiện tại
function getTimeToNextCandle(timeframe) {
    const now = Date.now();
    let intervalMs;

    switch (timeframe) {
        case '15m': intervalMs = 15 * 60 * 1000; break;
        case '30m': intervalMs = 30 * 60 * 1000; break;
        case '1h': intervalMs = 60 * 60 * 1000; break;
        case '4h': intervalMs = 4 * 60 * 60 * 1000; break;
        default: intervalMs = 15 * 60 * 1000;
    }

    const timeToNext = intervalMs - (now % intervalMs);
    return timeToNext;
}

async function scanCRTSignals() {
    console.log(`[${new Date().toLocaleString()}] 🔍 Bắt đầu quét CRT Pattern...`);

    try {
        const markets = await exchange.loadMarkets();
        console.log(`Loaded ${Object.keys(markets).length} markets.`);
        const symbols = Object.keys(markets).filter(s => s.endsWith("/USDT")).slice(0, SYMBOLS_LIMIT);
        console.log(`Scanning ${symbols.length} symbols...`);
        for (const symbol of symbols) {
            console.log(`[${new Date().toLocaleString()}] Đang quét cặp: ${symbol}`);
            if (!markets[symbol]) {
                console.log(`[${new Date().toLocaleString()}] ⚠️ Cặp không tồn tại: ${symbol}, bỏ qua.`);
                continue;
            }

            for (const timeframe of INTERVALS) {
                console.log(`[${new Date().toLocaleString()}] Đang quét: ${symbol} - ${timeframe}`);
                // Kiểm tra thời gian còn lại của nến hiện tại
                const timeToNext = getTimeToNextCandle(timeframe);
                const minutesToNext = Math.floor(timeToNext / (60 * 1000));
                
                console.log(`[${new Date().toLocaleString()}] ${symbol} - ${timeframe}: Còn ${minutesToNext} phút đóng nến`);

                // Chỉ quét khi còn 2-5 phút nữa nến đóng
                if (minutesToNext < 2 || minutesToNext > 5) {
                    console.log(`[${new Date().toLocaleString()}] ⏭️ Bỏ qua ${symbol} - ${timeframe}: không trong khoảng 2-5p (còn ${minutesToNext}p)`);
                    continue;
                }

                console.log(`[${new Date().toLocaleString()}] ✅ Vào try block cho ${symbol} - ${timeframe} (còn ${minutesToNext}p)`);

                try {
                    // Lấy dữ liệu nến
                    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 50);
                    const candles = ohlcv.map(([t, o, h, l, c, v]) => ({
                        timestamp: t,
                        open: o,
                        high: h,
                        low: l,
                        close: c,
                        volume: v,
                        time: new Date(t).toLocaleString()
                    }));

                    // Phát hiện CRT Pattern
                    const crtPattern = detectCRTPattern(candles);

                    if (crtPattern) {
                        const logMsg = `
                        🚨 ${crtPattern.type} DETECTED - ${symbol} (${timeframe}) 🚨
                        📊 Pattern: ${crtPattern.direction}
                        📈 Range High: ${crtPattern.rangeHigh}
                        📉 Range Low: ${crtPattern.rangeLow}
                        ${crtPattern.type === 'BUY_SETUP' ? '🔻 Sweep Low: ' + crtPattern.sweepLow : '🔺 Sweep High: ' + crtPattern.sweepHigh}
                        💰 Close Price: ${crtPattern.closePrice}
                        🎯 Zone: ${crtPattern.zone}
                        📊 Swing Range: ${crtPattern.swingRange}
                        ⏰ Time: ${new Date().toLocaleString()}
                        📝 ${crtPattern.message}
                        `;

                        console.log(logMsg);

                        // Gửi thông báo Telegram
                        const telegramMsg = `🚨 CRT SETUP - ${symbol} (${timeframe}) 🚨\n\n` +
                            `${crtPattern.type === 'BUY_SETUP' ? '🔵' : '🔴'} ${crtPattern.direction} Setup\n` +
                            `📊 Range: ${crtPattern.rangeLow} - ${crtPattern.rangeHigh}\n` +
                            `🎯 Zone: ${crtPattern.zone}\n` +
                            `📊 Swing: ${crtPattern.swingRange}\n` +
                            `💰 Close: ${crtPattern.closePrice}\n` +
                            `⏰ ${new Date().toLocaleString()} (còn ${minutesToNext}p)\n\n` +
                            `📝 ${crtPattern.message}`;

                        await sendMessage(telegramMsg);
                    }

                } catch (error) {
                    console.log(`[${new Date().toLocaleString()}] ❌ Lỗi khi quét ${symbol} ${timeframe}: ${error.message}`);
                }
            }
        }

    } catch (error) {
        console.log(`[${new Date().toLocaleString()}] ❌ Lỗi khi tải thị trường: ${error.message}`);
    }

    console.log(`[${new Date().toLocaleString()}] ✅ Hoàn thành quét CRT Pattern`);
}

// Khởi động bot
(async () => {
    console.log('🚀 CRT Pattern Detection Bot Started...');
    console.log(`📊 Intervals: ${INTERVALS.join(', ')}`);
    console.log('🔍 Đang tìm kiếm CRT Pattern (Range + Liquidity Sweep + Pinbar)...\n');

    // Quét ngay lập tức
    await scanCRTSignals();

    // Quét lại mỗi 1 phút
    setInterval(scanCRTSignals, 60 * 1000);
})();
