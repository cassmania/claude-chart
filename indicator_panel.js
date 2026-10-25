/* 보조지표 전략 — trading-chart 엔진(indicator_engine.js)을 활성 차트에 적용한다.
   11개 지표 전략을 그 차트 봉으로 워크포워드 백테스트해 국면별 최적 지표를 고르고,
   선·매매 타점·진입/손절/목표선을 차트에, 오실레이터와 검증 요약을 패널에 그린다.
   선물이라 롱·숏 양방향, 수수료는 바이낸스 선물 테이커 0.05%. index.html 인라인 스크립트 뒤에 로드한다. */
(function () {
  "use strict";
  if (!window.Engine || !window.LightweightCharts) return;

  const COL = { long: "#d64545", short: "#3a6fd8", accent: "#c96442", blue: "#5b8ff9", violet: "#8b6fd6",
    teal: "#2aa198", gray: "#74706a", line: "#e3dfd3" };
  const OPT = { mode: "both", fee: 0.0005 };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  let 선택 = "auto";
  try { 선택 = localStorage.getItem("claudechart_indicator") || "auto"; } catch (e) {}
  let 그린차트 = null, 직전키 = "", 오실 = null, 오실시리즈 = [], 범위해제 = null;

  function 오실차트() {
    if (오실) return 오실;
    const host = $("ind-osc");
    if (!host) return null;
    오실 = LightweightCharts.createChart(host, {
      autoSize: true,
      layout: { background: { type: "solid", color: "#fbfaf6" }, textColor: "#74706a", fontSize: 10 },
      grid: { vertLines: { color: "#efede5" }, horzLines: { color: "#efede5" } },
      rightPriceScale: { borderColor: "#e3dfd3" },
      timeScale: { borderColor: "#e3dfd3", visible: false },
      handleScroll: false, handleScale: false
    });
    return 오실;
  }

  function 지우기(c) {
    if (!c || !c.MC) return;
    (c._indSeries || []).forEach(s => { try { c.MC.removeSeries(s); } catch (e) {} });
    (c._indLines || []).forEach(l => { try { c.CS.removePriceLine(l); } catch (e) {} });
    c._indSeries = []; c._indLines = [];
    try { c.CS.setMarkers([]); } catch (e) {}
  }

  function 통계문구(st) {
    if (!st || !st.trades) return "검증 거래 없음";
    return "승률 " + (st.winRate * 100).toFixed(0) + "% · PF " + st.pf.toFixed(2) + " · 수익 "
      + (st.ret >= 0 ? "+" : "") + (st.ret * 100).toFixed(1) + "% · " + st.trades + "회";
  }
  function 신뢰도(st) {
    if (!st || st.trades < 5) return ["표본 부족", "lo"];
    if (st.pf >= 1.5 && st.lb >= 0.4 && st.ret > 0) return ["신뢰도 높음", "hi"];
    if (st.pf >= 1.1 && st.ret > 0) return ["신뢰도 보통", "mid"];
    return ["신뢰도 낮음", "lo"];
  }

  /** force가 아니면 같은 차트·같은 마지막 봉·같은 선택일 때 다시 계산하지 않는다(엔진 백테스트가 무겁다). */
  function indicatorRefresh(force) {
    const c = charts[activeChartIdx];
    if (!c || !c.MC || !c.candles.length) return;
    const key = c.sym + "|" + c.tf + "|" + c.candles.length + "|" + c.candles.at(-1).time + "|" + 선택;
    if (!force && key === 직전키 && 그린차트 === c) return;
    직전키 = key;
    if (그린차트 && 그린차트 !== c) 지우기(그린차트);
    지우기(c);
    그린차트 = c;

    const card = $("ind-card"), head = $("ind-osc-head"), sel = $("ind-sel"), target = $("ind-target");
    if (target) target.textContent = c.sym + " · " + c.tf.toUpperCase();
    const bars = c.candles.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const osc = 오실차트();
    오실시리즈.forEach(s => { try { osc.removeSeries(s); } catch (e) {} });
    오실시리즈 = [];
    if (bars.length < 120) {
      if (card) card.innerHTML = '<span class="ind-dim">백테스트는 120봉 이상 필요 — 이 차트는 ' + bars.length + "봉</span>";
      if (head) head.textContent = "";
      return;
    }
    let a;
    // lastClosed:false 기본값 → 마지막(진행 중) 봉에서는 신호를 내지 않는다.
    try { a = Engine.analyze(bars, OPT); }
    catch (e) { if (card) card.innerHTML = '<span class="ind-dim">보조지표 계산 실패</span>'; return; }

    if (sel && sel.options.length < 2) {
      sel.innerHTML = '<option value="auto">자동 (국면별 최적)</option>'
        + Engine.STRATEGIES.map(s => '<option value="' + s.id + '">' + esc(s.name) + "</option>").join("");
    }
    const row = 선택 !== "auto" ? a.rows.find(r => r.id === 선택) : null;
    if (sel) sel.value = row ? 선택 : "auto";
    const v = row
      ? { auto: false, id: row.id, trades: row.trades, open: row.open, pending: row.pending, stats: row.oos }
      : { auto: true, id: a.chosen || a.rows[0].id, trades: a.adaptive.trades, open: a.adaptive.open, pending: a.adaptive.pending, stats: a.adaptive.stats };
    const strat = Engine.STRAT_BY_ID[v.id], built = a.prep.built[v.id];

    const data = arr => bars.map((b, i) => { const x = arr[i]; return x == null || !isFinite(x) ? { time: b.time } : { time: b.time, value: x }; });
    const line = (onOsc, arr, color, opts) => {
      const host = onOsc ? osc : c.MC;
      const s = host.addLineSeries(Object.assign({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, opts || {}));
      s.setData(data(arr));
      (onOsc ? 오실시리즈 : c._indSeries).push(s);
    };

    built.overlay.forEach(o => {
      if (o.type === "line") line(false, o.data, COL[o.color] || o.color);
      else if (o.type === "st") {
        line(false, o.data.line.map((x, i) => o.data.dir[i] === 1 ? x : null), COL.long);
        line(false, o.data.line.map((x, i) => o.data.dir[i] === -1 ? x : null), COL.short);
      } else if (o.type === "bb") {
        line(false, o.data.upper, COL.violet, { lineWidth: 1 });
        line(false, o.data.mid, COL.accent, { lineWidth: 1, lineStyle: 2 });
        line(false, o.data.lower, COL.violet, { lineWidth: 1 });
      } else if (o.type === "band") {
        line(false, o.upper, COL.teal, { lineWidth: 1 }); line(false, o.lower, COL.teal, { lineWidth: 1 });
      } else if (o.type === "dots") {
        line(false, o.data, COL.accent, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.6 });
      }
    });

    const g = built.osc;
    let title = "";
    const guide = (val, color) => line(true, bars.map(() => val), color || COL.line, { lineWidth: 1, lineStyle: 2 });
    if (g.type === "rsi") { guide(70, COL.long); guide(30, COL.short); guide(50); line(true, g.data, COL.accent, { lastValueVisible: true }); title = "RSI 14"; }
    else if (g.type === "macd") {
      const h = osc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      h.setData(bars.map((b, i) => { const x = g.data.hist[i]; return x == null ? { time: b.time } : { time: b.time, value: x, color: x >= 0 ? "rgba(214,69,69,.5)" : "rgba(58,111,216,.5)" }; }));
      오실시리즈.push(h);
      line(true, g.data.line, COL.accent, { lastValueVisible: true }); line(true, g.data.signal, COL.blue, { lineWidth: 1 });
      title = "MACD 12/26/9";
    } else if (g.type === "stoch") { guide(80, COL.long); guide(20, COL.short); line(true, g.data.K, COL.accent, { lastValueVisible: true }); line(true, g.data.D, COL.blue, { lineWidth: 1 }); title = "스토캐스틱 14/3/3"; }
    else if (g.type === "cci") { guide(100, COL.long); guide(-100, COL.short); guide(0); line(true, g.data, COL.accent, { lastValueVisible: true }); title = "CCI 20"; }
    if (head) head.textContent = title;

    if (범위해제) 범위해제();
    const ts = c.MC.timeScale(), 맞추기 = r => { if (r) osc.timeScale().setVisibleLogicalRange(r); };
    ts.subscribeVisibleLogicalRangeChange(맞추기);
    범위해제 = () => { try { ts.unsubscribeVisibleLogicalRangeChange(맞추기); } catch (e) {} };
    맞추기(ts.getVisibleLogicalRange());

    const 방향 = d => d === 1 ? "롱" : "숏";
    const ms = [];
    v.trades.forEach(t => {
      const eb = bars[t.entryIdx], xb = bars[t.exitIdx];
      if (!eb || !xb) return;
      ms.push({ time: eb.time, position: t.dir === 1 ? "belowBar" : "aboveBar", shape: t.dir === 1 ? "arrowUp" : "arrowDown",
        color: t.dir === 1 ? COL.long : COL.short, text: 방향(t.dir) });
      ms.push({ time: xb.time, position: t.dir === 1 ? "aboveBar" : "belowBar", shape: "circle", color: t.reason === "stop" ? COL.gray : COL.accent,
        text: (t.reason === "stop" ? "손절 " : "청산 ") + (t.pnl >= 0 ? "+" : "") + (t.pnl * 100).toFixed(1) + "%" });
    });
    if (v.open && bars[v.open.idx]) ms.push({ time: bars[v.open.idx].time, position: v.open.dir === 1 ? "belowBar" : "aboveBar",
      shape: v.open.dir === 1 ? "arrowUp" : "arrowDown", color: v.open.dir === 1 ? COL.long : COL.short, text: 방향(v.open.dir) + " 보유" });
    if (v.pending) ms.push({ time: bars[bars.length - 1].time, position: "aboveBar", shape: "circle", color: COL.accent,
      text: v.pending.type === "exit" ? "청산 대기" : 방향(v.pending.dir) + " 대기" });
    ms.sort((x, y) => x.time - y.time);
    c.CS.setMarkers(ms);

    let lv = null;
    const atr = a.context.atr || 0;
    if (v.open) {
      const risk = Math.abs(v.open.entry - v.open.stop), d = v.open.dir;
      lv = { entry: v.open.entry, stop: v.open.stop, tp1: v.open.entry + d * risk * 1.5, tp2: v.open.entry + d * risk * 3 };
    } else if (v.pending && v.pending.type === "enter") {
      const e = bars[bars.length - 1].close, d = v.pending.dir, r = 2.5 * atr;
      lv = { entry: e, stop: e - d * r, tp1: e + d * r * 1.5, tp2: e + d * r * 3 };
    }
    const pl = (price, color, t, style, width) => {
      if (isFinite(price)) c._indLines.push(c.CS.createPriceLine({ price, color, lineWidth: width || 1, lineStyle: style, axisLabelVisible: true, title: t }));
    };
    if (lv) { pl(lv.entry, COL.accent, "지표 진입", 0, 2); pl(lv.stop, COL.gray, "지표 손절", 1); pl(lv.tp1, COL.accent, "1차 목표", 1); pl(lv.tp2, COL.accent, "2차 목표", 1); }

    if (card) {
      const [cl, cc] = 신뢰도(v.stats), x = a.context, f = n => n == null ? "—" : n.toFixed(1), dp = c.dp();
      const 상태문구 = v.open
        ? "<b>" + 방향(v.open.dir) + " 보유</b> · 진입 " + v.open.entry.toFixed(dp) + " · 평가 " + (v.open.unreal >= 0 ? "+" : "") + (v.open.unreal * 100).toFixed(2) + "%"
        : v.pending ? "<b>" + (v.pending.type === "exit" ? "청산 신호" : 방향(v.pending.dir) + " 신호") + "</b> · 다음 봉 시가 체결 가정"
        : '<b class="ind-dim">관망</b>';
      card.innerHTML =
        '<div class="ind-cell"><span class="ind-k">현재 국면</span><b>' + esc(Engine.REGIME_NAME[a.regime] || "—") + '</b><span class="ind-dim">ADX ' + f(x.adx) + " · +DI " + f(x.pdi) + " / −DI " + f(x.mdi) + "</span></div>"
        + '<div class="ind-cell"><span class="ind-k">' + (v.auto ? "자동 적용 지표" : "선택 지표") + "</span><b>" + esc(strat.name) + '</b><span class="ind-dim">' + esc(strat.kind + " · " + strat.desc) + "</span></div>"
        + '<div class="ind-cell"><span class="ind-k">워크포워드 검증 (표본 밖)</span><b>' + 통계문구(v.stats) + '</b><span><span class="ind-pill ' + cc + '">' + cl + "</span></span></div>"
        + '<div class="ind-cell"><span class="ind-k">지표 상태</span><span>' + 상태문구 + '</span><span class="ind-dim">확정 봉 신호 · 다음 봉 시가 체결 · 수수료 0.05% · 2.5×ATR 손절 · 롱/숏</span></div>';
    }
  }

  window.indicatorRefresh = indicatorRefresh;

  document.addEventListener("change", e => {
    if (e.target && e.target.id === "ind-sel") {
      선택 = e.target.value;
      try { localStorage.setItem("claudechart_indicator", 선택); } catch (err) {}
      indicatorRefresh(true);
    }
  });

  indicatorRefresh(true);
})();
