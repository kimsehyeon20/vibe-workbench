import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 사이트가 /<저장소이름>/apps/ontology-studio/ 아래에서 열리므로 상대 경로(base: './') 필수
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
});
