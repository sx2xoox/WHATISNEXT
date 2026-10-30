export type CardId = 'shadow' | 'fastforward' | 'sprint' | 'heavy' | 'magnet';

export interface Card {
  id: CardId;
  name: string;
  icon: string;
  desc: string;
}

export const CARDS: Record<CardId, Card> = {
  shadow: { id: 'shadow', name: '내 그림자', icon: '👤', desc: '내 유령은 나를 통과한다' },
  fastforward: { id: 'fastforward', name: '빨리감기', icon: '⏩', desc: '내 유령이 1.5배 빨리 움직인다' },
  sprint: { id: 'sprint', name: '질주', icon: '💨', desc: '대시 쿨타임 40% 감소' },
  heavy: { id: 'heavy', name: '무거운 발걸음', icon: '🦶', desc: '밀치기 +60%, 밀려남 -50%, 이동 -10%' },
  magnet: { id: 'magnet', name: '자석', icon: '🧲', desc: '코인 줍는 범위 1.8배' },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export function drawCards(n: number): CardId[] {
  const pool = [...CARD_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

export function count(cards: CardId[], id: CardId): number {
  let n = 0;
  for (const c of cards) if (c === id) n++;
  return n;
}
