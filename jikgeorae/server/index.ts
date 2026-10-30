// 정적 파일(빌드된 클라이언트)과 WebSocket(/ws)을 한 포트에서 제공한다
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { type Conn, Room } from './room';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const ROOM_TTL = 10 * 60; // 아무도 없는 방은 10분 뒤 정리
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface GameServer {
  server: Server;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function createGameServer(staticDir: string | null): GameServer {
  const rooms = new Map<string, Room>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (!staticDir) {
      res.writeHead(404).end();
      return;
    }
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    try {
      let body: Buffer | string = await readFile(join(staticDir, rel));
      const type = MIME[extname(rel)] ?? 'application/octet-stream';
      // 서버를 통해 열면 온라인 기능을 켠다
      if (rel === '/index.html') body = body.toString().replace('<head>', '<head><script>window.__ONLINE__=true</script>');
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    const conn: Conn = {
      send: (msg: ServerMsg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.t === 'create' || msg.t === 'join') {
        if (room) room.leave(conn);
        let target: Room | undefined;
        if (msg.t === 'create') {
          target = new Room(newCode(rooms));
          rooms.set(target.code, target);
        } else {
          target = rooms.get(String(msg.code).toUpperCase().trim());
          if (!target) return conn.send({ t: 'error', message: '없는 방 코드입니다' });
        }
        const seat = target.join(conn, String(msg.name ?? ''), msg.t === 'join' ? msg.token : undefined);
        if (typeof seat === 'string') return conn.send({ t: 'error', message: seat });
        room = target;
        conn.send({ t: 'joined', code: room.code, pid: seat.pid, token: seat.token });
        room.resync();
        return;
      }
      room?.handle(conn, msg);
    });
    ws.on('close', () => room?.leave(conn));
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    for (const [code, room] of rooms) {
      room.update(dt);
      if (room.emptySince && now / 1000 - room.emptySince > ROOM_TTL) rooms.delete(code);
    }
  }, 100);

  return {
    server,
    rooms,
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        for (const c of wss.clients) c.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

function newCode(rooms: Map<string, Room>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

// node dist-server/server.mjs 로 실행할 때
const isMain = process.argv[1]?.endsWith('server.mjs');
if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  const dir = process.env.STATIC_DIR ?? join(process.argv[1], '..', '..', 'dist');
  createGameServer(dir).server.listen(port, () => {
    console.log(`직거래 서버: http://localhost:${port}`);
  });
}
