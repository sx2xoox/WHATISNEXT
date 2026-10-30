# 직거래 프로토타입 v0.2

기획서 [docs/05-jikgeorae.md](../docs/05-jikgeorae.md)의 MVP-1입니다. 1인칭 토론장에서 5라운드를 플레이합니다.

- **혼자 하기**: 성격이 다른 NPC 3명과 브라우저 안에서 플레이합니다.
- **온라인**: 방을 만들면 4글자 방 코드와 초대 링크가 나옵니다. 2~4명이 들어오고, 빈자리는 NPC로 채울 수 있습니다.

NPC의 성격은 게임이 끝나면 공개됩니다.

## 온라인으로 실행

```bash
npm install
npm run build
npm start
```

- `http://localhost:8080`을 열고 **방 만들기**를 누릅니다. 포트는 `PORT` 환경 변수로 바꿀 수 있습니다.
- 대기실의 **링크 복사**로 친구에게 초대 링크를 보내면, 친구는 이름만 넣고 참가하면 됩니다.
- 같은 와이파이의 친구는 내 PC의 IP 주소(`http://192.168.x.x:8080`)로 들어올 수 있습니다.
## 인터넷에 올리기 (Render, 무료)

저장소 루트의 `render.yaml`에 설정이 들어 있습니다.

1. https://render.com 에 GitHub 계정으로 로그인합니다.
2. **New → Blueprint**를 누르고 `sx2xoox/WHATISNEXT` 저장소를 고릅니다.
3. **Apply**를 누르면 5분쯤 뒤 `https://jikgeorae-xxxx.onrender.com` 같은 주소가 생깁니다.

무료 플랜은 15분 동안 아무도 없으면 잠들고, 다음 접속 때 깨어나는 데 1분쯤 걸립니다. 컨테이너 호스팅(Fly.io, Railway, Cloud Run)을 쓰려면 `jikgeorae/Dockerfile`을 쓰면 됩니다.

## 개발

```bash
npm run dev:server   # 게임 서버 (8080)
npm run dev          # 화면 개발 서버. /ws 요청은 게임 서버로 넘깁니다
npm test             # 엔진 테스트 14개 + 멀티플레이 서버 테스트 6개
```

## 조작

- 화면을 드래그하면 둘러볼 수 있습니다.
- 직거래 단계에서 상대 캐릭터를 클릭하거나 아래 버튼을 누르면 거래 제안 창이 열립니다.
- 모든 단계에서 **준비 완료**를 누르면, 모두가 준비된 순간 다음 단계로 넘어갑니다.
- 온라인에서는 내 자리 패널의 **빠른 대화** 버튼으로 말하면 상대 화면에 내 캐릭터 말풍선이 뜹니다. 거래 제안에 붙인 한마디와 수락도 말풍선으로 보입니다.
- 새로고침하거나 연결이 끊겨도 같은 브라우저라면 원래 자리로 자동으로 돌아옵니다. 15초 넘게 끊겨 있으면 그 단계는 준비 완료로 처리해 다른 사람이 기다리지 않게 합니다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/core/config.ts` | 모든 밸런스 수치 |
| `src/core/items.ts` | 시리즈 5개, 물건 20종 |
| `src/core/types.ts` | 게임 상태, 명령, 결과 타입 |
| `src/core/engine.ts` | 규칙의 유일한 권한자. `dispatch()`, `tick()`, 정산, 시세, 점수 |
| `src/core/view.ts` | 플레이어별로 볼 수 있는 정보만 걸러냄 |
| `src/core/bots.ts` | NPC. 사람과 똑같이 `viewFor()`와 `dispatch()`만 사용 |
| `src/shared/protocol.ts` | 클라이언트와 서버가 주고받는 메시지 |
| `server/room.ts` | 방 하나: 대기실, 시작, 명령 처리, NPC, 플레이어별 화면 전송, 재접속 |
| `server/index.ts` | 정적 파일 + WebSocket(`/ws`) 서버, 방 코드 발급, 빈 방 정리 |
| `src/client/source.ts` | 혼자 하기(브라우저 안 엔진)와 온라인(WebSocket)을 같은 방식으로 다룸 |
| `src/client/menu.ts` | 시작 화면, 방 만들기·참가, 대기실 |
| `src/client/scene.ts` | Three.js 1인칭 토론장, 캐릭터, 물건 모형, 말풍선 |
| `src/client/ui.ts` | 시세판, 내 자리, 단계별 패널, 거래 제안 창 |
| `tests/engine.test.ts` | 경매, 직거래 원자성, 중복 요청, 이중 판매, 보증, 정산 테스트 |
| `tests/server.test.ts` | 방 생성·참가, 방장 권한, 정보 숨김, 네트워크 직거래, 재접속, NPC 채우기 |
| `scripts/sim.ts` | NPC 4명으로 여러 판을 돌리는 밸런스 점검 |

밸런스 점검:

```bash
npx esbuild scripts/sim.ts --bundle --platform=node --format=esm --outfile=/tmp/jsim.mjs && node /tmp/jsim.mjs 20
```

## 온라인 구조

1. 서버가 방마다 `GameState`를 들고 0.1초마다 `tick()`과 NPC를 돌립니다.
2. 클라이언트는 `{ cmdId, cmd }`를 보내고, 서버는 `dispatch()` 결과를 그 사람에게만 돌려줍니다. 같은 `cmdId`가 다시 와도 한 번만 처리됩니다.
3. 상태가 바뀌거나 0.5초가 지나면 각 사람에게 `viewFor(그 사람)`만 보냅니다. 다른 사람의 현금, 입찰액, 감정 결과, 받은 제안은 아예 전송되지 않습니다.
4. 접속할 때 받은 토큰을 브라우저에 저장해 두고, 다시 접속하면 같은 자리로 돌려보냅니다. 시작한 방에는 토큰 없이 들어올 수 없습니다.
