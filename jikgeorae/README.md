# 직거래 프로토타입 v0.1

기획서 [docs/05-jikgeorae.md](../docs/05-jikgeorae.md)의 MVP-0입니다. 사람 1명과 성격이 다른 NPC 3명이 1인칭 토론장에서 5라운드를 플레이합니다. NPC의 성격은 게임이 끝나면 공개됩니다.

## 실행

```bash
npm install
npm run dev
```

```bash
npm test
```

## 조작

- 화면을 드래그하면 둘러볼 수 있습니다.
- 직거래 단계에서 상대 캐릭터를 클릭하거나 아래 버튼을 누르면 거래 제안 창이 열립니다.
- 모든 단계에서 **준비 완료**를 누르면, 모두가 준비된 순간 다음 단계로 넘어갑니다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/core/config.ts` | 모든 밸런스 수치 |
| `src/core/items.ts` | 시리즈 5개, 물건 20종 |
| `src/core/types.ts` | 게임 상태, 명령, 결과 타입 |
| `src/core/engine.ts` | 규칙의 유일한 권한자. `dispatch()`, `tick()`, 정산, 시세, 점수 |
| `src/core/view.ts` | 플레이어별로 볼 수 있는 정보만 걸러냄 |
| `src/core/bots.ts` | NPC. 사람과 똑같이 `viewFor()`와 `dispatch()`만 사용 |
| `src/client/scene.ts` | Three.js 1인칭 토론장, 캐릭터, 물건 모형, 말풍선 |
| `src/client/ui.ts` | 시세판, 내 자리, 단계별 패널, 거래 제안 창 |
| `tests/engine.test.ts` | 경매, 직거래 원자성, 중복 요청, 이중 판매, 보증, 정산 테스트 |
| `scripts/sim.ts` | NPC 4명으로 여러 판을 돌리는 밸런스 점검 |

밸런스 점검:

```bash
npx esbuild scripts/sim.ts --bundle --platform=node --format=esm --outfile=/tmp/jsim.mjs && node /tmp/jsim.mjs 20
```

## 다음 단계: 온라인

`src/core/`는 DOM에 의존하지 않으므로 그대로 Node 서버에서 돌릴 수 있습니다.

1. 서버가 `GameState`를 들고 `tick()`을 돌립니다.
2. 클라이언트는 `{ cmdId, cmd }`를 WebSocket으로 보내고, 서버는 `dispatch()` 결과를 돌려줍니다.
3. 서버는 상태가 바뀔 때마다 각 클라이언트에 `viewFor(그 플레이어)`만 보냅니다.
4. 재접속하면 같은 플레이어 번호로 최신 `viewFor()`를 다시 받습니다.
