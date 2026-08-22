/**
 * 차트 화면 설정 저장 모듈.
 *
 * 서버에는 아무 정보도 보내지 않고 현재 브라우저의 localStorage에만 저장한다.
 * 저장값은 사용자가 직접 수정할 수도 있으므로, 복원 전에 반드시 허용 목록으로 검증한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChartState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_KEY = "claude_chart_state_v1";
  var ALLOWED_LAYOUTS = [1, 2, 4, 6, 8];
  var ALLOWED_TIMEFRAMES = ["1m", "15m", "1h", "4h", "8h", "12h", "1d"];
  var DEFAULT_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT",
    "DOGE/USDT", "ADA/USDT", "BNB/USDT", "AVAX/USDT"
  ];

  function normalizeLayout(value) {
    var number = Number(value);
    return ALLOWED_LAYOUTS.indexOf(number) >= 0 ? number : 8;
  }

  function normalizeTimeframe(value, fallback) {
    var safeFallback = ALLOWED_TIMEFRAMES.indexOf(fallback) >= 0 ? fallback : "1h";
    return ALLOWED_TIMEFRAMES.indexOf(value) >= 0 ? value : safeFallback;
  }

  function normalizeSymbol(value, fallback) {
    var safeFallback = typeof fallback === "string" ? fallback.toUpperCase() : "BTC/USDT";
    var symbol = typeof value === "string" ? value.trim().toUpperCase() : "";

    // 검색창과 동일하게 BTC처럼 기준 통화가 생략되면 USDT를 붙인다.
    if (symbol && symbol.indexOf("/") < 0) symbol += "/USDT";

    // HTML에 다시 표시되는 값이므로 영문 대문자·숫자와 /USDT만 허용한다.
    if (!/^[A-Z0-9]{1,20}\/USDT$/.test(symbol)) return safeFallback;
    return symbol;
  }

  function defaultCharts() {
    return DEFAULT_SYMBOLS.map(function (symbol) {
      return { symbol: symbol, timeframe: "1h" };
    });
  }

  function createDefaultState() {
    return {
      version: 1,
      layout: 8,
      activeChartIdx: 0,
      charts: defaultCharts()
    };
  }

  function normalizeState(value) {
    var defaults = createDefaultState();
    var source = value && typeof value === "object" ? value : {};
    var layout = normalizeLayout(source.layout);
    var sourceCharts = Array.isArray(source.charts) ? source.charts : [];
    var charts = defaults.charts.map(function (fallback, index) {
      var item = sourceCharts[index] && typeof sourceCharts[index] === "object"
        ? sourceCharts[index]
        : {};
      return {
        symbol: normalizeSymbol(item.symbol, fallback.symbol),
        timeframe: normalizeTimeframe(item.timeframe, fallback.timeframe)
      };
    });
    var active = Number.isInteger(source.activeChartIdx) ? source.activeChartIdx : 0;

    // 현재 보이는 차트 범위를 벗어난 활성 위치는 첫 번째 차트로 복구한다.
    if (active < 0 || active >= layout) active = 0;

    return {
      version: 1,
      layout: layout,
      activeChartIdx: active,
      charts: charts
    };
  }

  function load(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : createDefaultState();
    } catch (error) {
      // 손상된 JSON이나 저장소 접근 제한이 차트 실행을 막지 않게 한다.
      return createDefaultState();
    }
  }

  function save(storage, value) {
    var normalized = normalizeState(value);
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      // 브라우저 저장 공간이 차거나 차단돼도 현재 세션의 차트는 계속 동작한다.
    }
    return normalized;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    ALLOWED_LAYOUTS: ALLOWED_LAYOUTS.slice(),
    ALLOWED_TIMEFRAMES: ALLOWED_TIMEFRAMES.slice(),
    createDefaultState: createDefaultState,
    normalizeLayout: normalizeLayout,
    normalizeTimeframe: normalizeTimeframe,
    normalizeSymbol: normalizeSymbol,
    normalizeState: normalizeState,
    load: load,
    save: save
  };
});
