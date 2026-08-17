/**
 * market_analyzer.js — 코인분석스킬 3.2 핵심 판정 엔진
 *
 * 브라우저에서 받은 OHLCV만 사용하며, 마지막 진행 중 봉은 기본적으로 제외한다.
 * 계산할 수 없는 값은 null로 남겨 화면에서 "현재 실시간 데이터 확인 불가"로 표시한다.
 */
(function (global) {
  "use strict";

  /**
   * 2021-08-17~2026-08-17 BTC 교차 거래소 워크포워드 검증 결과.
   * 방향 적중률은 개선됐지만 비용 반영 기대값이 음수여서 매매 신호로 채택하지 않았다.
   */
  var CALIBRATION = {
    version: "BTC-5Y-20260817",
    asset: "BTC",
    horizon: "12h",
    binanceTestAccuracyPct: 56.37,
    binanceTestWilson95Pct: [50.84, 61.75],
    mexcAllAccuracyPct: 53.02,
    mexcAllWilson95Pct: [50.54, 55.50],
    binanceNetExpectancyPct: -0.103,
    mexcNetExpectancyPct: -0.226,
    actionable: false
  };

  function 숫자(v) { return typeof v === "number" && isFinite(v); }

  function 정규화(candles) {
    if (!Array.isArray(candles)) return [];
    return candles.map(function (c) {
      if (!c) return null;
      var open = +(c.open !== undefined ? c.open : c.o);
      var high = +(c.high !== undefined ? c.high : c.h);
      var low = +(c.low !== undefined ? c.low : c.l);
      var close = +(c.close !== undefined ? c.close : c.c);
      var volume = +(c.volume !== undefined ? c.volume : c.v);
      var time = +(c.time !== undefined ? c.time : c.t);
      if (![open, high, low, close].every(숫자) || high <= 0 || low <= 0 || close <= 0) return null;
      if (!숫자(volume) || volume < 0) volume = 0;
      if (!숫자(time)) time = null;
      return { time: time, open: open, high: high, low: low, close: close, volume: volume };
    }).filter(Boolean);
  }

  /** REST kline의 마지막 항목은 진행 중 봉이므로 기본 제외한다. */
  function 확정봉(candles, opt) {
    var out = 정규화(candles);
    if ((!opt || opt.excludeLast !== false) && out.length) out = out.slice(0, -1);
    return out;
  }

  function sma(values, period) {
    if (values.length < period) return null;
    var part = values.slice(-period);
    return part.reduce(function (a, b) { return a + b; }, 0) / period;
  }

  function ema전체(values, period) {
    if (!values.length) return [];
    var k = 2 / (period + 1), out = [values[0]];
    for (var i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
    return out;
  }

  /** Wilder RSI(14). */
  function rsi(values, period) {
    period = period || 14;
    if (values.length <= period) return null;
    var gain = 0, loss = 0, i;
    for (i = 1; i <= period; i++) {
      var diff = values[i] - values[i - 1];
      if (diff > 0) gain += diff; else loss -= diff;
    }
    gain /= period; loss /= period;
    for (i = period + 1; i < values.length; i++) {
      var d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  }

  /** Wilder ADX(14), +DI, -DI. ADX는 방향이 아니라 추세 강도다. */
  function adx(candles, period) {
    period = period || 14;
    if (candles.length < period * 2 + 1) return null;
    var tr = [], plus = [], minus = [];
    for (var i = 1; i < candles.length; i++) {
      var cur = candles[i], prev = candles[i - 1];
      tr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
      var up = cur.high - prev.high, down = prev.low - cur.low;
      plus.push(up > down && up > 0 ? up : 0);
      minus.push(down > up && down > 0 ? down : 0);
    }
    var smTr = tr.slice(0, period).reduce(function (a, b) { return a + b; }, 0);
    var smPlus = plus.slice(0, period).reduce(function (a, b) { return a + b; }, 0);
    var smMinus = minus.slice(0, period).reduce(function (a, b) { return a + b; }, 0);
    var dx = [], plusDi = 0, minusDi = 0;
    for (i = period - 1; i < tr.length; i++) {
      if (i >= period) {
        smTr = smTr - smTr / period + tr[i];
        smPlus = smPlus - smPlus / period + plus[i];
        smMinus = smMinus - smMinus / period + minus[i];
      }
      plusDi = smTr ? 100 * smPlus / smTr : 0;
      minusDi = smTr ? 100 * smMinus / smTr : 0;
      var sum = plusDi + minusDi;
      dx.push(sum ? 100 * Math.abs(plusDi - minusDi) / sum : 0);
    }
    if (dx.length < period) return null;
    var value = dx.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period;
    for (i = period; i < dx.length; i++) value = (value * (period - 1) + dx[i]) / period;
    return { adx: value, plusDI: plusDi, minusDI: minusDi };
  }

  function macd(values) {
    if (values.length < 35) return null;
    var fast = ema전체(values, 12), slow = ema전체(values, 26);
    var line = fast.map(function (v, i) { return v - slow[i]; });
    var signal = ema전체(line, 9);
    var i = values.length - 1;
    return { line: line[i], signal: signal[i], hist: line[i] - signal[i] };
  }

  /** SuperTrend 기본값 ATR(10), 배수 3. 확정 봉에서만 방향을 판정한다. */
  function supertrend(candles, period, multiplier) {
    period = period || 10;
    multiplier = multiplier || 3;
    if (candles.length < period + 2) return null;
    var trs = [], atrs = [], i;
    for (i = 0; i < candles.length; i++) {
      var prevClose = i ? candles[i - 1].close : candles[i].close;
      trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose)));
      if (i === period - 1) atrs[i] = trs.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period;
      else if (i >= period) atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
      else atrs[i] = null;
    }
    var finalUpper = null, finalLower = null, line = null;
    for (i = period - 1; i < candles.length; i++) {
      var mid = (candles[i].high + candles[i].low) / 2;
      var basicUpper = mid + multiplier * atrs[i];
      var basicLower = mid - multiplier * atrs[i];
      var previousUpper = finalUpper, previousLower = finalLower, previousLine = line;
      if (i === period - 1) {
        finalUpper = basicUpper; finalLower = basicLower;
        line = candles[i].close <= finalUpper ? finalUpper : finalLower;
        continue;
      }
      finalUpper = basicUpper < previousUpper || candles[i - 1].close > previousUpper ? basicUpper : previousUpper;
      finalLower = basicLower > previousLower || candles[i - 1].close < previousLower ? basicLower : previousLower;
      if (previousLine === previousUpper) line = candles[i].close <= finalUpper ? finalUpper : finalLower;
      else line = candles[i].close >= finalLower ? finalLower : finalUpper;
    }
    return { value: line, direction: candles[candles.length - 1].close >= line ? "상승" : "하락" };
  }

  /** 좌우 5개 확정 봉보다 높은/낮은 봉만 확인 스윙으로 인정한다. */
  function 스윙(candles, side) {
    side = side || 5;
    var highs = [], lows = [];
    for (var i = side; i < candles.length - side; i++) {
      var hi = true, lo = true;
      for (var j = i - side; j <= i + side; j++) {
        if (j === i) continue;
        if (candles[i].high <= candles[j].high) hi = false;
        if (candles[i].low >= candles[j].low) lo = false;
      }
      if (hi) highs.push({ index: i, time: candles[i].time, price: candles[i].high });
      if (lo) lows.push({ index: i, time: candles[i].time, price: candles[i].low });
    }
    return { highs: highs, lows: lows };
  }

  function 구조(candles, pivots) {
    var hs = pivots.highs, ls = pivots.lows, close = candles[candles.length - 1].close;
    var lastH = hs.length ? hs[hs.length - 1] : null;
    var lastL = ls.length ? ls[ls.length - 1] : null;
    var trend = "중립";
    if (hs.length >= 2 && ls.length >= 2) {
      var hh = hs[hs.length - 1].price > hs[hs.length - 2].price;
      var hl = ls[ls.length - 1].price > ls[ls.length - 2].price;
      var lh = hs[hs.length - 1].price < hs[hs.length - 2].price;
      var ll = ls[ls.length - 1].price < ls[ls.length - 2].price;
      if (hh && hl) trend = "상승";
      else if (lh && ll) trend = "하락";
    }
    var event = "구조 돌파 없음";
    if (lastH && close > lastH.price) event = trend === "하락" ? "상승 CHoCH 후보" : "상승 BOS";
    else if (lastL && close < lastL.price) event = trend === "상승" ? "하락 CHoCH 후보" : "하락 BOS";

    var recent = candles.slice(-3), sweep = null;
    recent.forEach(function (c) {
      if (lastH && c.high > lastH.price && c.close < lastH.price) sweep = "상단 유동성 스윕";
      if (lastL && c.low < lastL.price && c.close > lastL.price) sweep = "하단 유동성 스윕";
    });
    return { trend: trend, event: event, sweep: sweep, lastHigh: lastH, lastLow: lastL };
  }

  /** 아직 완전히 메워지지 않은 최근 FVG를 최대 3개 반환한다. */
  function fvg(candles) {
    var out = [];
    for (var i = 2; i < candles.length; i++) {
      var first = candles[i - 2], third = candles[i];
      if (third.low > first.high) {
        var bullFilled = candles.slice(i + 1).some(function (c) { return c.low <= first.high; });
        if (!bullFilled) out.push({ type: "상승 FVG", low: first.high, high: third.low, time: third.time });
      }
      if (third.high < first.low) {
        var bearFilled = candles.slice(i + 1).some(function (c) { return c.high >= first.low; });
        if (!bearFilled) out.push({ type: "하락 FVG", low: third.high, high: first.low, time: third.time });
      }
    }
    return out.slice(-3);
  }

  function 단일분석(candles, opt) {
    var data = 확정봉(candles, opt);
    if (data.length < 40) return { error: "확정 봉이 40개 미만입니다.", bars: data.length };
    var closes = data.map(function (c) { return c.close; });
    var last = data[data.length - 1], a = adx(data, 14), m = macd(closes), st = supertrend(data, 10, 3), pivots = 스윙(data, 5);
    var ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    var vol20 = data.slice(-21, -1).reduce(function (sum, c) { return sum + c.volume; }, 0) / 20;
    var score = 0;
    if (ma20 !== null) score += last.close > ma20 ? 1 : -1;
    if (ma50 !== null) score += last.close > ma50 ? 1 : -1;
    if (ma20 !== null && ma50 !== null) score += ma20 > ma50 ? 1 : -1;
    if (a) score += a.plusDI > a.minusDI ? 1 : -1;
    if (m) score += m.hist > 0 ? 1 : -1;
    if (st) score += st.direction === "상승" ? 1 : -1;
    var direction = score >= 3 ? "강세" : score <= -3 ? "약세" : "중립";
    return {
      bars: data.length,
      lastConfirmed: last.time,
      close: last.close,
      direction: direction,
      score: score,
      adx: a,
      rsi: rsi(closes, 14),
      macd: m,
      supertrend: st,
      ma: { sma20: ma20, sma50: ma50, sma200: ma200 },
      structure: 구조(data, pivots),
      fvg: fvg(data),
      volume: { last: last.volume, avg20: vol20, ratio: vol20 ? last.volume / vol20 : null }
    };
  }

  function rr(entry, stop, target) {
    var risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
    return risk > 0 ? reward / risk : null;
  }

  /** 매물대 엔진의 결과를 재사용해 조건부 양방향 시나리오를 만든다. */
  function 시나리오(levels, price) {
    if (!levels || levels.error) return { wait: "핵심 레벨을 계산할 수 없어 관망" };
    var r1 = levels.resistance[0], r2 = levels.resistance[1];
    var s1 = levels.support[0], s2 = levels.support[1];
    var long = r1 && s1 ? {
      trigger: r1.price,
      entry: r1.price,
      stop: s1.price,
      target: r2 ? r2.price : levels.천장 && levels.천장.price,
      invalidation: "돌파 후 다시 직하 지지 아래로 확정 봉 마감"
    } : null;
    var short = s1 && r1 ? {
      trigger: s1.price,
      entry: s1.price,
      stop: r1.price,
      target: s2 ? s2.price : levels.마지노선 && levels.마지노선.price,
      invalidation: "이탈 후 다시 직상 저항 위로 확정 봉 마감"
    } : null;
    if (long && 숫자(long.target)) long.rr = rr(long.entry, long.stop, long.target);
    if (short && 숫자(short.target)) short.rr = rr(short.entry, short.stop, short.target);
    return { price: price, long: long, short: short, wait: "발동 조건 전에는 관망" };
  }

  function 종합(tfCandles, levels, price, opt) {
    opt = opt || {};
    var order = ["1d", "12h", "4h", "1h"], frames = {};
    order.forEach(function (tf) {
      if (tfCandles && tfCandles[tf]) frames[tf] = 단일분석(tfCandles[tf]);
    });
    var valid = Object.keys(frames).map(function (tf) { return frames[tf]; }).filter(function (x) { return !x.error; });
    var bull = valid.filter(function (x) { return x.direction === "강세"; }).length;
    var bear = valid.filter(function (x) { return x.direction === "약세"; }).length;
    var bias = bull >= 3 ? "강세 우세" : bear >= 3 ? "약세 우세" : "상하위 봉 혼조";
    var symbol = String(opt.symbol || "").replace("/", "").toUpperCase();
    var isBtc = symbol === "BTCUSDT" || symbol === "BTC_USDT" || symbol === "BTC";
    var prediction = isBtc ? {
      status: "관망",
      actionable: false,
      horizon: "12H",
      reason: "5년 교차 검증에서 방향 적중률은 개선됐지만 수수료·슬리피지 반영 기대값이 음수여서 매매 전망으로 채택하지 않음",
      calibration: CALIBRATION
    } : {
      status: "관망",
      actionable: false,
      horizon: null,
      reason: "이 종목에 대한 분리된 워크포워드·거래비용 검증이 없어 방향 전망을 만들지 않음",
      calibration: null
    };
    return {
      frames: frames,
      bias: bias,
      trendState: bias,
      prediction: prediction,
      scenarios: 시나리오(levels, price)
    };
  }

  global.MarketAnalyzer = {
    VERSION: "3.2.0",
    CALIBRATION: CALIBRATION,
    confirmedCandles: 확정봉,
    rsi: rsi,
    adx: adx,
    supertrend: supertrend,
    swings: 스윙,
    fvg: fvg,
    analyzeTimeframe: 단일분석,
    analyze: 종합
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.MarketAnalyzer;
})(typeof window !== "undefined" ? window : globalThis);
