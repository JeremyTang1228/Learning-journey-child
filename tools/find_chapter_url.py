import urllib.request, ssl, re
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent":"Mozilla/5.0","Referer":"https://basic.jiangsu.smartedu.cn/cloudCourse/seyk"})
    return urllib.request.urlopen(req, timeout=15, context=ctx).read().decode("utf-8","ignore")

base = "https://basic.jiangsu.smartedu.cn"
# 抓 cloudCourse/seyk 首页，找 chapter 路由
html = get(base + "/cloudCourse/seyk")
print("len", len(html))
for kw in ["chapterId","chapter_id","seyk","watch","play","courseDetail","/cloudCourse/"]:
    idxs = [m.start() for m in re.finditer(kw, html)]
    if idxs:
        i = idxs[0]
        print(f"[{kw}] x{len(idxs)} ::", html[max(0,i-60):i+80].replace("\n"," "))
