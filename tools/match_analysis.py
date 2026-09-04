import json, re
from openpyxl import load_workbook
from collections import Counter

def norm_subject(s):
    s = str(s or "")
    s = re.sub(r"[（(].*?[)）]", "", s)
    return s.strip()
def norm_text(s):
    s = str(s or "")
    s = re.sub(r"[（(].*?[)）]", "", s)
    s = re.sub(r"[\s~～、，,。.\-—_/]", "", s)
    return s.strip()

# ---- 载入 Master Data 视频资源 ----
B = "/Users/jeremy/WorkBuddy/2026-08-31-17-11-25/src/data/content/"
def load_json(p):
    with open(B+p) as f: return json.load(f)
units = {u["unit_id"]: u for u in load_json("units.json")}
currics = {c["curriculum_id"]: c for c in load_json("curriculums.json")}
subjects = {s["subject_id"]: s for s in load_json("subjects.json")}
# 知识点
kns = {}
for g in ["g1","g2","g3","g4","g5","g6"]:
    for k in load_json(f"knowledge_nodes/{g}.json"):
        kns[k["knowledge_id"]] = k
# 资源 (只取 video)
videos = []
for g in ["g1","g2","g3","g4","g5","g6"]:
    for r in load_json(f"resources/{g}.json"):
        if r.get("resource_type") == "video":
            videos.append(r)
print("MasterData 视频资源总数:", len(videos))
print("  按 (grade,subject) 分布:")
gs = Counter((r.get("grade"), r.get("subject")) for r in videos)
for k,v in sorted(gs.items(), key=lambda x:-x[1]):
    print(f"    {k}: {v}")

# 给每条视频补全 unit/subject 文本 (从知识点->unit->curriculum 推导)
def resolve(r):
    kn = kns.get(r.get("knowledge_id"))
    if not kn: return None
    u = units.get(kn.get("unit_id"))
    if not u: return None
    c = currics.get(u.get("curriculum_id"), {})
    return {"grade": c.get("grade"), "subject": c.get("subject") or c.get("subject_id"),
            "semester": c.get("semester"), "unit": u.get("unit_name"), "title": kn.get("title")}
for r in videos:
    r["_r"] = resolve(r)
matched_any = sum(1 for r in videos if r["_r"])
print("  能解析出 unit/title 的视频:", matched_any)

# ---- 载入 Excel：合并 视频索引(封面图) + 知识点目录汇总(chapter_id/完整路径) ----
def load_excel_video(path):
    wb = load_workbook(path, data_only=True, read_only=True)
    def sheet(name):
        ws = wb[name]; rows = list(ws.iter_rows(values_only=True)); h = rows[0]
        return [dict(zip(h, r)) for r in rows[1:]]
    vi = sheet("视频索引")
    cat = sheet("知识点目录汇总")
    wb.close()
    # 用 (年级,学科,册次,单元/模块,课时/知识点) join
    cat_idx = {}
    for d in cat:
        key = (str(d.get("年级")), norm_subject(d.get("学科")), str(d.get("册次")),
               norm_text(d.get("单元 / 模块")), norm_text(d.get("课时 / 知识点")))
        cat_idx[key] = d
    merged = []
    for d in vi:
        key = (str(d.get("年级")), norm_subject(d.get("学科")), str(d.get("册次")),
               norm_text(d.get("单元 / 模块")), norm_text(d.get("课时 / 知识点")))
        c = cat_idx.get(key, {})
        d.update({
            "课时chapter_id": c.get("课时chapter_id"),
            "完整路径": c.get("完整路径"),
            "视频链接": c.get("视频链接"),
        })
        merged.append(d)
    return merged

f1 = "/Users/jeremy/Desktop/小学知识成长地图应用/苏e新课_小学一至四年级_知识点与课件资源汇总.xlsx"
f2 = "/Users/jeremy/Desktop/小学知识成长地图应用/苏e优课_小学一至六年级_语文人教版_英语译林版_知识点与视频索引.xlsx"
excel_rows = load_excel_video(f1) + load_excel_video(f2)
print("\nExcel 合并后总数:", len(excel_rows))
print("  其中带 chapter_id:", sum(1 for d in excel_rows if d.get("课时chapter_id")))
print("  Excel 按 (年级,学科) 分布:")
ge = Counter((d.get("年级"), d.get("学科")) for d in excel_rows)
for k,v in sorted(ge.items(), key=lambda x:-x[1]):
    print(f"    {k}: {v}")

# 建立 Excel 索引: key=(年级, 学科base, 册次, 单元/模块)
def norm_subject(s):
    s = str(s or "")
    s = re.sub(r"[（(].*?[)）]", "", s)  # 去版本后缀
    return s.strip()
def norm_text(s):
    s = str(s or "")
    s = re.sub(r"[（(].*?[)）]", "", s)
    s = re.sub(r"[\s~～、，,。.\-—_/]", "", s)
    return s.strip()
excel_idx = {}
for d in excel_rows:
    key = (str(d.get("年级")), norm_subject(d.get("学科")), str(d.get("册次")), norm_text(d.get("单元 / 模块")))
    excel_idx.setdefault(key, []).append(d)

# 匹配
def match(r):
    rr = r["_r"]
    if not rr: return None
    base_keys = [
        (rr["grade"], norm_subject(rr["subject"]), rr["semester"], norm_text(rr["unit"])),
    ]
    for key in base_keys:
        if key in excel_idx:
            # 在候选里按 知识点名模糊匹配
            cands = excel_idx[key]
            t = norm_text(rr["title"])
            for c in cands:
                if norm_text(c.get("课时 / 知识点")) == t or norm_text(c.get("视频标题")) == t:
                    return c
            # 退一步：title 包含关系
            for c in cands:
                ct = norm_text(c.get("课时 / 知识点")) or norm_text(c.get("视频标题"))
                if ct and (ct in t or t in ct):
                    return c
    return None

matched = 0
with_chapter = 0
from_ke = 0  # 苏e优课
from_xk = 0  # 苏e新课
unmatched_subj = Counter()
for r in videos:
    m = match(r)
    if m:
        matched += 1
        if m.get("课时chapter_id"):
            with_chapter += 1
            from_ke += 1
        else:
            from_xk += 1
    else:
        rr = r["_r"]
        unmatched_subj[(rr["grade"], rr["subject"])] += 1
print(f"\n=== 匹配结果 ===")
print(f"可匹配视频: {matched} / {len(videos)} = {matched/len(videos)*100:.1f}%")
print(f"  其中带 chapter_id(可播放): {with_chapter}  (来自 苏e优课)")
print(f"  仅封面图无播放ID: {from_xk}  (来自 苏e新课)")
print(f"\n未匹配 {len(videos)-matched} 条，按 (grade,subject) 分布:")
for k,v in sorted(unmatched_subj.items(), key=lambda x:-x[1])[:15]:
    print(f"    {k}: {v}")
