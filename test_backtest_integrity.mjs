import assert from 'node:assert/strict';
import { 정확도, 구간, 전략, 고정12H전략 } from './backtest/run_backtest.mjs';

const H = 3600000;
const cfg = { scoreThreshold: 3, mtfAgree: 3 };
const record = (time, side, ret) => ({ time, rawIndex: time / H - 1, atr4h: 2 / 3,
  frames: Object.fromEntries(['1h','4h','12h','1d'].map(tf => [tf, {score: side * 4}])),
  forwardReturns: {'4h': ret, '12h': ret, '24h': ret} });

// TP=2, FN=1, FP=3, TN=4: 실제 상승·하락 재현율 평균과 예측별 적중률 평균이 다르다.
const sample = [...Array(2).fill(record(H,1,1)),record(H,-1,1),...Array(3).fill(record(H,1,-1)),...Array(4).fill(record(H,-1,-1))];
const metrics = 정확도(sample, cfg);
assert.ok(Math.abs(metrics.balancedAccuracy - (2/3+4/7)/2) < 1e-12, '균형 정확도는 예측 방향별 정밀도 평균이 아니다');
assert.equal(구간([record(H,1,1),record(20*H,1,1)],0,30*H).length,1,'최대 24H 평가가 경계를 넘으면 제외');

const raw = Array.from({length:30},(_,i)=>({time:i*H,endTime:(i+1)*H,open:100,high:100.5,low:99.5,close:100}));
const longGap = raw.map(x=>({...x}));
longGap[2] = {...longGap[2],open:95,high:96,low:94,close:95};
assert.equal(전략([record(H,1,1)],cfg,longGap,0).expectancyR,-5,'갭 손절은 불리한 시가를 적용');
const shortGap = raw.map(x=>({...x}));
shortGap[2] = {...shortGap[2],open:105,high:106,low:104,close:105};
assert.equal(전략([record(H,-1,-1)],cfg,shortGap,0).expectancyR,-5);
const missing = raw.filter((_,i)=>i!==5);
assert.equal(전략([record(H,1,1)],cfg,missing,0).trades,0,'누락된 미래 봉의 체결을 추정하지 않음');
assert.equal(고정12H전략([record(H,1,1)],cfg,missing,0).trades,0,'12번째 봉과 12시간을 혼동하지 않음');
const valid = 고정12H전략([record(H,1,1)],cfg,raw,0);
assert.equal(valid.trades,1);
console.log('백테스트 시간 경계·균형 정확도·갭 체결·누락 시간 테스트 통과');
