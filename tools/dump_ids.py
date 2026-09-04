from openpyxl import load_workbook
import urllib.request, ssl

f2 = "/Users/jeremy/Desktop/小学知识成长地图应用/苏e优课_小学一至六年级_语文人教版_英语译林版_知识点与视频索引.xlsx"
wb = load_workbook(f2, data_only=True, read_only=True)
ws = wb["知识点目录汇总"]
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]
print("HEADERS:", list(hdr))
# 打印含 ID 的列
for r in rows[1:4]:
    d = dict(zip(hdr, r))
    print({k: d.get(k) for k in ["年级","学科","册次","单元 / 模块","课时 / 知识点","视频链接","模块","完整路径","目录ID","单元ID","册次ID","课时chapter_id"]})
wb.close()

# 测试封面图 URL 是否可达，并尝试推断视频地址
cover = "http://1258942858.vod2.myqcloud.com/5f629bc5vodtranssh1258942858/fd959ad01397757894742704304/coverBySnapshot/coverBySnapshot_10_0.jpg?t=6a93b11b&us=37ddd18f5c1c59f9aa2f43fc6d241482&sign=77a12fccf158bb9da62634f89a022416"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
for url in [cover]:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent":"Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        print(f"\n[HEAD] {url[:80]}...")
        print("  status:", resp.status, "content-type:", resp.headers.get("Content-Type"), "len:", resp.headers.get("Content-Length"))
    except Exception as e:
        print("  ERR", e)
