/**
 * Binance·MEXC BTC USDT 무기한 선물 1H OHLCV 수집기.
 *
 * 실행: node backtest/fetch_btc_5y.mjs [--refresh]
 * 인증이 필요 없는 거래소 공식 공개 API만 사용한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backtest_data');
const HOUR_MS = 60 * 60 * 1000;
const HOUR_SEC = 60 * 60;
const REFRESH = process.argv.includes('--refresh');

fs.mkdirSync(DATA_DIR, { recursive: true });

function 기간() {
  // 현재 진행 중인 1시간봉은 제외하고, 마지막 확정 봉의 끝 시각을 기준으로 정확히 5년을 잡는다.
  const endExclusive = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const startDate = new Date(endExclusive);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 5);
  return { start: startDate.getTime(), endExclusive };
}

function 대기(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function json요청(url, attempt = 1) {
  const response = await fetch(url, { headers: { 'User-Agent': 'claude-chart-backtest/1.0' } });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await 대기(500 * attempt);
    return json요청(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function 정렬중복제거(candles, start, endExclusive) {
  const map = new Map();
  for (const c of candles) {
    if (c.time >= start && c.time < endExclusive) map.set(c.time, c);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function 바이낸스수집(start, endExclusive) {
  const all = [];
  let cursor = start;
  while (cursor < endExclusive) {
    const url = new URL('https://fapi.binance.com/fapi/v1/klines');
    url.searchParams.set('symbol', 'BTCUSDT');
    url.searchParams.set('interval', '1h');
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(endExclusive - 1));
    url.searchParams.set('limit', '1500');
    const rows = await json요청(url);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const k of rows) {
      all.push({
        time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4],
        volume: +k[5], quoteVolume: +k[7], trades: +k[8]
      });
    }
    const next = +rows.at(-1)[0] + HOUR_MS;
    if (next <= cursor) throw new Error('Binance 페이지네이션이 전진하지 않습니다.');
    cursor = next;
    process.stdout.write(`\rBinance ${Math.min(100, ((cursor - start) / (endExclusive - start)) * 100).toFixed(1)}%`);
    await 대기(80);
  }
  process.stdout.write('\n');
  return 정렬중복제거(all, start, endExclusive);
}

async function 멕시수집(start, endExclusive) {
  const all = [];
  let cursorSec = Math.floor(start / 1000);
  const endSec = Math.floor(endExclusive / 1000);
  // 한 요청당 1,500시간으로 제한해 문서·서버별 반환 상한 차이를 피한다.
  const chunkSec = 1500 * HOUR_SEC;
  while (cursorSec < endSec) {
    const chunkEnd = Math.min(endSec, cursorSec + chunkSec);
    const url = new URL('https://contract.mexc.com/api/v1/contract/kline/BTC_USDT');
    url.searchParams.set('interval', 'Min60');
    url.searchParams.set('start', String(cursorSec));
    url.searchParams.set('end', String(chunkEnd - 1));
    const body = await json요청(url);
    if (!body.success || !body.data || !Array.isArray(body.data.time)) {
      throw new Error(`MEXC 응답 오류: ${JSON.stringify(body).slice(0, 300)}`);
    }
    for (let i = 0; i < body.data.time.length; i++) {
      all.push({
        time: +body.data.time[i] * 1000,
        open: +body.data.open[i], high: +body.data.high[i], low: +body.data.low[i], close: +body.data.close[i],
        volume: +body.data.vol[i], amount: body.data.amount ? +body.data.amount[i] : null
      });
    }
    cursorSec = chunkEnd;
    process.stdout.write(`\rMEXC ${Math.min(100, ((cursorSec * 1000 - start) / (endExclusive - start)) * 100).toFixed(1)}%`);
    await 대기(100);
  }
  process.stdout.write('\n');
  return 정렬중복제거(all, start, endExclusive);
}

function 품질(candles, start, endExclusive) {
  let gaps = 0, missingHours = 0, invalid = 0, zeroVolume = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!(c.low > 0 && c.high >= c.low && c.open >= c.low && c.open <= c.high && c.close >= c.low && c.close <= c.high)) invalid++;
    if (!(c.volume > 0)) zeroVolume++;
    if (i > 0) {
      const diff = c.time - candles[i - 1].time;
      if (diff !== HOUR_MS) {
        gaps++;
        if (diff > HOUR_MS) missingHours += Math.round(diff / HOUR_MS) - 1;
      }
    }
  }
  const expected = Math.round((endExclusive - start) / HOUR_MS);
  return {
    rows: candles.length,
    expectedRows: expected,
    coveragePct: expected ? candles.length / expected * 100 : 0,
    first: candles[0] ? new Date(candles[0].time).toISOString() : null,
    last: candles.at(-1) ? new Date(candles.at(-1).time).toISOString() : null,
    gaps,
    missingHours,
    invalidOhlc: invalid,
    zeroVolume
  };
}

async function 수집또는캐시(exchange, fetcher, start, endExclusive) {
  const file = path.join(DATA_DIR, `${exchange}_BTCUSDT_1h_5y.json`);
  if (!REFRESH && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.meta.start === start && cached.meta.endExclusive === endExclusive) {
      console.log(`${exchange}: 동일 기간 캐시 사용`);
      return cached;
    }
  }
  const candles = await fetcher(start, endExclusive);
  const payload = {
    meta: {
      exchange,
      market: exchange === 'binance' ? 'BTCUSDT USDT-M perpetual' : 'BTC_USDT USDT perpetual',
      interval: '1h',
      start,
      endExclusive,
      fetchedAt: new Date().toISOString(),
      source: exchange === 'binance'
        ? 'https://fapi.binance.com/fapi/v1/klines'
        : 'https://contract.mexc.com/api/v1/contract/kline/BTC_USDT'
    },
    quality: 품질(candles, start, endExclusive),
    candles
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  return payload;
}

const { start, endExclusive } = 기간();
console.log(`기간: ${new Date(start).toISOString()} ~ ${new Date(endExclusive).toISOString()} (끝 시각 미포함)`);

const binance = await 수집또는캐시('binance', 바이낸스수집, start, endExclusive);
const mexc = await 수집또는캐시('mexc', 멕시수집, start, endExclusive);

console.table([
  { exchange: 'Binance', ...binance.quality },
  { exchange: 'MEXC', ...mexc.quality }
]);
