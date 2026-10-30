import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
  // 개발 중에는 npm run dev:server 로 띄운 게임 서버에 WebSocket을 넘긴다
  server: { proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
