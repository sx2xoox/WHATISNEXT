export type SeriesId = 'retro' | 'figure' | 'audio' | 'camera' | 'street';

export interface Series {
  id: SeriesId;
  name: string;
  electronic: boolean;
  color: number;
}

export interface ItemType {
  id: string;
  name: string;
  series: SeriesId;
  base: number;
}

export const SERIES: Record<SeriesId, Series> = {
  retro: { id: 'retro', name: '레트로 게임', electronic: true, color: 0xe8524a },
  figure: { id: 'figure', name: '피규어', electronic: false, color: 0x9b6bff },
  audio: { id: 'audio', name: '빈티지 오디오', electronic: true, color: 0xf2a33a },
  camera: { id: 'camera', name: '필름 카메라', electronic: true, color: 0x3fb6a8 },
  street: { id: 'street', name: '스트릿 패션', electronic: false, color: 0x4f8ef7 },
};

export const SERIES_IDS = Object.keys(SERIES) as SeriesId[];

export const ITEM_TYPES: ItemType[] = [
  { id: 'gameboy', name: '휴대용 게임기', series: 'retro', base: 90_000 },
  { id: 'cartridge', name: '카트리지 묶음', series: 'retro', base: 50_000 },
  { id: 'padset', name: '오리지널 패드', series: 'retro', base: 40_000 },
  { id: 'limitedconsole', name: '한정판 게임기', series: 'retro', base: 160_000 },

  { id: 'robot', name: '로봇 피규어', series: 'figure', base: 70_000 },
  { id: 'anime', name: '애니 피규어', series: 'figure', base: 60_000 },
  { id: 'limitedfig', name: '한정판 피규어', series: 'figure', base: 150_000 },
  { id: 'plamodel', name: '미개봉 프라모델', series: 'figure', base: 50_000 },

  { id: 'cassette', name: '카세트 플레이어', series: 'audio', base: 60_000 },
  { id: 'turntable', name: '턴테이블', series: 'audio', base: 130_000 },
  { id: 'lpset', name: 'LP 묶음', series: 'audio', base: 70_000 },
  { id: 'tubeamp', name: '진공관 앰프', series: 'audio', base: 180_000 },

  { id: 'filmcam', name: '필름 카메라', series: 'camera', base: 110_000 },
  { id: 'lens', name: '단렌즈', series: 'camera', base: 80_000 },
  { id: 'instant', name: '즉석카메라', series: 'camera', base: 60_000 },
  { id: 'tripod', name: '빈티지 삼각대', series: 'camera', base: 40_000 },

  { id: 'sneakers', name: '한정판 스니커즈', series: 'street', base: 140_000 },
  { id: 'jacket', name: '빈티지 자켓', series: 'street', base: 80_000 },
  { id: 'cap', name: '콜라보 모자', series: 'street', base: 40_000 },
  { id: 'watch', name: '손목시계', series: 'street', base: 120_000 },
];

export const TYPE_BY_ID: Record<string, ItemType> = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t]));
