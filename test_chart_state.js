const assert = require('assert');
const ChartState = require('./chart_state.js');

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    read(key) { return data.get(key); }
  };
}

function test(name, fn) {
  fn();
  console.log('  OK  ' + name);
}

console.log('\n[차트 설정 저장/복원]');

test('저장값이 없으면 기존 8분할 기본값을 사용한다', () => {
  const state = ChartState.load(fakeStorage());
  assert.strictEqual(state.layout, 8);
  assert.strictEqual(state.charts.length, 8);
  assert.strictEqual(state.charts[0].symbol, 'BTC/USDT');
});

test('차트별 코인과 시간봉을 저장하고 다시 복원한다', () => {
  const storage = fakeStorage();
  const state = ChartState.createDefaultState();
  state.charts[0] = { symbol: 'FET/USDT', timeframe: '4h' };
  state.charts[7] = { symbol: 'TAO/USDT', timeframe: '12h' };
  ChartState.save(storage, state);

  const restored = ChartState.load(storage);
  assert.deepStrictEqual(restored.charts[0], { symbol: 'FET/USDT', timeframe: '4h' });
  assert.deepStrictEqual(restored.charts[7], { symbol: 'TAO/USDT', timeframe: '12h' });
});

test('분할 수와 활성 차트를 저장한다', () => {
  const storage = fakeStorage();
  const state = ChartState.createDefaultState();
  state.layout = 4;
  state.activeChartIdx = 3;
  ChartState.save(storage, state);
  const restored = ChartState.load(storage);
  assert.strictEqual(restored.layout, 4);
  assert.strictEqual(restored.activeChartIdx, 3);
});

test('숨겨진 차트 위치도 8개 모두 보존한다', () => {
  const storage = fakeStorage();
  const state = ChartState.createDefaultState();
  state.layout = 4;
  state.charts[6] = { symbol: 'ZK/USDT', timeframe: '1d' };
  ChartState.save(storage, state);
  assert.deepStrictEqual(ChartState.load(storage).charts[6], { symbol: 'ZK/USDT', timeframe: '1d' });
});

test('손상된 JSON은 안전한 기본값으로 복구한다', () => {
  const storage = fakeStorage({ [ChartState.STORAGE_KEY]: '{broken-json' });
  assert.deepStrictEqual(ChartState.load(storage), ChartState.createDefaultState());
});

test('허용되지 않은 심볼·시간봉·분할 값은 기본값으로 복구한다', () => {
  const state = ChartState.normalizeState({
    layout: 3,
    activeChartIdx: 99,
    charts: [{ symbol: '<img src=x>', timeframe: '2h' }]
  });
  assert.strictEqual(state.layout, 8);
  assert.strictEqual(state.activeChartIdx, 0);
  assert.deepStrictEqual(state.charts[0], { symbol: 'BTC/USDT', timeframe: '1h' });
});

test('BTC처럼 기준 통화가 생략된 심볼에는 USDT를 붙인다', () => {
  assert.strictEqual(ChartState.normalizeSymbol('fet'), 'FET/USDT');
});

console.log('\n총 7개 검증 통과');
