// 밸런스 수치는 모두 여기서 관리한다. 금액 단위는 원.
export const CONFIG = {
  rounds: 5,
  startCash: 500_000,
  startItems: 2,
  lotsPerRound: 4,

  // 단계별 제한 시간(초). 모두 준비 완료를 누르면 일찍 넘어간다.
  phaseTime: {
    market: 20,
    auction: 30,
    trade: 80,
    settle: 12,
  },

  minBidRate: 0.5, // 경매 최소 입찰가 = 시세 × 비율
  bidStep: 5_000,

  appraisalCost: 10_000,
  guaranteeTokens: 2,
  falseGuaranteeFine: 0.3, // 보증 위반 시 시세 대비 벌금
  instantSellRate: 0.7,
  tradeFeeRate: 0.05, // 직거래로 현금을 받는 쪽이 내는 수수료
  interestRate: 0.05,
  interestCap: 20_000,

  offerTtl: 20,
  maxPendingOffers: 3,

  priceDrift: 0.05,
  priceClamp: 0.25,
  lastRoundClamp: 0.1,
  finalWeight: 0.7, // 최종 평가 = 마지막 시세 × 0.7 + 직전 시세 × 0.3

  condition: {
    odds: { normal: 0.65, defect: 0.25, broken: 0.1 },
    mult: { normal: 1, defect: 0.6, broken: 0.25 },
  },
  fakeOdds: 0.1,
  fakeOddsAlert: 0.25,
  fakeMult: 0.2,

  // 같은 시리즈의 서로 다른 진품을 n종 모으면 그 물건들의 가치에 붙는 보너스
  setBonus: [0, 0, 0.2, 0.6, 1.0],

  goalBonus: {
    collector: 100_000,
    networker: 80_000,
    dealer: 80_000,
  },
  networkerPartners: 3,
  dealerTrades: 4,
  collectorCount: 3,

  eventChance: 0.85,
  eventEffect: {
    newRelease: 0.75,
    collectorBoom: 1.3,
  },
} as const;

export type Condition = keyof typeof CONFIG.condition.mult;
