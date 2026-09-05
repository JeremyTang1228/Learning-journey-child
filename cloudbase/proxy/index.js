// 腾讯云开发(CloudBase)云函数：代理江苏智慧教育平台视频接口。
//
// 整站部署架构（推荐）：
//   浏览器(国内IP) → CloudBase 静态托管(前端) + 同域 /api/* 路由
//                  → 本云函数(大陆IP) → 江苏平台 https://mskzkt.jse.edu.cn
// 全部在 CloudBase 同一域名、同一大陆节点，无需 CORS、无需 Netlify 中转。
//
// 部署要点：
//   1. 新建云函数（运行环境 Node.js 16+），把本文件作为入口（index.js）。
//   2. 为该函数据创建「HTTP 触发 / HTTP 访问服务」，并把路径 /api/* 映射到本函数。
//      （控制台：云函数 → 新建 video-proxy → 上传本文件；HTTP 访问服务 → 添加路径映射 /api/* → video-proxy）
//   3. 部署后前端 fetch('/api/...') 即同域命中本函数，转发到江苏平台拿播放凭证。
//
// 工作机制：
//   收到 /api/{module}/resource/detail/ 或 /api/base/vod/，
//   重写为 /baseApi/... 后转发到 https://mskzkt.jse.edu.cn 。
//   路径里即使带了函数名前缀（如 /video-proxy/api/...）也能正确截取 /api 段。
const TARGET = "https://mskzkt.jse.edu.cn";

const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

exports.main = async (event, context) => {
  try {
    const method = (event.httpMethod || "GET").toUpperCase();

    // 兼容不同挂载方式：从路径中定位 /api 段，忽略函数名前缀
    const rawPath = event.path || "/";
    const idx = rawPath.indexOf("/api");
    const apiPath = idx >= 0 ? rawPath.slice(idx) : rawPath;
    const path = apiPath.replace(/^\/api/, "/baseApi");

    const qs = event.queryString || {};
    const q = Object.keys(qs)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(qs[k])}`)
      .join("&");
    const targetUrl = TARGET + path + (q ? "?" + q : "");

    // 尽量模拟真实浏览器请求，规避平台 WAF 的来源/Referer 校验
    const headers = {
      "user-agent": BROWSER_UA,
      referer: TARGET + "/",
      origin: TARGET,
    };
    const ct = event.headers && event.headers["content-type"];
    if (ct) headers["content-type"] = ct;

    let body;
    if (method !== "GET" && method !== "HEAD" && event.body) {
      body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
    }

    const resp = await fetch(targetUrl, { method, headers, body });
    const text = await resp.text();

    const outHeaders = {
      "content-type": resp.headers.get("content-type") || "application/json",
    };

    return {
      statusCode: resp.status,
      headers: outHeaders,
      body: text,
      isBase64Encoded: false,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: String(e) }),
      isBase64Encoded: false,
    };
  }
};
