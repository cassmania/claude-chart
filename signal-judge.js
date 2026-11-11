/* signal-judge.js — 검증된 진입 규칙 + 판단 카드 (trading-chart · claude-chart · crypto-futures-simulator 공용 사본)
 * 원본: 클로드/.claude/skills/indicator-autotune/assets/signal-judge.js — 고치면 세 사본을 같이 바꿀 것.
 *
 * 하는 일
 *  1) 추세 합의(custom.js 1위)의 진입 신호를 "그 봉의 방향 점수가 같은 쪽일 때만" 통과시킨다.
 *     Custom.LIST[0].build를 감싸므로 타점 마커·신호 피드·순위표 통계가 전부 같은 규칙을 쓴다.
 *  2) SignalJudge.render(el, bars, meta): 방향 점수 · 실행 규칙 · 지표 신뢰도 카드 3장을 그린다.
 *     숫자는 indicator-audit.js(indicator-autotune 스킬이 검증 때마다 다시 씀)에서 읽고, 없으면 기본 문구.
 * 필요: CoinAnalysis(analysis-engine.js) · Engine(engine.js / indicator_engine.js) · Custom(custom.js)
 */
(function (root) {
  'use strict';
  const CA = root.CoinAnalysis, E = root.Engine, C = root.Custom;
  if (!CA || !E || !C || !C.LIST || !C.LIST[0] || root.SignalJudge) return;
  const AUD = (root.INDICATOR_AUDIT && root.INDICATOR_AUDIT.text) || {};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TF_KO = { '1m': '1분', '3m': '3분', '5m': '5분', '15m': '15분', '30m': '30분', '1h': '1시간', '2h': '2시간', '4h': '4시간', '6h': '6시간', '8h': '8시간', '12h': '12시간', '1d': '일', '1w': '주', '1M': '월' };
  // 사이트마다 거래량 키가 다르다(volume / vol / v). 엔진은 volume을 읽는다.
  const withVol = rows => rows.length && rows[rows.length - 1].volume === undefined ? rows.map(c => ({ ...c, volume: c.vol !== undefined ? c.vol : c.v || 0 })) : rows;
  const scoreAt = (rows, i) => { const g = CA.compositeSignal(rows.slice(Math.max(0, i - 498), i + 1)); return g.ready ? g.score : null; };

  // 1) 진입 게이트 — 추세 합의가 새로 충족된 봉은 드물어 방향 점수 계산도 그때만 한다
  const d1 = C.LIST[0], rawBuild = d1.build.bind(d1);
  d1.build = function (b) {
    const r = rawBuild(b), rows = withVol(b);
    const ok = (i, dir) => { const s = scoreAt(rows, i); return s != null && dir * s >= 0; };
    r.long = r.long.map((v, i) => v && ok(i, 1));
    r.short = r.short.map((v, i) => v && ok(i, -1));
    return r;
  };
  d1.desc += ' · 진입은 방향 점수가 같은 쪽일 때만';
  d1.lab = '자동 검증 ' + (AUD.asOf || '2026-11-11') + ' · ' + (AUD.rule || '+0.26R · 무작위 +0.05R') + ' · 승률 ' + (AUD.win || '29%');

  // 2) 판단 카드
  function state(bars, closed) {
    const rows = withVol(closed ? bars : bars.slice(0, -1)).slice(-500);   // 형성 중인 마지막 봉은 뺀다
    if (rows.length < 60) return { ready: false };
    const sg = CA.compositeSignal(rows), li = rows.length - 1;
    const out = { ready: sg.ready, score: sg.score, label: sg.label, direction: sg.direction, strength: sg.strength, plan: null };
    if (sg.ready && rows.length >= 210) out.plan = { agree: rawBuild(rows).osc.data[li], adx: E.adx(rows, 14).adx[li], atr: E.atr(rows, 14)[li], close: rows[li].close };
    return out;
  }
  const digitsOf = p => p >= 1000 ? 1 : p >= 1 ? 3 : p >= 0.01 ? 5 : 7;
  function html(p, meta) {
    const chip = '<span class="sj-chip ' + (AUD.chipCls === '' ? '' : 'sj-up') + '">' + esc(AUD.chip || '기준보다 높음') + '</span>';
    const k3 = '<div class="sj-card"><div class="sj-t">지표 신뢰도 · 백테스트 ' + esc(AUD.asOf || '') + '</div>'
      + '<div class="sj-tr"><span>종합 시그널</span>' + chip + '</div><div class="sj-tr"><span>실행 규칙 · 차트 타점</span>' + chip + '</div>'
      + (meta.extra || []).map(x => '<div class="sj-tr"><span>' + esc(x[0]) + '</span><span class="sj-chip">' + esc(x[1]) + '</span></div>').join('') + '</div>';
    const wait = msg => '<div class="sj-card"><div class="sj-t">방향 점수 · 24봉 뒤</div><p class="sj-m">' + msg + '</p></div><div class="sj-card"><div class="sj-t">실행 규칙</div><p class="sj-m">' + msg + '</p></div>' + k3;
    if (!p || !p.ready || !isFinite(p.score)) return wait('확정봉이 모자라 계산할 수 없습니다.');
    const s = p.score, sg = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d === undefined ? 2 : d);
    const cls = p.direction === 'LONG_BIAS' ? 'sj-up' : p.direction === 'SHORT_BIAS' ? 'sj-down' : '';
    // 검증은 1시간봉 이상에서만 했다. 15분봉 이하는 수수료가 우위보다 커서 숫자를 그대로 보여 주면 안 된다.
    const short = /^(1|3|5|15|30)m$/.test(meta.tf || '');
    const hit = short ? '30분봉 이하는 검증 범위 밖' : p.strength === 'strong' ? (AUD.hitStrong || '53.5% · 평소 49.5%') : p.strength === 'weak' ? (AUD.hitWeak || '52.3% · 평소 49.5%') : '관망 구간 · 평소와 같음';
    const where = esc(String(meta.symbol || '').replace(/[\/_-]?USDT$/i, '')) + ' ' + esc(meta.tfLabel || (TF_KO[meta.tf] ? TF_KO[meta.tf] : meta.tf || '')) + (meta.tfLabel ? '' : '봉');
    const k1 = '<div class="sj-card"><div class="sj-t">방향 점수 · ' + where + ' · 24봉 뒤</div>'
      + '<div class="sj-row"><span class="sj-big ' + cls + '">' + sg(s) + '</span><span class="sj-chip ' + cls + '">' + esc(p.label || '') + '</span></div>'
      + '<div class="sj-gauge" role="img" aria-label="방향 점수 ' + sg(s) + '"><i style="left:' + Math.max(2, Math.min(98, 50 + s / 0.58 * 50)).toFixed(1) + '%"></i></div>'
      + '<div class="sj-scale"><span>하락 −0.20</span><span>관망</span><span>상승 +0.20</span></div>'
      + '<div class="sj-kv"><span>검증 적중</span><b>' + esc(hit) + '</b></div></div>';
    const pl = p.plan;
    let k2;
    if (!pl || pl.agree == null) k2 = '<div class="sj-card"><div class="sj-t">실행 규칙</div><p class="sj-m">확정봉 210개가 필요합니다.</p></div>';
    else {
      const dir = pl.agree === 5 ? 1 : pl.agree === -5 ? -1 : 0, side = dir === 1 ? '롱' : '숏';
      const c = [dir !== 0, pl.adx >= 20, dir !== 0 && dir * s >= 0], n = c.filter(Boolean).length, ok = n === 3;
      const ck = (y, t) => '<span class="sj-ck"><i class="' + (y ? 'y' : '') + '">' + (y ? '✓' : '–') + '</i>' + t + '</span>';
      const exit = pl.agree <= -3 ? '롱 청산' : pl.agree >= 3 ? '숏 청산' : '';
      const stop = ok && isFinite(pl.atr) ? (pl.close - dir * 2.5 * pl.atr).toFixed(meta.digits === undefined ? digitsOf(pl.close) : meta.digits) : '';
      k2 = '<div class="sj-card"><div class="sj-t">실행 규칙</div>'
        + '<div class="sj-row"><span class="sj-state ' + (ok ? (dir === 1 ? 'sj-up' : 'sj-down') : '') + '">' + (ok ? side + ' 조건 충족' : dir ? side + ' 보류' : '대기') + '</span><span class="sj-chip">조건 ' + n + ' / 3</span></div>'
        + '<div class="sj-cks">' + ck(c[0], '추세 합의 ' + sg(pl.agree, 0) + ' / 5') + ck(c[1], 'ADX ' + (isFinite(pl.adx) ? pl.adx.toFixed(0) : '—') + ' (20 이상)') + ck(c[2], '방향 점수 같은 쪽') + '</div>'
        + (stop ? '<div class="sj-kv"><span>손절 (2.5×ATR)</span><b>' + stop + '</b></div>' : exit ? '<div class="sj-kv"><span>보유 중이라면</span><b>' + exit + '</b></div>' : '')
        + (short ? '<div class="sj-kv"><span>검증 기대값</span><b>1시간봉 이상만 검증 · 짧은 봉은 수수료가 더 큼</b></div></div>' : '<div class="sj-kv"><span>검증 기대값 · 승률 ' + esc(AUD.win || '29%') + '</span><b>' + esc(AUD.rule || '+0.26R · 무작위 +0.05R') + '</b></div></div>');
    }
    return k1 + k2 + k3;
  }
  const last = new WeakMap();
  function render(el, bars, meta) {
    if (!el || !bars) return;
    meta = meta || {};
    let out;
    try { out = html(state(bars, meta.closed), meta); } catch (e) { out = ''; }
    if (last.get(el) !== out) { el.innerHTML = out; last.set(el, out); }   // 바뀐 때만 다시 그린다
  }

  const css = '.sj{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0;font-variant-numeric:tabular-nums;font-size:12.5px;line-height:1.4}'
    + '.sj.sj-stack{grid-template-columns:minmax(0,1fr)}.sj:empty{display:none}'
    + '.sj-card{background:var(--sj-card,color-mix(in srgb,currentColor 6%,transparent));border-radius:14px;padding:10px 14px;min-width:0}'
    + '.sj-t{font-size:11px;font-weight:600;opacity:.62;margin-bottom:5px}.sj-m{margin:0;opacity:.62;font-size:12px}'
    + '.sj-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
    + '.sj-big{font-size:26px;font-weight:700;letter-spacing:-.03em;line-height:1}.sj-state{font-size:16px;font-weight:700;letter-spacing:-.015em}'
    + '.sj-up{color:#12a150}.sj-down{color:#d64545}'
    + '.sj-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:600;background:color-mix(in srgb,currentColor 10%,transparent);white-space:nowrap}'
    + '.sj-chip.sj-up{background:rgba(18,161,80,.14)}.sj-chip.sj-down{background:rgba(214,69,69,.13)}'
    + '.sj-gauge{height:6px;border-radius:999px;position:relative;margin:9px 0 4px;background:linear-gradient(90deg,rgba(214,69,69,.24) 0 32.8%,color-mix(in srgb,currentColor 10%,transparent) 32.8% 67.2%,rgba(18,161,80,.24) 67.2%)}'
    + '.sj-gauge i{position:absolute;top:-4px;left:0;width:4px;height:14px;margin-left:-2px;border-radius:2px;background:currentColor;transition:left .4s cubic-bezier(.2,.8,.2,1)}'
    + '.sj-scale{display:flex;justify-content:space-between;font-size:9.5px;opacity:.62}'
    + '.sj-kv{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding-top:4px}.sj-kv span{opacity:.62}.sj-kv b{font-weight:600;text-align:right}'
    + '.sj-cks{margin-top:3px}.sj-ck{display:inline-flex;gap:5px;align-items:center;padding:1px 10px 1px 0;font-size:12px}'
    + '.sj-ck i{width:15px;height:15px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:700;flex:none;background:color-mix(in srgb,currentColor 10%,transparent)}'
    + '.sj-ck i.y{background:rgba(18,161,80,.16);color:#12a150}'
    + '.sj-tr{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2.5px 0;font-size:12px}'
    + '@media(max-width:900px){.sj:not(.sj-stack){display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}.sj:not(.sj-stack)::-webkit-scrollbar{display:none}.sj:not(.sj-stack) .sj-card{flex:0 0 84%;scroll-snap-align:start}}'
    + '@media(prefers-reduced-motion:reduce){.sj-gauge i{transition:none}}';
  if (root.document) { const st = root.document.createElement('style'); st.textContent = css; root.document.head.appendChild(st); }

  root.SignalJudge = { render: render, state: state, html: html };
})(typeof window !== 'undefined' ? window : globalThis);
