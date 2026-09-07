// 腾讯云开发(CloudBase) HTTP 云函数（Web 函数模式）
//
// 整站部署架构：
//   浏览器(国内IP) → CloudBase 静态托管(前端) → 跨域请求网关域名
//                  → HTTP 网关(/api/*) → 本 Web 函数(大陆IP, :9000)
//                  → 江苏平台 https://mskzkt.jse.edu.cn
//
// ⚠️ 关键：CloudBase HTTP 云函数是 Web 函数，必须监听 9000 端口，
//    不可用 exports.main 返回 {statusCode,body}（那是事件函数写法，会报 443）。
//    本文件须与 scf_bootstrap（模板自带，内容 `node index.js`）一起存在。
//
// 工作机制：收到 /api/{module}/resource/detail/ 或 /api/base/vod/，
//   重写 /api -> /baseApi 后转发到江苏平台，并把响应原样回传（含 CORS 头）。
//   兼容 HTTP 网关两种转发习惯：保留 /api 前缀 或 已去掉 /api 前缀。

const http = require("http");

const TARGET = "https://mskzkt.jse.edu.cn";
const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, "http://localhost");
    let pathname = reqUrl.pathname;

    // 兼容 HTTP 网关：可能保留 /api 前缀，也可能已去掉
    if (pathname.startsWith("/api")) {
      pathname = pathname.replace(/^\/api/, "/baseApi");
    } else {
      pathname = "/baseApi" + pathname;
    }
    const targetUrl = TARGET + pathname + reqUrl.search;

    // 读取请求体
    let body = "";
    for await (const chunk of req) body += chunk;

    // 模拟真实浏览器，规避平台 WAF 的 Referer/来源校验
    const headers = {
      "user-agent": BROWSER_UA,
      referer: TARGET + "/",
      origin: TARGET,
    };
    const ct = req.headers["content-type"];
    if (ct) headers["content-type"] = ct;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });
    const text = await upstream.text();

    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

// HTTP 云函数固定监听 9000
server.listen(9000, "0.0.0.0", () => {
  console.log("video-proxy listening on 9000");
});
