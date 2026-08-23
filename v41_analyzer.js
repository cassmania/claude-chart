/**
 * v41_analyzer.js — 코인분석스킬 V4.1 보강 레이어
 * 기존 MarketAnalyzer의 시장구조 판정을 보존하고 V4.1 표시 지표만 확장한다.
 */
(function (global) {
  "use strict";

  function finite(value) { return typeof value === "number" && isFinite(value); }
  function sma(values, period) {
    if (values.length < period) return null;
    return values.slice(-period).reduce(function (sum, value) { return sum + value; }, 0) / period;
  }
  function confirmed(candles) {
    return global.MarketAnalyzer.confirmedCandles(candles || []);
  }
  function cci(candles, period) {
    period = period || 20;
    if (candles.length < period) return null;
    var typical = candles.map(function (c) { return (c.high + c.low + c.close) / 3; });
    var recent = typical.slice(-period);
    var average = sma(typical, period);
    var deviation = recent.reduce(function (sum, value) { return sum + Math.abs(value - average); }, 0) / period;
    return deviation ? (recent[recent.length - 1] - average) / (0.015 * deviation) : 0;
  }
  function stochastic(candles, period, smoothK, smoothD) {
    period = period || 14; smoothK = smoothK || 3; smoothD = smoothD || 3;
    if (candles.length < period + smoothK + smoothD - 2) return null;
    var raw = [];
    for (var i = period - 1; i < candles.length; i++) {
      var window = candles.slice(i - period + 1, i + 1);
      var high = Math.max.apply(null, window.map(function (c) { return c.high; }));
      var low = Math.min.apply(null, window.map(function (c) { return c.low; }));
      raw.push(high === low ? 50 : (candles[i].close - low) / (high - low) * 100);
    }
    var kSeries = [];
    for (i = smoothK - 1; i < raw.length; i++) kSeries.push(sma(raw.slice(0, i + 1), smoothK));
    return { k: kSeries[kSeries.length - 1], d: sma(kSeries, smoothD) };
  }
  function anchoredVwap(candles) {
    if (!candles.length) return null;
    var pv = 0, volume = 0;
    candles.forEach(function (c) {
      var typical = (c.high + c.low + c.close) / 3;
      pv += typical * c.volume; volume += c.volume;
    });
    return volume ? pv / volume : null;
  }
  function volumeProfile(candles, bins) {
    bins = bins || 40;
    if (candles.length < 20) return null;
    var low = Math.min.apply(null, candles.map(function (c) { return c.low; }));
    var high = Math.max.apply(null, candles.map(function (c) { return c.high; }));
    if (!(high > low)) return null;
    var step = (high - low) / bins, volumes = new Array(bins).fill(0), total = 0;
    candles.forEach(function (c) {
      var start = Math.max(0, Math.floor((c.low - low) / step));
      var end = Math.min(bins - 1, Math.floor((c.high - low) / step));
      var share = c.volume / Math.max(1, end - start + 1);
      for (var index = start; index <= end; index++) volumes[index] += share;
      total += c.volume;
    });
    if (!(total > 0)) return null;
    var order = volumes.map(function (_, index) { return index; }).sort(function (a, b) { return volumes[b] - volumes[a]; });
    var selected = [], accumulated = 0;
    for (var i = 0; i < order.length && accumulated < total * 0.7; i++) {
      selected.push(order[i]); accumulated += volumes[order[i]];
    }
    var pocIndex = order[0], min = Math.min.apply(null, selected), max = Math.max.apply(null, selected);
    return {
      poc: low + step * (pocIndex + 0.5),
      val: low + step * min,
      vah: low + step * (max + 1),
      method: "최근 180개 확정봉 OHLC 범위 균등분배 근사"
    };
  }
  function enrich(timeframes, baseResult) {
    var frames = {};
    Object.keys(timeframes || {}).forEach(function (timeframe) {
      var rows = confirmed(timeframes[timeframe]).slice(-250);
      var closes = rows.map(function (c) { return c.close; });
      frames[timeframe] = {
        sma20: sma(closes, 20), sma60: sma(closes, 60), sma120: sma(closes, 120), sma200: sma(closes, 200),
        cci20: cci(rows, 20), stochastic: stochastic(rows, 14, 3, 3),
        anchoredVwap: anchoredVwap(rows), profile: volumeProfile(rows.slice(-180), 40)
      };
    });
    return {
      version: "4.1.0",
      protocol: "PART 0~5 · 확정봉 · 근거/단위/가용성 우선",
      base: baseResult,
      frames: frames,
      unavailable: ["CVD", "청산맵", "거래소 순유입", "고래 지갑", "MVRV", "SOPR", "토큰 언락", "기관 동향", "프로젝트 뉴스"]
    };
  }

  global.V41Analyzer = { VERSION: "4.1.0", cci: cci, stochastic: stochastic, anchoredVwap: anchoredVwap, volumeProfile: volumeProfile, enrich: enrich };
  if (typeof module !== "undefined" && module.exports) module.exports = global.V41Analyzer;
})(typeof window !== "undefined" ? window : globalThis);
