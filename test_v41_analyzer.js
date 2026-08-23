const assert = require('assert');
global.MarketAnalyzer = require('./market_analyzer.js');
const V41Analyzer = require('./v41_analyzer.js');

const candles = Array.from({length: 241}, (_, index) => {
  const close = 100 + index * 0.2 + Math.sin(index / 8);
  return {time: 1700000000 + index * 3600, open: close - 0.2, high: close + 1, low: close - 1, close, volume: 1000 + index};
});
const base = MarketAnalyzer.analyze({'4h': candles}, {error: 'test'}, candles.at(-1).close);
const result = V41Analyzer.enrich({'4h': candles}, base);

assert.strictEqual(result.version, '4.1.0');
assert.ok(Number.isFinite(result.frames['4h'].sma60));
assert.ok(Number.isFinite(result.frames['4h'].sma120));
assert.ok(Number.isFinite(result.frames['4h'].cci20));
assert.ok(Number.isFinite(result.frames['4h'].stochastic.k));
assert.ok(Number.isFinite(result.frames['4h'].stochastic.d));
assert.ok(Number.isFinite(result.frames['4h'].anchoredVwap));
assert.ok(result.frames['4h'].profile.poc > 0);
assert.ok(result.unavailable.includes('MVRV'));

console.log('V4.1 보강 분석기 테스트 통과');
