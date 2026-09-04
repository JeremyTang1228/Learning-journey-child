import urllib.request, ssl
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
def get(u, follow=5):
    url = u
    for _ in range(follow):
        req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
        try:
            resp = urllib.request.urlopen(req, timeout=15, context=ctx)
            print("FINAL", resp.status, resp.geturl())
            return resp.read().decode("utf-8","ignore")[:300]
        except urllib.error.HTTPError as e:
            if e.code in (301,302,303,307,308) and e.headers.get("Location"):
                loc = e.headers["Location"]
                url = loc if loc.startswith("http") else "https://basic.jiangsu.smartedu.cn"+loc
                print("REDIR", e.code, "->", url)
            else:
                print("ERR", e.code, e.headers.get("Location")); return ""
    return ""

print(get("https://basic.jiangsu.smartedu.cn/cloudCourse/seyk"))
