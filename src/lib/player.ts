// 江苏智慧教育平台视频播放工具。
//
// 平台视频详情页地址示例：
//   https://basic.jiangsu.smartedu.cn/cloudCourse/{sexk|seyk}/detail.php?resource_id=NNN
//
// 当前生效方案：前端经 /api 反代拿到播放凭证，用腾讯云 TCPlayer 在 App 内直接播放。
//   - 开发/预览：vite.config.ts 的 server.proxy 将 /api 转发到 https://mskzkt.jse.edu.cn，
//     并将路径由 /api 重写为 /baseApi（changeOrigin: true）。
//   - 生产 (CloudBase 整站)：前端静态托管在 *.tcloudbaseapp.com，视频代理由 CloudBase
//     HTTP 网关（独立域名 *.ap-shanghai.app.tcloudbase.com）上的 video-proxy 云函数承接。
//     该函数为大陆 IP，可绕开江苏平台按来源 IP 封杀云厂商出口（Netlify/Vercel 等）的 WAF。
//     前端依当前 hostname 自动切换 API 基址（见 resolveApiBase）。
//
// 凭证获取流程（前端 fetchPlayInfo 调用）：
//   1. POST /api/{module}/resource/detail/  body: resource_id=NNN -> file_id
//   2. POST /api/base/vod/                   body: file_id=NNN    -> app_id + psign
//   3. TCPlayer('容器ID', { fileID, appID, psign })
//
// 说明：平台接口无 CORS 头、且 mp4 直链防盗链 403，故必须走 /api 反代。早期 iframe 内嵌
// detail.php 的临时方案已弃用。

export type VideoModule = 'sexk' | 'seyk';

export interface PlayInfo {
  fileId: string;
  appId: string;
  psign: string;
}

const TC_SDK_VERSION = 'v4.9.0';
const TC_JS = `https://web.sdk.qcloud.com/player/tcplayer/release/${TC_SDK_VERSION}/tcplayer.${TC_SDK_VERSION}.min.js`;
const TC_CSS = `https://web.sdk.qcloud.com/player/tcplayer/release/${TC_SDK_VERSION}/tcplayer.min.css`;

let sdkLoading: Promise<void> | null = null;

/** 动态加载腾讯云 TCPlayer SDK（仅加载一次）。 */
export function loadTcplayer(): Promise<void> {
  const w = window as unknown as { TCPlayer?: unknown };
  if (w.TCPlayer) return Promise.resolve();
  if (sdkLoading) return sdkLoading;

  sdkLoading = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TC_CSS;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = TC_JS;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('播放器组件加载失败，请检查网络连接'));
    document.head.appendChild(script);
  });
  return sdkLoading;
}

// sexk(苏e新课/数学) 与 seyk(苏e优课/语文英语) 的 detail 接口路径不同
function detailPath(module: VideoModule): string {
  return module === 'sexk'
    ? 'sexk/home/resource/detail/'
    : 'seyk/resource/detail/';
}

// 生产环境视频代理网关完整地址（CloudBase HTTP 网关，大陆 IP）。
// 前端在 *.tcloudbaseapp.com，网关在 *.ap-shanghai.app.tcloudbase.com，二者跨域，
// video-proxy 云函数已返回 CORS: * 允许跨域调用。
const PROD_API_BASE =
  'https://jeremy-app-d1ghili220f92b255-1313498684.ap-shanghai.app.tcloudbase.com/api';

/**
 * 解析 API 基址：
 *  - 构建期注入 VITE_API_BASE 时优先使用（便于切换/本地联调）；
 *  - 生产静态托管域（*.tcloudbaseapp.com）走独立网关域名；
 *  - 开发/预览走 vite server.proxy 同源 /api。
 */
function resolveApiBase(): string {
  const injected = (import.meta.env as Record<string, unknown>).VITE_API_BASE as
    | string
    | undefined;
  if (injected && injected.trim()) return injected.trim();
  if (
    typeof location !== 'undefined' &&
    location.hostname.endsWith('tcloudbaseapp.com')
  ) {
    return PROD_API_BASE;
  }
  return '/api';
}

/**
 * 经 /api 反代获取播放凭证。返回 file_id + app_id + psign。
 * 网络不通或平台异常时抛出可读错误。
 */
export async function fetchPlayInfo(
  module: VideoModule,
  resourceId: string,
): Promise<PlayInfo> {
  const base = resolveApiBase();
  const post = async (path: string, body: string) => {
    const resp = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'omit',
    });
    if (!resp.ok) throw new Error(`平台接口返回 ${resp.status}`);
    return resp.json();
  };

  const detail = await post(detailPath(module), `resource_id=${resourceId}`);
  if (detail?.state !== 0 || !detail?.data?.resource_info?.file_id) {
    throw new Error('未能获取视频信息');
  }
  const fileId = String(detail.data.resource_info.file_id);

  const vod = await post('base/vod/', `file_id=${fileId}`);
  if (vod?.state !== 0 || !vod?.data?.psign) {
    throw new Error('未能获取播放凭证');
  }

  return {
    fileId,
    appId: String(vod.data.app_id),
    psign: String(vod.data.psign),
  };
}

/** 从资源 play_url 解析出模块与 resource_id。 */
export function parsePlayUrl(
  playUrl?: string,
): { module: VideoModule; resourceId: string } | null {
  if (!playUrl) return null;
  const m = playUrl.match(
    /cloudCourse\/(sexk|seyk)\/detail\.php\?resource_id=(\d+)/,
  );
  if (!m) return null;
  return { module: m[1] as VideoModule, resourceId: m[2] };
}

/** 来源平台详情页（错误兜底 / 新窗口打开）。 */
export function sourcePageUrl(
  module: VideoModule,
  resourceId: string,
): string {
  return `https://basic.jiangsu.smartedu.cn/cloudCourse/${module}/detail.php?resource_id=${resourceId}`;
}
