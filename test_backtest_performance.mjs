import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { 특징생성 } from './backtest/run_backtest.mjs';

const payload = JSON.parse(fs.readFileSync(new URL('./backtest_data/binance_BTCUSDT_1h_5y.json',import.meta.url),'utf8'));
// 약 375일로 충분한 일봉 준비 구간과 반복되는 상위 시간봉을 함께 검사한다.
payload.candles = payload.candles.slice(-9000);
const beforeStart = performance.now();
const uncached = 특징생성(payload,{cache:false,progress:false});
const beforeMs = performance.now()-beforeStart;
const afterStart = performance.now();
const cached = 특징생성(payload,{cache:true,progress:false});
const afterMs = performance.now()-afterStart;
assert.deepEqual(cached.records,uncached.records,'캐시는 신호·지표·미래 수익률을 변경하지 않아야 함');
// 검증 입력의 미래 부분을 잘라도 앞선 확정 시점의 결과가 같아야 한다.
const prefix = 특징생성({...payload,candles:payload.candles.slice(0,-96)},{progress:false});
assert.deepEqual(cached.records.slice(0,prefix.records.length),prefix.records);
console.log(JSON.stringify({records:cached.records.length,beforeMs,afterMs,reductionPct:100*(1-afterMs/beforeMs),parity:true}));
