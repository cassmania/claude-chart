/**
 * 코인분석스킬 3.1 BTC 5년 워크포워드 백테스트.
 *
 * 실행: node backtest/run_backtest.mjs
 * 선행: node backtest/fetch_btc_5y.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MarketAnalyzer = require('../market_analyzer.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backtest_data');
const RESULT_DIR = path.join(ROOT, 'backtest_results');
const HOUR = 60 * 60 * 1000;
const TF_MS = { '1h': HOUR, '4h': 4 * HOUR, '12h': 12 * HOUR, '1d': 24 * HOUR };

fs.mkdirSync(RESULT_DIR, { recursive: true });

function 로드(exchange) {
  const file = path.join(DATA_DIR, `${exchange}_BTCUSDT_1h_5y.json`);
  if (!fs.existsSync(file)) throw new Error(`${file} 없음. fetch_btc_5y.mjs를 먼저 실행하세요.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 누락이 하나라도 있는 상위 봉은 만들지 않는다. */
function 집계(raw, tf) {
  const period = TF_MS[tf];
  const expected = period / HOUR;
  const groups = new Map();
  for (const c of raw) {
    const bucket = Math.floor(c.time / period) * period;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(c);
  }
  const out = [];
  for (const [time, rows] of groups) {
    rows.sort((a, b) => a.time - b.time);
    let complete = rows.length === expected;
    for (let i = 1; complete && i < rows.length; i++) {
      if (rows[i].time - rows[i - 1].time !== HOUR) complete = false;
    }
    if (!complete || rows[0].time !== time || rows.at(-1).time !== time + period - HOUR) continue;
    out.push({
      time,
      endTime: time + period,
      open: rows[0].open,
      high: Math.max(...rows.map(x => x.high)),
      low: Math.min(...rows.map(x => x.low)),
      close: rows.at(-1).close,
      volume: rows.reduce((sum, x) => sum + x.volume, 0)
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

function 이진마지막(bars, endTime) {
  let lo = 0, hi = bars.length - 1, answer = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].endTime <= endTime) { answer = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return answer;
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) value = (value * (period - 1) + trs[i]) / period;
  return value;
}

function 연도더하기(ms, years) {
  const d = new Date(ms);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.getTime();
}

/**
 * 매 4H 확정 시점의 지표를 계산한다.
 * 모든 입력 배열은 decisionEnd 이하의 확정 봉만 잘라서 전달한다.
 */
function 특징생성(payload) {
  const raw = payload.candles.map(c => ({ ...c, endTime: c.time + HOUR }));
  const packs = {
    '1h': raw,
    '4h': 집계(raw, '4h'),
    '12h': 집계(raw, '12h'),
    '1d': 집계(raw, '1d')
  };
  const rawByEnd = new Map(raw.map((c, i) => [c.endTime, i]));
  const records = [];
  const decisions = packs['4h'];

  for (let di = 0; di < decisions.length; di++) {
    const decisionEnd = decisions[di].endTime;
    const rawIndex = rawByEnd.get(decisionEnd);
    if (rawIndex === undefined || rawIndex + 24 >= raw.length) continue;
    const frames = {};
    const windows = {};
    let ready = true;
    for (const tf of ['1h', '4h', '12h', '1d']) {
      const last = 이진마지막(packs[tf], decisionEnd);
      if (last < 249) { ready = false; break; }
      const window = packs[tf].slice(last - 249, last + 1);
      windows[tf] = window;
      frames[tf] = MarketAnalyzer.analyzeTimeframe(window, { excludeLast: false });
      if (frames[tf].error) { ready = false; break; }
    }
    if (!ready) continue;
    records.push({
      time: decisionEnd,
      rawIndex,
      close: raw[rawIndex].close,
      forwardReturns: {
        '4h': raw[rawIndex + 4].close / raw[rawIndex].close - 1,
        '12h': raw[rawIndex + 12].close / raw[rawIndex].close - 1,
        '24h': raw[rawIndex + 24].close / raw[rawIndex].close - 1
      },
      atr4h: atr(windows['4h'], 14),
      frames
    });
    if (di % 1000 === 0) process.stdout.write(`\r${payload.meta.exchange} 특징 ${di}/${decisions.length}`);
  }
  process.stdout.write('\n');
  return { raw, packs, records };
}

function 프레임방향(frame, scoreThreshold) {
  if (frame.score >= scoreThreshold) return 1;
  if (frame.score <= -scoreThreshold) return -1;
  return 0;
}

function 신호(record, cfg) {
  const dirs = {};
  for (const tf of ['1h', '4h', '12h', '1d']) dirs[tf] = 프레임방향(record.frames[tf], cfg.scoreThreshold);
  const bull = Object.values(dirs).filter(x => x === 1).length;
  const bear = Object.values(dirs).filter(x => x === -1).length;
  let side = bull >= cfg.mtfAgree ? 1 : bear >= cfg.mtfAgree ? -1 : 0;
  if (!side) return 0;
  const h4 = record.frames['4h'];
  if (cfg.adxMin && (!h4.adx || h4.adx.adx < cfg.adxMin)) return 0;
  if (cfg.volumeMin && (!(h4.volume.ratio >= cfg.volumeMin))) return 0;
  if (cfg.avoidRsiChase && ((side === 1 && h4.rsi >= 70) || (side === -1 && h4.rsi <= 30))) return 0;
  if (cfg.align1d4h && !(dirs['1d'] === side && dirs['4h'] === side)) return 0;
  return cfg.forecastMode === 'contrarian' ? -side : side;
}

function wilson(success, n, z = 1.96) {
  if (!n) return [null, null];
  const p = success / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
  return [center - margin, center + margin];
}

function 정확도(records, cfg, horizon = '12h') {
  let signals = 0, hits = 0, longs = 0, longHits = 0, shorts = 0, shortHits = 0;
  for (const r of records) {
    const side = 신호(r, cfg);
    if (!side) continue;
    signals++;
    const hit = side * r.forwardReturns[horizon] > 0;
    if (hit) hits++;
    if (side === 1) { longs++; if (hit) longHits++; }
    else { shorts++; if (hit) shortHits++; }
  }
  const longAccuracy = longs ? longHits / longs : null;
  const shortAccuracy = shorts ? shortHits / shorts : null;
  const balanced = longAccuracy !== null && shortAccuracy !== null ? (longAccuracy + shortAccuracy) / 2 : null;
  const ci = wilson(hits, signals);
  return {
    eligible: records.length,
    signals,
    coverage: records.length ? signals / records.length : 0,
    accuracy: signals ? hits / signals : null,
    balancedAccuracy: balanced,
    longs, longAccuracy,
    shorts, shortAccuracy,
    wilsonLow: ci[0], wilsonHigh: ci[1]
  };
}

function 설정목록() {
  const out = [];
  for (const forecastMode of ['trend', 'contrarian'])
    for (const scoreThreshold of [3, 4, 5])
      for (const mtfAgree of [3, 4])
        for (const adxMin of [0, 20, 25])
          for (const volumeMin of [0, 0.8, 1.0])
            for (const avoidRsiChase of [false, true])
              for (const align1d4h of [false, true])
                out.push({ forecastMode, scoreThreshold, mtfAgree, adxMin, volumeMin, avoidRsiChase, align1d4h });
  return out;
}

function 구간(records, start, end) {
  return records.filter(r => r.time >= start && r.time < end);
}

function 전략(records, cfg, raw, roundTripCost = 0.0012) {
  const trades = [];
  let occupiedUntil = -1;
  for (const r of records) {
    if (r.rawIndex <= occupiedUntil || !(r.atr4h > 0)) continue;
    const side = 신호(r, cfg);
    if (!side) continue;
    const entryIndex = r.rawIndex + 1;
    if (!raw[entryIndex]) continue;
    const entry = raw[entryIndex].open;
    const riskDistance = r.atr4h * 1.5;
    const stop = entry - side * riskDistance;
    const target = entry + side * riskDistance * 1.5;
    let exit = raw[Math.min(entryIndex + 23, raw.length - 1)].close;
    let exitIndex = Math.min(entryIndex + 23, raw.length - 1);
    let reason = '24H 시간청산';
    for (let i = entryIndex; i <= Math.min(entryIndex + 23, raw.length - 1); i++) {
      const c = raw[i];
      const stopHit = side === 1 ? c.low <= stop : c.high >= stop;
      const targetHit = side === 1 ? c.high >= target : c.low <= target;
      // 봉 내부 순서를 알 수 없으므로 동시 접촉은 보수적으로 손절 우선이다.
      if (stopHit) { exit = stop; exitIndex = i; reason = targetHit ? '동시접촉-손절우선' : '손절'; break; }
      if (targetHit) { exit = target; exitIndex = i; reason = '목표'; break; }
    }
    const grossR = side * (exit - entry) / riskDistance;
    const costR = entry * roundTripCost / riskDistance;
    trades.push({ time: r.time, side, entry, exit, grossR, netR: grossR - costR, reason });
    occupiedUntil = exitIndex;
  }
  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR <= 0);
  const positive = wins.reduce((s, t) => s + t.netR, 0);
  const negative = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  let equity = 0, peak = 0, maxDrawdownR = 0;
  for (const t of trades) {
    equity += t.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : null,
    expectancyR: trades.length ? trades.reduce((s, t) => s + t.netR, 0) / trades.length : null,
    profitFactor: negative ? positive / negative : null,
    maxDrawdownR,
    targetExits: trades.filter(t => t.reason === '목표').length,
    stopExits: trades.filter(t => t.reason.includes('손절')).length,
    timeExits: trades.filter(t => t.reason === '24H 시간청산').length
  };
}

/** 12H 방향 예측과 동일한 만기의 고정 보유 검산. 신호가 겹치면 새 포지션을 열지 않는다. */
function 고정12H전략(records, cfg, raw, roundTripCost = 0.0012) {
  const trades = [];
  let occupiedUntil = -1;
  for (const r of records) {
    if (r.rawIndex <= occupiedUntil) continue;
    const side = 신호(r, cfg);
    if (!side || !raw[r.rawIndex + 12] || !raw[r.rawIndex + 1]) continue;
    const entry = raw[r.rawIndex + 1].open;
    const exit = raw[r.rawIndex + 12].close;
    const grossReturn = side * (exit / entry - 1);
    trades.push({ time: r.time, side, grossReturn, netReturn: grossReturn - roundTripCost });
    occupiedUntil = r.rawIndex + 12;
  }
  const wins = trades.filter(t => t.netReturn > 0);
  const losses = trades.filter(t => t.netReturn <= 0);
  const positive = wins.reduce((s, t) => s + t.netReturn, 0);
  const negative = Math.abs(losses.reduce((s, t) => s + t.netReturn, 0));
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const t of trades) {
    equity += t.netReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : null,
    expectancy: trades.length ? trades.reduce((s, t) => s + t.netReturn, 0) / trades.length : null,
    profitFactor: negative ? positive / negative : null,
    maxDrawdown
  };
}

function pct(v, digits = 2) { return v === null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(digits)}%`; }
function num(v, digits = 3) { return v === null || !Number.isFinite(v) ? 'N/A' : v.toFixed(digits); }
function configText(c) {
  return `${c.forecastMode === 'contrarian' ? '평균회귀형' : '추세지속형'}, 점수≥${c.scoreThreshold}, MTF ${c.mtfAgree}/4, ADX≥${c.adxMin || '없음'}, 거래량≥${c.volumeMin || '없음'}, RSI추격방지=${c.avoidRsiChase ? '예' : '아니오'}, 1D·4H정렬=${c.align1d4h ? '필수' : '아니오'}`;
}

const binancePayload = 로드('binance');
const mexcPayload = 로드('mexc');
const binance = 특징생성(binancePayload);
const mexc = 특징생성(mexcPayload);

const start = binancePayload.meta.start;
const trainEnd = 연도더하기(start, 3);
const validationEnd = 연도더하기(start, 4);
const end = binancePayload.meta.endExclusive;
const splits = {
  train: 구간(binance.records, start, trainEnd),
  validation: 구간(binance.records, trainEnd, validationEnd),
  test: 구간(binance.records, validationEnd, end),
  all: binance.records
};
const mexcSplits = {
  train: 구간(mexc.records, start, trainEnd),
  validation: 구간(mexc.records, trainEnd, validationEnd),
  test: 구간(mexc.records, validationEnd, end),
  all: mexc.records
};

const baseline = { forecastMode: 'trend', scoreThreshold: 3, mtfAgree: 3, adxMin: 0, volumeMin: 0, avoidRsiChase: false, align1d4h: false };
const baselineMetrics = Object.fromEntries(Object.entries(splits).map(([k, rows]) => [k, 정확도(rows, baseline)]));

const trainingFolds = [0, 1, 2].map(year => 구간(binance.records, 연도더하기(start, year), 연도더하기(start, year + 1)));
const ranked = 설정목록().map(cfg => {
  const metrics = 정확도(splits.train, cfg);
  const folds = trainingFolds.map(rows => 정확도(rows, cfg));
  return {
    cfg,
    metrics,
    folds,
    robustScore: Math.min(...folds.map(x => x.balancedAccuracy ?? -1))
  };
})
  .filter(x => x.metrics.signals >= 300 && x.metrics.longs >= 100 && x.metrics.shorts >= 100 && x.metrics.coverage >= 0.15)
  .filter(x => x.folds.every(f => f.signals >= 100 && f.longs >= 30 && f.shorts >= 30 && f.coverage >= 0.12))
  .sort((a, b) => (b.robustScore - a.robustScore) || (b.metrics.wilsonLow - a.metrics.wilsonLow) || (b.metrics.coverage - a.metrics.coverage));

if (!ranked.length) throw new Error('최소 표본 조건을 충족한 후보가 없습니다.');
const selected = ranked[0].cfg;
const selectedMetrics = Object.fromEntries(Object.entries(splits).map(([k, rows]) => [k, 정확도(rows, selected)]));
const mexcBaseline = Object.fromEntries(Object.entries(mexcSplits).map(([k, rows]) => [k, 정확도(rows, baseline)]));
const mexcSelected = Object.fromEntries(Object.entries(mexcSplits).map(([k, rows]) => [k, 정확도(rows, selected)]));

const strategy = {};
for (const [name, rows] of Object.entries(splits)) {
  strategy[`binance_${name}_baseline`] = 전략(rows, baseline, binance.raw, 0.0012);
  strategy[`binance_${name}_selected`] = 전략(rows, selected, binance.raw, 0.0012);
}
strategy.mexc_all_baseline = 전략(mexc.records, baseline, mexc.raw, 0.0012);
strategy.mexc_all_selected = 전략(mexc.records, selected, mexc.raw, 0.0012);

const fixedHorizonStrategy = {
  binance_validation_baseline: 고정12H전략(splits.validation, baseline, binance.raw, 0.0012),
  binance_validation_selected: 고정12H전략(splits.validation, selected, binance.raw, 0.0012),
  binance_test_baseline: 고정12H전략(splits.test, baseline, binance.raw, 0.0012),
  binance_test_selected: 고정12H전략(splits.test, selected, binance.raw, 0.0012),
  mexc_all_baseline: 고정12H전략(mexc.records, baseline, mexc.raw, 0.0012),
  mexc_all_selected: 고정12H전략(mexc.records, selected, mexc.raw, 0.0012)
};

const validationImproved = selectedMetrics.validation.balancedAccuracy >= baselineMetrics.validation.balancedAccuracy + 0.005;
const testAboveChance = selectedMetrics.test.accuracy > 0.5 && selectedMetrics.test.wilsonLow > 0.5;
const mexcAboveChance = mexcSelected.all.accuracy > 0.5 && mexcSelected.all.wilsonLow > 0.5;
const coverageSufficient = selectedMetrics.validation.signals >= 250 && selectedMetrics.test.signals >= 250 && mexcSelected.all.signals >= 1000;
const netExpectancyPositive = fixedHorizonStrategy.binance_test_selected.expectancy > 0 && fixedHorizonStrategy.mexc_all_selected.expectancy > 0;
const adopted = validationImproved && testAboveChance && mexcAboveChance && coverageSufficient && netExpectancyPositive;

const inverseBaseline = { ...baseline, forecastMode: 'contrarian' };
const horizonDiagnostics = {};
for (const horizon of ['4h', '12h', '24h']) {
  horizonDiagnostics[horizon] = {
    binanceTestTrend: 정확도(splits.test, baseline, horizon),
    binanceTestContrarian: 정확도(splits.test, inverseBaseline, horizon),
    mexcAllTrend: 정확도(mexc.records, baseline, horizon),
    mexcAllContrarian: 정확도(mexc.records, inverseBaseline, horizon)
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  period: { start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(), trainEnd: new Date(trainEnd).toISOString(), validationEnd: new Date(validationEnd).toISOString() },
  dataQuality: { binance: binancePayload.quality, mexc: mexcPayload.quality },
  baseline,
  selected,
  adopted,
  adoptionChecks: { validationImproved, testAboveChance, mexcAboveChance, coverageSufficient, netExpectancyPositive },
  metrics: { binanceBaseline: baselineMetrics, binanceSelected: selectedMetrics, mexcBaseline, mexcSelected },
  horizonDiagnostics,
  strategy,
  fixedHorizonStrategy,
  topTrainingCandidates: ranked.slice(0, 10)
};

fs.writeFileSync(path.join(RESULT_DIR, 'btc_5y_backtest.json'), JSON.stringify(output, null, 2));

function accuracyRow(exchange, split, base, tuned) {
  return `| ${exchange} | ${split} | 기준 | ${base.signals} | ${pct(base.coverage)} | ${pct(base.accuracy)} | ${pct(base.balancedAccuracy)} | ${pct(base.longAccuracy)} | ${pct(base.shortAccuracy)} | ${pct(base.wilsonLow)}~${pct(base.wilsonHigh)} |\n`
    + `| ${exchange} | ${split} | 후보 | ${tuned.signals} | ${pct(tuned.coverage)} | ${pct(tuned.accuracy)} | ${pct(tuned.balancedAccuracy)} | ${pct(tuned.longAccuracy)} | ${pct(tuned.shortAccuracy)} | ${pct(tuned.wilsonLow)}~${pct(tuned.wilsonHigh)} |`;
}

function strategyRow(label, x) {
  return `| ${label} | ${x.trades} | ${pct(x.winRate)} | ${num(x.expectancyR)}R | ${num(x.profitFactor)} | ${num(x.maxDrawdownR)}R |`;
}

function fixedStrategyRow(label, x) {
  return `| ${label} | ${x.trades} | ${pct(x.winRate)} | ${pct(x.expectancy, 3)} | ${num(x.profitFactor)} | ${pct(x.maxDrawdown)} |`;
}

const report = `# BTC 5년 코인분석스킬 정확도 검증

생성 시각: ${output.generatedAt}

## 결론

- 현재 기준: ${configText(baseline)}
- 학습 구간 최상위 후보: ${configText(selected)}
- 최종 채택: **${adopted ? '예' : '아니오'}**
- 채택 조건: 검증 균형 정확도 +0.5%p 이상, 최종 시험·MEXC 정확도 95% 하한 50% 초과, 검증·시험 각 250개와 MEXC 1,000개 이상, 12H 비용 반영 기대값 양수

## 데이터 품질

| 거래소 | 계약 | 기간 | 1H 봉 | 커버리지 | 누락 | 비정상 OHLC | 0거래량 |
|---|---|---|---:|---:|---:|---:|---:|
| Binance | BTCUSDT USDT-M perpetual | ${binancePayload.quality.first} ~ ${binancePayload.quality.last} | ${binancePayload.quality.rows} | ${binancePayload.quality.coveragePct.toFixed(4)}% | ${binancePayload.quality.missingHours} | ${binancePayload.quality.invalidOhlc} | ${binancePayload.quality.zeroVolume} |
| MEXC | BTC_USDT USDT perpetual | ${mexcPayload.quality.first} ~ ${mexcPayload.quality.last} | ${mexcPayload.quality.rows} | ${mexcPayload.quality.coveragePct.toFixed(4)}% | ${mexcPayload.quality.missingHours} | ${mexcPayload.quality.invalidOhlc} | ${mexcPayload.quality.zeroVolume} |

MEXC 누락이 포함된 불완전 4H·12H·1D 봉은 보간하지 않고 제외했다.

## 방향 정확도

판정은 매 4H 확정 시점, 목표는 이후 12H 종가 방향이다. 정확도는 신호 표본만, 커버리지는 전체 판정 가능 시점 중 신호 비율이다.

| 거래소 | 구간 | 규칙 | 신호 수 | 커버리지 | 정확도 | 균형 정확도 | 롱 | 숏 | 정확도 95% CI |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
${accuracyRow('Binance', '학습', baselineMetrics.train, selectedMetrics.train)}
${accuracyRow('Binance', '검증', baselineMetrics.validation, selectedMetrics.validation)}
${accuracyRow('Binance', '최종 시험', baselineMetrics.test, selectedMetrics.test)}
${accuracyRow('Binance', '전체', baselineMetrics.all, selectedMetrics.all)}
${accuracyRow('MEXC', '최종 시험', mexcBaseline.test, mexcSelected.test)}
${accuracyRow('MEXC', '전체', mexcBaseline.all, mexcSelected.all)}

## 예측 방향 매핑 진단

현재 추세 상태를 그대로 예측하는 경우와 반대로 매핑하는 경우를 비교한다. 이 표는 방향 상태와 미래 예측을 분리해야 하는지 확인하기 위한 진단이다.

| 전망 기간 | Binance 시험 추세지속 | Binance 시험 평균회귀 | MEXC 전체 추세지속 | MEXC 전체 평균회귀 |
|---|---:|---:|---:|---:|
${['4h','12h','24h'].map(h => `| ${h} | ${pct(horizonDiagnostics[h].binanceTestTrend.balancedAccuracy)} | ${pct(horizonDiagnostics[h].binanceTestContrarian.balancedAccuracy)} | ${pct(horizonDiagnostics[h].mexcAllTrend.balancedAccuracy)} | ${pct(horizonDiagnostics[h].mexcAllContrarian.balancedAccuracy)} |`).join('\n')}

## 표준화 전략 검증

### 예측 목표와 동일한 12H 고정 보유

- 신호 다음 1H 시가 진입, 12H 시점 종가 청산
- 한 번에 한 포지션
- 왕복 수수료·슬리피지 합계 0.12% 가정

| 구간 | 거래 | 순승률 | 거래당 순기대수익 | Profit Factor | 누적수익 기준 최대 낙폭 |
|---|---:|---:|---:|---:|---:|
${fixedStrategyRow('Binance 검증 기준', fixedHorizonStrategy.binance_validation_baseline)}
${fixedStrategyRow('Binance 검증 후보', fixedHorizonStrategy.binance_validation_selected)}
${fixedStrategyRow('Binance 시험 기준', fixedHorizonStrategy.binance_test_baseline)}
${fixedStrategyRow('Binance 시험 후보', fixedHorizonStrategy.binance_test_selected)}
${fixedStrategyRow('MEXC 전체 기준', fixedHorizonStrategy.mexc_all_baseline)}
${fixedStrategyRow('MEXC 전체 후보', fixedHorizonStrategy.mexc_all_selected)}

### ATR 손절·목표 적용

- 신호 다음 1H 시가 진입
- 4H ATR(14)의 1.5배 손절, 목표 1.5R, 최대 24H 보유
- 한 번에 한 포지션, 목표·손절 동시 접촉 시 손절 우선
- 왕복 수수료·슬리피지 합계 0.12% 가정

| 구간 | 거래 | 순승률 | 거래당 기대값 | Profit Factor | 최대 낙폭 |
|---|---:|---:|---:|---:|---:|
${strategyRow('Binance 검증 기준', strategy.binance_validation_baseline)}
${strategyRow('Binance 검증 후보', strategy.binance_validation_selected)}
${strategyRow('Binance 시험 기준', strategy.binance_test_baseline)}
${strategyRow('Binance 시험 후보', strategy.binance_test_selected)}
${strategyRow('MEXC 전체 기준', strategy.mexc_all_baseline)}
${strategyRow('MEXC 전체 후보', strategy.mexc_all_selected)}

## 해석 한계

- Binance와 MEXC는 같은 BTC 가격 형성 과정을 공유하므로 완전히 독립적인 시장 표본은 아니다.
- 4H마다 반복되는 12H 방향 표본은 일부 겹친다. 95% 구간은 단순 이항 기준이며 시계열 자기상관을 완전히 보정하지 않는다.
- 실제 체결은 호가 깊이, 주문 유형, 펀딩비에 따라 달라진다. 여기서는 공통 비용 가정으로 규칙만 비교했다.
- 단일 자산·단일 5년 구간 결과를 다른 코인이나 미래 시장의 승률로 일반화할 수 없다.

## 공식 데이터 출처

- Binance USDT-M Futures Kline: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data
- MEXC Contract Kline: https://mexcdevelop.github.io/apidocs/contract_v1_en/#k-line-data
`;

fs.writeFileSync(path.join(RESULT_DIR, 'BTC_5Y_BACKTEST_REPORT.md'), report);

console.log('\n기준:', configText(baseline));
console.log('후보:', configText(selected));
console.log('채택:', adopted);
console.table([
  { 구간: 'Binance 학습 기준', 신호: baselineMetrics.train.signals, 커버리지: pct(baselineMetrics.train.coverage), 균형정확도: pct(baselineMetrics.train.balancedAccuracy) },
  { 구간: 'Binance 학습 후보', 신호: selectedMetrics.train.signals, 커버리지: pct(selectedMetrics.train.coverage), 균형정확도: pct(selectedMetrics.train.balancedAccuracy) },
  { 구간: 'Binance 검증 기준', 신호: baselineMetrics.validation.signals, 커버리지: pct(baselineMetrics.validation.coverage), 균형정확도: pct(baselineMetrics.validation.balancedAccuracy) },
  { 구간: 'Binance 검증 후보', 신호: selectedMetrics.validation.signals, 커버리지: pct(selectedMetrics.validation.coverage), 균형정확도: pct(selectedMetrics.validation.balancedAccuracy) },
  { 구간: 'Binance 시험 기준', 신호: baselineMetrics.test.signals, 커버리지: pct(baselineMetrics.test.coverage), 균형정확도: pct(baselineMetrics.test.balancedAccuracy) },
  { 구간: 'Binance 시험 후보', 신호: selectedMetrics.test.signals, 커버리지: pct(selectedMetrics.test.coverage), 균형정확도: pct(selectedMetrics.test.balancedAccuracy) },
  { 구간: 'MEXC 전체 기준', 신호: mexcBaseline.all.signals, 커버리지: pct(mexcBaseline.all.coverage), 균형정확도: pct(mexcBaseline.all.balancedAccuracy) },
  { 구간: 'MEXC 전체 후보', 신호: mexcSelected.all.signals, 커버리지: pct(mexcSelected.all.coverage), 균형정확도: pct(mexcSelected.all.balancedAccuracy) }
]);
