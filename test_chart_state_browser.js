const assert = require('assert');

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
if (!playwrightPath) {
  throw new Error('PLAYWRIGHT_MODULE 환경 변수에 Playwright 모듈 경로가 필요합니다.');
}

const { chromium } = require(playwrightPath);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chart-cell');

    // 첫 번째 차트의 코인과 시간봉, 화면 분할 수를 실제 UI 이벤트로 변경한다.
    await page.locator('.cell-sym').nth(0).fill('FET/USDT');
    await page.locator('.cell-sym').nth(0).press('Enter');
    await page.locator('.cell-tf').nth(0).selectOption('4h');
    await page.locator('#layoutSel').selectOption('4');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chart-cell');

    assert.strictEqual(await page.locator('.chart-cell').count(), 4);
    assert.strictEqual(await page.locator('#layoutSel').inputValue(), '4');
    assert.strictEqual(await page.locator('.cell-sym').nth(0).inputValue(), 'FET/USDT');
    assert.strictEqual(await page.locator('.cell-tf').nth(0).inputValue(), '4h');

    // 8분할로 돌아갔을 때 숨겨졌던 슬롯도 보존되는지 확인한다.
    await page.locator('#layoutSel').selectOption('8');
    await page.locator('.cell-sym').nth(7).fill('TAO/USDT');
    await page.locator('.cell-sym').nth(7).press('Enter');
    await page.locator('.cell-tf').nth(7).selectOption('12h');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chart-cell');

    assert.strictEqual(await page.locator('.chart-cell').count(), 8);
    assert.strictEqual(await page.locator('.cell-sym').nth(7).inputValue(), 'TAO/USDT');
    assert.strictEqual(await page.locator('.cell-tf').nth(7).inputValue(), '12h');

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('claude_chart_state_v1')));
    assert.strictEqual(saved.charts[0].symbol, 'FET/USDT');
    assert.strictEqual(saved.charts[7].symbol, 'TAO/USDT');

    console.log('브라우저 새로고침 후 차트별 코인·시간봉·분할 설정 복원 검증 통과');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
