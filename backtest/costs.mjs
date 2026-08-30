/**
 * 백테스트 거래비용 계산을 한 곳에 모은 순수 함수입니다.
 * 기본값 0.0006은 한 방향당 수수료 0.04%와 슬리피지 0.02%의 합입니다.
 */
export function 거래비용(entry, exit, oneWayRate = 0.0006) {
  if (!(entry > 0) || !(exit > 0) || !(oneWayRate >= 0)) return null;
  return entry * oneWayRate + exit * oneWayRate;
}

/** 진입 명목가를 1로 보았을 때 비용 차감 순수익률입니다. */
export function 비용차감수익률(entry, exit, side, oneWayRate = 0.0006) {
  const cost = 거래비용(entry, exit, oneWayRate);
  if (cost === null || (side !== 1 && side !== -1)) return null;
  return side * (exit - entry) / entry - cost / entry;
}
