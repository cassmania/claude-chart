const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);

assert.ok(inline, '인라인 앱 스크립트가 있어야 합니다.');
assert.doesNotThrow(() => new Function(inline[1]));
assert.match(html, /v41_analyzer\.js\?v=4\.1\.0/);
assert.match(html, /코인분석스킬 V4\.1/);
assert.match(html, /PART 0 · 데이터 기준 및 USDT\.D/);
assert.match(html, /PART 3 · 온체인 및 고래/);
assert.match(html, /PART 4 · 토큰노믹스 및 뉴스/);
assert.match(html, /SMA20\/60\/120\/200/);
assert.match(html, /Stochastic\(14,3,3\)/);
assert.match(html, /포지션 위험액 = 계좌 평가액 × 0\.5~1%/);
assert.match(html, /웹 조사 미수행/);
assert.match(html, /MarketAnalyzer\.confirmedCandles\(mtf캐시\.data\[tf\]\)\.slice\(-200\)/);
assert.match(html, /width:min\(400px,100vw\)/);
assert.match(html, /환율캐시\.ts = Date\.now\(\)/);
assert.match(html, /도미넌스캐시\.ts = Date\.now\(\)/);
assert.doesNotMatch(html, /fetch\('https:\/\/api\.coingecko\.com/);
assert.match(html, /<link rel="icon" href="data:,">/);

console.log('V4.1 화면 통합 테스트 통과');
