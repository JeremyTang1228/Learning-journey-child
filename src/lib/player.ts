// 江苏智慧教育平台视频播放工具。
//
// 平台视频详情页地址示例：
//   https://basic.jiangsu.smartedu.cn/cloudCourse/{sexk|seyk}/detail.php?resource_id=NNN
//
// 当前生效方案：前端经同源 /api 反代拿到播放凭证，用腾讯云 TCPlayer 在 App 内直接播放。
//   - 开发/预览：vite.config.ts 的 server.proxy 将 /api 转发到 https://mskzkt.jse.edu.cn，
//     并将路径由 /api 重写为 /baseApi（changeOrigin: true）。
//   - 生产 (Netlify)：netlify/edge-functions/api-proxy.ts 把 /api 透明转发到腾讯云开发
//     (CloudBase) 代理函数（cloudbase/proxy/index.js），由后者（大陆 IP）代请求江苏平台，
//     绕开其按来源 IP 封杀云厂商出口的 WAF。
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

/**
 * 经 vite 反代获取播放凭证。返回 file_id + app_id + psign。
 * 网络不通或平台异常时抛出可读错误。
 */
export async function fetchPlayInfo(
  module: VideoModule,
  resourceId: string,
): Promise<PlayInfo> {
  const post = async (path: string, body: string) => {
    const resp = await fetch(`/api/${path}`, {
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
