import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 江苏中小学智慧教育平台视频播放 API（无需登录，但跨域无 CORS 头）。
// 通过 Vite 反代把同源 /api/* 转发到平台 /baseApi/*，前端即可实时获取
// file_id + psign 并用腾讯云 TCPlayer 在 App 内直接播放（绕过防盗链 mp4 直链 403）。
const apiProxy = {
  '/api': {
    target: 'https://mskzkt.jse.edu.cn',
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/api/, '/baseApi'),
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, host: true, proxy: apiProxy },
  preview: { port: 4173, host: true, proxy: apiProxy },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
