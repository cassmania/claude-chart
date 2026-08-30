import assert from 'node:assert/strict';
import { 거래비용, 비용차감수익률 } from './backtest/costs.mjs';

// 진입 100, 청산 105이면 양쪽 0.06% 비용은 0.123입니다.
assert.ok(Math.abs(거래비용(100, 105) - 0.123) < 1e-12);
assert.ok(Math.abs(비용차감수익률(100, 105, 1) - 0.04877) < 1e-12);

// 숏도 가격 방향만 반대로 계산하고 양쪽 명목가 비용은 동일하게 차감합니다.
assert.ok(Math.abs(비용차감수익률(100, 95, -1) - 0.04883) < 1e-12);
assert.strictEqual(거래비용(0, 100), null);

console.log('백테스트 양방향 비용 계산 테스트 통과');
