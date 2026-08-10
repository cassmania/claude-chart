/**
 * level_analyzer.js 자체 검증. 실행: node test_level_analyzer.js
 */
const assert = require('assert');
const LevelEngine = require('./level_analyzer.js');

let 통과 = 0;
function 검증(이름, fn) {
    try { fn(); 통과++; console.log(`  OK  ${이름}`); }
    catch (e) { console.error(`  FAIL ${이름}\n       ${e.message}`); process.exitCode = 1; }
}

/** 가격 경로를 캔들로. vol을 주면 그 가격대 거래량을 키워 매물대를 만든다. */
function 캔들(경로, opt = {}) {
    const { 무거운구간 = null, 기본볼륨 = 100, 무거운볼륨 = 5000 } = opt;
    return 경로.map(p => {
        let v = 기본볼륨;
        if (무거운구간 && p >= 무거운구간[0] && p <= 무거운구간[1]) v = 무거운볼륨;
        return { high: p * 1.002, low: p * 0.998, close: p, volume: v };
    });
}

/** from~to 를 n등분한 가격 경로 */
function 경로(from, to, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(from + (to - from) * (i / (n - 1)));
    return out;
}

console.log('\n[1] 입력 방어');

검증('현재가 0이면 error', () => {
    const r = LevelEngine.analyze({ '1h': 캔들(경로(100, 110, 40)) }, 0);
    assert.ok(r.error, 'error가 있어야 한다');
});

검증('현재가 NaN이면 error', () => {
    const r = LevelEngine.analyze({ '1h': 캔들(경로(100, 110, 40)) }, NaN);
    assert.ok(r.error);
});

검증('캔들 없으면 error', () => {
    const r = LevelEngine.analyze({}, 100);
    assert.ok(r.error);
});

검증('캔들 20개 미만이면 해당 봉 제외', () => {
    const r = LevelEngine.analyze({ '1h': 캔들(경로(100, 110, 5)) }, 105);
    assert.ok(r.error, '전부 부족하면 error');
});

검증('가격 전부 동일하면 error (range 0)', () => {
    const flat = Array.from({ length: 40 }, () => ({ high: 100, low: 100, close: 100, volume: 10 }));
    const r = LevelEngine.analyze({ '1h': flat }, 100);
    assert.ok(r.error, 'range 0은 산출 불가');
});

검증('거래량 전부 0이어도 죽지 않는다', () => {
    const z = 경로(100, 120, 40).map(p => ({ high: p * 1.002, low: p * 0.998, close: p, volume: 0 }));
    const r = LevelEngine.analyze({ '1h': z }, 110);
    // vpvr은 null이지만 스윙·마지노선·피보로 레벨은 나와야 한다
    assert.ok(!r.error, 'error 없어야 함: ' + r.error);
    assert.ok(r.resistance.length + r.support.length > 0, '레벨이 하나는 나와야 한다');
});

검증('high<low 뒤집힌 캔들 자동 교정', () => {
    const bad = 경로(100, 120, 40).map(p => ({ high: p * 0.998, low: p * 1.002, close: p, volume: 10 }));
    const r = LevelEngine.analyze({ '1h': bad }, 110);
    assert.ok(!r.error);
});

검증('null/undefined 캔들 섞여도 건너뛴다', () => {
    const mixed = [...캔들(경로(100, 120, 40)), null, undefined, { high: 'x', low: 'y' }];
    const r = LevelEngine.analyze({ '1h': mixed }, 110);
    assert.ok(!r.error);
});

console.log('\n[2] VPVR');

검증('POC가 거래량 몰린 가격대에 잡힌다', () => {
    // 100~120 왕복하되 108~112 구간만 거래량 50배
    const 왕복 = [...경로(100, 120, 30), ...경로(120, 100, 30)];
    const c = 캔들(왕복, { 무거운구간: [108, 112] });
    const prof = LevelEngine.vpvr(c.map(x => ({ h: x.high, l: x.low, c: x.close, v: x.volume })), 24);
    assert.ok(prof, 'prof 있어야 함');
    assert.ok(prof.poc >= 106 && prof.poc <= 114, `POC ${prof.poc}가 108~112 근처여야 한다`);
});

검증('VAL <= POC <= VAH 불변식', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const prof = LevelEngine.vpvr(c.map(x => ({ h: x.high, l: x.low, c: x.close, v: x.volume })), 24);
    assert.ok(prof.val <= prof.poc + 1e-9, `VAL ${prof.val} <= POC ${prof.poc}`);
    assert.ok(prof.poc <= prof.vah + 1e-9, `POC ${prof.poc} <= VAH ${prof.vah}`);
});

검증('HVN 3개 이하, 전부 구간 내부', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const norm = c.map(x => ({ h: x.high, l: x.low, c: x.close, v: x.volume }));
    const prof = LevelEngine.vpvr(norm, 24);
    assert.ok(prof.hvn.length <= 3, 'HVN 최대 3개');
    prof.hvn.forEach(n => assert.ok(n >= prof.low && n <= prof.high, `HVN ${n} 구간 밖`));
});

console.log('\n[3] 스윙 피벗');

검증('명확한 산봉우리를 스윙고점으로 잡는다', () => {
    const 경로산 = [...경로(100, 120, 15), ...경로(120, 105, 15)];
    const norm = 캔들(경로산).map(x => ({ h: x.high, l: x.low, c: x.close, v: x.volume }));
    const sw = LevelEngine.swings(norm, 2);
    assert.ok(sw.high.length > 0, '스윙고점이 있어야 한다');
    assert.ok(Math.max(...sw.high) > 119, `최고 스윙 ${Math.max(...sw.high)}가 120 근처여야`);
});

검증('단조 상승이면 중간 스윙고점 없음', () => {
    const norm = 캔들(경로(100, 200, 40)).map(x => ({ h: x.high, l: x.low, c: x.close, v: x.volume }));
    const sw = LevelEngine.swings(norm, 2);
    assert.strictEqual(sw.high.length, 0, '단조 상승엔 로컬 고점이 없다');
});

console.log('\n[4] 지지·저항 분리 (스킬 핵심 규칙)');

검증('저항은 전부 현재가 위, 지지는 전부 아래', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c }, 112);
    r.resistance.forEach(x => assert.ok(x.price > 112, `저항 ${x.price} > 112`));
    r.support.forEach(x => assert.ok(x.price < 112, `지지 ${x.price} < 112`));
});

검증('저항은 가까운 순 오름차순, 지지는 내림차순', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c, '1d': c }, 112);
    for (let i = 1; i < r.resistance.length; i++) {
        assert.ok(r.resistance[i].price >= r.resistance[i - 1].price, '저항 오름차순');
    }
    for (let i = 1; i < r.support.length; i++) {
        assert.ok(r.support[i].price <= r.support[i - 1].price, '지지 내림차순');
    }
});

검증('구간 최고 위에서는 저항 공백 경고', () => {
    const c = 캔들(경로(100, 120, 40));
    const r = LevelEngine.analyze({ '1h': c }, 500);
    assert.strictEqual(r.resistance.length, 0, '위에 벽이 없어야 한다');
    assert.ok(r.경고.some(w => w.includes('저항 공백')), '경고에 저항 공백: ' + JSON.stringify(r.경고));
});

검증('구간 최저 아래에서는 지지 공백 경고', () => {
    const c = 캔들(경로(100, 120, 40));
    const r = LevelEngine.analyze({ '1h': c }, 10);
    assert.strictEqual(r.support.length, 0);
    assert.ok(r.경고.some(w => w.includes('지지 공백')));
});

검증('직상/직하가 각 배열 첫 원소와 같다', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c }, 112);
    if (r.resistance.length) assert.strictEqual(r.직상.price, r.resistance[0].price);
    if (r.support.length) assert.strictEqual(r.직하.price, r.support[0].price);
});

console.log('\n[5] 다중 타임프레임 겹침 강도');

검증('4개 봉이 같은 레벨이면 4중 겹침', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c, '12h': c, '1d': c }, 112);
    const 최강 = [...r.resistance, ...r.support].filter(x => x.tfCount === 4);
    assert.ok(최강.length > 0, '동일 캔들 4봉이면 4중 겹침이 나와야 한다');
    assert.strictEqual(최강[0].strength.rank, 4);
    assert.ok(최강[0].strength.label.includes('4중'), 최강[0].strength.label);
});

검증('겹침 수가 많을수록 점수가 높다', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const 단일 = LevelEngine.analyze({ '1h': c }, 112);
    const 사중 = LevelEngine.analyze({ '1h': c, '4h': c, '12h': c, '1d': c }, 112);
    const s1 = Math.max(...[...단일.resistance, ...단일.support].map(x => x.score));
    const s4 = Math.max(...[...사중.resistance, ...사중.support].map(x => x.score));
    assert.ok(s4 > s1, `4중 점수 ${s4} > 단일 ${s1}`);
});

검증('타임프레임 1개면 겹침 판정 불가 경고', () => {
    const c = 캔들(경로(100, 130, 40));
    const r = LevelEngine.analyze({ '1h': c }, 115);
    assert.ok(r.경고.some(w => w.includes('겹침 강도 판정 불가')), JSON.stringify(r.경고));
});

검증('상위 봉 가중치가 하위 봉보다 크다', () => {
    assert.ok(LevelEngine.TF_WEIGHT['1d'] > LevelEngine.TF_WEIGHT['4h']);
    assert.ok(LevelEngine.TF_WEIGHT['4h'] > LevelEngine.TF_WEIGHT['1h']);
});

검증('POC 가중치가 피보나치보다 크다 (스킬 우선순위)', () => {
    assert.ok(LevelEngine.KIND_WEIGHT.POC > LevelEngine.KIND_WEIGHT.VA);
    assert.ok(LevelEngine.KIND_WEIGHT.VA > LevelEngine.KIND_WEIGHT.HVN);
    assert.ok(LevelEngine.KIND_WEIGHT.HVN > LevelEngine.KIND_WEIGHT.스윙);
    assert.ok(LevelEngine.KIND_WEIGHT.스윙 > LevelEngine.KIND_WEIGHT.피보);
});

console.log('\n[6] 마지노선');

검증('마지노선은 전 봉 최저 중 가장 낮은 값', () => {
    const 얕은 = 캔들(경로(110, 130, 40));
    const 깊은 = 캔들(경로(80, 130, 40));
    const r = LevelEngine.analyze({ '1h': 얕은, '1d': 깊은 }, 120);
    assert.strictEqual(r.마지노선.tf, '1d', '더 깊은 봉이 마지노선');
    assert.ok(r.마지노선.price < 82, `마지노선 ${r.마지노선.price}가 80 근처여야`);
});

검증('천장은 전 봉 최고 중 가장 높은 값', () => {
    const 낮은 = 캔들(경로(100, 120, 40));
    const 높은 = 캔들(경로(100, 160, 40));
    const r = LevelEngine.analyze({ '1h': 낮은, '1d': 높은 }, 110);
    assert.strictEqual(r.천장.tf, '1d');
    assert.ok(r.천장.price > 159);
});

검증('마지노선 근접 시 경고', () => {
    const c = 캔들(경로(100, 130, 40));
    const r = LevelEngine.analyze({ '1h': c, '4h': c }, 99.9);
    assert.ok(r.경고.some(w => w.includes('마지노선')), JSON.stringify(r.경고));
});

console.log('\n[7] 근거 문자열');

검증('근거에 타임프레임과 종류가 들어간다', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c }, 112);
    const 전체 = [...r.resistance, ...r.support];
    assert.ok(전체.length > 0);
    전체.forEach(x => {
        assert.ok(typeof x.reason === 'string' && x.reason.length > 0, '근거 문자열 필요');
    });
    const poc행 = 전체.find(x => x.hasPOC);
    if (poc행) assert.ok(poc행.reason.includes('POC'), 'POC 행 근거에 POC 표기: ' + poc행.reason);
});

검증('근거 타임프레임 순서가 1h -> 1d', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1d': c, '1h': c, '4h': c }, 112);
    const 다중 = [...r.resistance, ...r.support].find(x => x.tfCount === 3);
    if (다중) {
        const i1 = 다중.reason.indexOf('1h');
        const i4 = 다중.reason.indexOf('4h');
        const id = 다중.reason.indexOf('1d');
        assert.ok(i1 < i4 && i4 < id, '봉 순서 1h<4h<1d: ' + 다중.reason);
    }
});

console.log('\n[8] limit');

검증('limit 개수를 넘지 않는다', () => {
    const c = 캔들([...경로(100, 130, 40), ...경로(130, 105, 30)], { 무거운구간: [115, 120] });
    const r = LevelEngine.analyze({ '1h': c, '4h': c, '12h': c, '1d': c }, 112, { limit: 3 });
    assert.ok(r.resistance.length <= 3, `저항 ${r.resistance.length} <= 3`);
    assert.ok(r.support.length <= 3);
});

console.log(`\n총 ${통과}개 검증 통과${process.exitCode ? ' (실패 있음)' : ''}\n`);
