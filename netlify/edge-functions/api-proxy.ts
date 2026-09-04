// Netlify Edge Function：将同源 /api/* 反代到江苏智慧教育平台，
// 复刻 vite.config.ts 中 server.proxy 的映射（/api -> /baseApi），
// 使前端在纯静态托管（Netlify）下也能用 TCPlayer 在 App 内直接播放视频。
//
// 已通过 curl 验证：
//   POST /api/seyk/resource/detail/  -> { state:0, data.resource_info.file_id }
//   POST /api/base/vod/              -> { state:0, data.app_id, data.psign }
// 平台接口无登录/CORS 要求，无需附带 Cookie。
const TARGET = "https://mskzkt.jse.edu.cn";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 复刻 vite rewrite：/api/xxx -> /baseApi/xxx
  const path = url.pathname.replace(/^\/api/, "/baseApi") + url.search;
  const targetUrl = TARGET + path;

  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  // 模拟同源，规避可能的 Referer 防盗链校验（实测无 Referer 亦可，带上更稳）
  headers.set("referer", TARGET + "/");
  headers.set("origin", TARGET);

  const method = req.method;
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  const upstream = await fetch(targetUrl, { method, headers, body });

  // 透传上游响应，移除 CORS 头（同源代理无需，避免浏览器误判）
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("access-control-allow-origin");
  respHeaders.delete("access-control-allow-credentials");

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
