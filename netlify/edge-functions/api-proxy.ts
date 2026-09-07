// Netlify Edge Function：透明转发同源 /api/* 到腾讯云开发(CloudBase)代理函数。
//
// 为什么绕一道：江苏智慧教育平台的 WAF 按来源 IP 封杀了 Netlify / Vercel 等
// 云厂商出口 IP，本函数若直连 mskzkt.jse.edu.cn 会被 403。故改为把请求转发到
// CloudBase（大陆 IP、同属腾讯云）部署的代理函数，由它代请求，从而绕过 WAF。
//
// CloudBase 函数自身完成 /api -> /baseApi 重写与上游代理（见 cloudbase/proxy/index.js）。
//
// 目标地址通过下方 TARGET 常量配置（拿到 CloudBase 的 HTTP 触发 URL 后替换此处）。
const TARGET = "__CLOUDBASE_PROXY_URL__";

export default async function handler(req: Request): Promise<Response> {
  if (!TARGET || TARGET.startsWith("__")) {
    return new Response("未配置 CLOUDBASE_PROXY_URL（请在 api-proxy.ts 填入 CloudBase 的 HTTP 触发 URL）", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const targetUrl = TARGET.replace(/\/$/, "") + url.pathname + url.search;

  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const method = req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  const upstream = await fetch(targetUrl, { method, headers, body });

  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("access-control-allow-origin");
  respHeaders.delete("access-control-allow-credentials");

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
