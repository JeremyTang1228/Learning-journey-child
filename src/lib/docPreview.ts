// 腾讯云数据万象(CI) 文档预览 —— 把 .pptx/.docx 等课件转成图片，在 App 内直接预览。
//
// 背景：苏e新课(数学)的课件/教案/作业全部存于腾讯云 COS 公开桶，且已开启 CI：
//   GET {cosUrl}?ci-process=doc-preview&dstType=jpg&srcType={pptx|docx}&page=N  ->  该页 JPEG
//   GET {cosUrl}?ci-process=doc-preview&dstType=pdf&srcType=...                  ->  整本 PDF
// 跨域：响应头 Access-Control-Allow-Origin:*，浏览器 <img> 直显无需 CORS；探测用 fetch 也可。
// 越界页返回 404(application/xml)，可作为明确的「总页数」停止信号。

export interface DocPreviewInfo {
  base: string;
  srcType: string;
  ext: string;
}

/** COS 对象扩展名 → CI doc-preview 的 srcType（仅这些类型可被预览） */
const EXT_TO_SRC: Record<string, string> = {
  pptx: 'pptx',
  ppt: 'ppt',
  docx: 'docx',
  doc: 'doc',
  pdf: 'pdf',
  xlsx: 'xlsx',
  xls: 'xls',
};

/** 判断一个资源 URL 是否可被 App 内预览。返回预览信息，否则 null。 */
export function docPreviewInfo(url?: string): DocPreviewInfo | null {
  if (!url) return null;
  const m = url.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  const ext = m ? m[1].toLowerCase() : '';
  const srcType = EXT_TO_SRC[ext];
  if (!srcType) return null;
  return { base: url, srcType, ext };
}

/** 第 page 页的 JPEG 预览地址（<img> 直显，无需 CORS） */
export function pageImageUrl(base: string, srcType: string, page: number): string {
  return `${base}?ci-process=doc-preview&dstType=jpg&srcType=${srcType}&page=${page}`;
}

/** 整本文档的 PDF 预览/下载地址 */
export function pdfUrl(base: string, srcType: string): string {
  return `${base}?ci-process=doc-preview&dstType=pdf&srcType=${srcType}`;
}

/**
 * 该页是否存在（存在=图片可加载触发 onload；越界=404 触发 onerror）。
 *
 * 必须用 Image 探测，不能用 fetch：
 *   - 跨域 <img> 直显无需 CORS，onload/onerror 都正常触发；
 *   - 曾用 fetch + Range 头探测，但 COS 的 CORS Access-Control-Allow-Headers
 *     不含 Range，浏览器预检 OPTIONS 直接 403，导致所有探测失败、预览永远报错。
 *   - 越界页服务端返回 404(application/xml)，img.onerror 可靠捕获，可作「总页数」停止信号。
 */
function pageExists(base: string, srcType: string, page: number): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    // 仅显示图片无需 CORS；COS 已开放 Access-Control-Allow-Origin:*，普通 <img> 即可直显。
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // 兜底：单个请求挂起时不应永远停在「准备预览」
    const timer = setTimeout(() => finish(false), 20000);
    img.onload = () => {
      clearTimeout(timer);
      finish(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };
    img.src = pageImageUrl(base, srcType, page);
  });
}

/**
 * 探测文档总页数：指数扩张定位上界，再二分收敛最后存在的页。
 * 越界页返回 404 作为明确停止信号。第 1 页都不存在则视为损坏文档返回 0。
 */
export async function probeTotalPages(base: string, srcType: string): Promise<number> {
  if (!(await pageExists(base, srcType, 1))) return 0;

  let lo = 1;
  let hi = 1;
  // 指数扩张上界
  while (await pageExists(base, srcType, hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 256) break; // K12 课件极少超过 256 页
  }
  // 二分求最后一个存在的页
  let last = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await pageExists(base, srcType, mid)) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return last;
}
