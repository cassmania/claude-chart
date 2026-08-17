/** market_analyzer.js 단위 검증 — 실행: node test_market_analyzer.js */
const assert = require('assert');
const MarketAnalyzer = require('./market_analyzer.js');

let 통과 = 0;
function 검증(이름, fn) {
  try { fn(); 통과++; console.log(`  OK  ${이름}`); }
  catch (e) { console.error(`  FAIL ${이름}\n       ${e.message}`); process.exitCode = 1; }
}

function 캔들(n, 방향 = 1, 시작 = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const center = 시작 + 방향 * i * 0.7 + Math.sin(i / 3) * 1.5;
    out.push({
      time: 1700000000 + i * 3600,
      open: center - 방향 * 0.2,
      high: center + 1,
      low: center - 1,
      close: center + 방향 * 0.2,
      volume: 100 + i
    });
  }
  return out;
}

console.log('\n[1] 확정 봉과 입력 방어');

검증('기본값은 마지막 진행 중 봉을 제외한다', () => {
  const data = 캔들(50);
  assert.strictEqual(MarketAnalyzer.confirmedCandles(data).length, 49);
});

검증('테스트 옵션으로 마지막 봉을 포함할 수 있다', () => {
  const data = 캔들(50);
  assert.strictEqual(MarketAnalyzer.confirmedCandles(data, { excludeLast: false }).length, 50);
});

검증('40개 미만 확정 봉은 분석하지 않는다', () => {
  const result = MarketAnalyzer.analyzeTimeframe(캔들(39), { excludeLast: false });
  assert.ok(result.error);
});

console.log('\n[2] Wilder 지표');

검증('단조 상승 RSI는 90 이상이다', () => {
  const values = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert.ok(MarketAnalyzer.rsi(values, 14) > 90);
});

검증('상승 추세에서 +DI가 -DI보다 높다', () => {
  const result = MarketAnalyzer.adx(캔들(100, 1), 14);
  assert.ok(result && result.plusDI > result.minusDI);
  assert.ok(result.adx >= 0 && result.adx <= 100);
});

검증('하락 추세에서 -DI가 +DI보다 높다', () => {
  const result = MarketAnalyzer.adx(캔들(100, -1, 200), 14);
  assert.ok(result && result.minusDI > result.plusDI);
});

검증('SuperTrend는 확정 봉의 방향과 밴드값을 반환한다', () => {
  const up = MarketAnalyzer.supertrend(캔들(100, 1), 10, 3);
  const down = MarketAnalyzer.supertrend(캔들(100, -1, 200), 10, 3);
  assert.strictEqual(up.direction, '상승');
  assert.strictEqual(down.direction, '하락');
  assert.ok(Number.isFinite(up.value) && Number.isFinite(down.value));
});

console.log('\n[3] 시장 구조와 FVG');

검증('좌우 5봉의 명확한 고점을 확인 스윙으로 잡는다', () => {
  const data = 캔들(30, 0);
  data[15].high = 150;
  const result = MarketAnalyzer.swings(data, 5);
  assert.ok(result.highs.some(x => x.index === 15));
});

검증('상승 FVG를 가격 범위와 함께 찾는다', () => {
  const data = 캔들(45, 0);
  data[40] = { time: 40, open: 100, high: 101, low: 99, close: 100, volume: 100 };
  data[41] = { time: 41, open: 101, high: 108, low: 100, close: 107, volume: 500 };
  data[42] = { time: 42, open: 108, high: 110, low: 105, close: 109, volume: 300 };
  data[43] = { time: 43, open: 108, high: 110, low: 104, close: 108, volume: 200 };
  data[44] = { time: 44, open: 108, high: 109, low: 103, close: 107, volume: 200 };
  const gaps = MarketAnalyzer.fvg(data);
  assert.ok(gaps.some(x => x.type === '상승 FVG' && x.low === 101 && x.high === 105));
});

console.log('\n[4] 시간봉 통합과 시나리오');

검증('상승 데이터는 강세로 판정한다', () => {
  const result = MarketAnalyzer.analyzeTimeframe(캔들(250, 1), { excludeLast: false });
  assert.strictEqual(result.direction, '강세');
  assert.ok(result.ma.sma200 !== null);
  assert.ok(result.lastConfirmed);
});

검증('하락 데이터는 약세로 판정한다', () => {
  const result = MarketAnalyzer.analyzeTimeframe(캔들(250, -1, 400), { excludeLast: false });
  assert.strictEqual(result.direction, '약세');
});

검증('4개 시간봉 중 3개 강세면 강세 우세다', () => {
  const pack = {
    '1h': 캔들(250, 1), '4h': 캔들(250, 1),
    '12h': 캔들(250, 1), '1d': 캔들(250, -1, 400)
  };
  const levels = {
    resistance: [{ price: 180 }, { price: 200 }],
    support: [{ price: 160 }, { price: 140 }],
    천장: { price: 220 }, 마지노선: { price: 120 }
  };
  const result = MarketAnalyzer.analyze(pack, levels, 170);
  assert.strictEqual(result.bias, '강세 우세');
  assert.ok(result.scenarios.long && result.scenarios.short);
  assert.ok(result.scenarios.long.rr > 0);
});

검증('레벨이 없으면 관망 사유를 반환한다', () => {
  const result = MarketAnalyzer.analyze({ '1h': 캔들(100) }, { error: '없음' }, 150);
  assert.ok(result.scenarios.wait.includes('관망'));
});

검증('BTC는 비용 반영 검증 미통과로 전망을 관망 처리한다', () => {
  const pack = {
    '1h': 캔들(250, 1), '4h': 캔들(250, 1),
    '12h': 캔들(250, 1), '1d': 캔들(250, 1)
  };
  const levels = {
    resistance: [{ price: 300 }, { price: 320 }],
    support: [{ price: 260 }, { price: 240 }]
  };
  const result = MarketAnalyzer.analyze(pack, levels, 280, { symbol: 'BTCUSDT' });
  assert.strictEqual(result.trendState, '강세 우세');
  assert.strictEqual(result.prediction.status, '관망');
  assert.strictEqual(result.prediction.actionable, false);
  assert.ok(result.prediction.reason.includes('기대값이 음수'));
});

검증('미검증 종목은 백테스트 승률을 일반화하지 않는다', () => {
  const pack = { '1h': 캔들(250, 1), '4h': 캔들(250, 1), '12h': 캔들(250, 1), '1d': 캔들(250, 1) };
  const result = MarketAnalyzer.analyze(pack, { error: '레벨 없음' }, 280, { symbol: 'ETHUSDT' });
  assert.strictEqual(result.prediction.status, '관망');
  assert.strictEqual(result.prediction.calibration, null);
});

console.log(`\n총 ${통과}개 검증 통과${process.exitCode ? ' (실패 있음)' : ''}\n`);
