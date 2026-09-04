# Master Data 导入校验报告

- 数据源：`小学知识成长地图_Master_Data_V2_内容管理版.xlsx`
- 生成时间：2026-09-01T23:23:08.986Z
- content_version：**1.0**　checksum：`269c5c237629ad4c`

## 数据量

| 表 | 行数 |
|---|---|
| subjects | 10 |
| curriculums | 60 |
| units | 459 |
| knowledge_nodes | 1,572 |
| resources | 5,041 |
| knowledge_relations | 0 |
| school_calendar | 0 |

## 校验结果：**PASS**

- error：**0**　warning：53　note：5

### Warnings（已自动降级，不阻塞）

- ⚠️ 知识点 kn_NbNadfNdfdN 的 title 为空，已回退为单元名「第二单元 始终滴答响」
- ⚠️ 知识点 kn_acNbNdaN 的 title 为空，已回退为单元名「跨学科主题学习」
- ⚠️ 知识点 kn_fNdNbNe 的 title 为空，已回退为单元名「第七单元」
- ⚠️ 知识点 kn_dNeNaNc 的 title 为空，已回退为单元名「第五单元  时空“履”行 （第N课时）」
- ⚠️ 知识点 kn_NaeN 的 title 为空，已回退为单元名「第一单元」
- ⚠️ 知识点 kn_NaNaa 的 title 为空，已回退为单元名「第三单元」
- ⚠️ 知识点 kn_NfNacdN 的 title 为空，已回退为单元名「第二单元」
- ⚠️ 知识点 kn_NeNeNbNd 的 title 为空，已回退为单元名「第三单元」
- ⚠️ 知识点 kn_NcNfNdbaNe 的 title 为空，已回退为单元名「Unit N Where's Kitty」
- ⚠️ 知识点 kn_NdfNdbN 的 title 为空，已回退为单元名「Unit N Dinner is ready!」
- ⚠️ 知识点 kn_cbNdNdeaNcN 的 title 为空，已回退为单元名「Unit N We all like PE!」
- ⚠️ 知识点 kn_NeNbeNcNa 的 title 为空，已回退为单元名「Unit N I have big eyes」
- ⚠️ 知识点 kn_fNdNdNcNa 的 title 为空，已回退为单元名「Unit N Can you?」
- ⚠️ 知识点 kn_edbdNaeNbNef 的 title 为空，已回退为单元名「Unit N Let's go shopping!」
- ⚠️ 知识点 kn_NfNfNbNaN 的 title 为空，已回退为单元名「UnitN Hello!」
- ⚠️ 知识点 kn_bNeeNbcN 的 title 为空，已回退为单元名「UnitN I'm Liu Tao」
- ⚠️ 知识点 kn_NaNbdNaN 的 title 为空，已回退为单元名「UnitN My friends」
- ⚠️ 知识点 kn_NbNbaNfN 的 title 为空，已回退为单元名「UnitN My family」
- ⚠️ 知识点 kn_NaNeaNd 的 title 为空，已回退为单元名「UnitN Look at me」
- ⚠️ 知识点 kn_NbNe 的 title 为空，已回退为单元名「UnitN Colours」
- ⚠️ 知识点 kn_NafNd 的 title 为空，已回退为单元名「UnitN Would you like a pie?」
- ⚠️ 知识点 kn_eNfNbdN 的 title 为空，已回退为单元名「UnitN Happy New Year!」
- ⚠️ 知识点 kn_NbeaNaNbb 的 title 为空，已回退为单元名「Project N」
- ⚠️ 知识点 kn_adN 的 title 为空，已回退为单元名「Project N」
- ⚠️ 知识点 kn_dNbcNaNcNaN 的 title 为空，已回退为单元名「Revision」

## 排序推导说明

Excel 中 `units.sort_order` 与 `knowledge_nodes.sort_order` 全部为 0，已失效。
- 知识点排序改用 `sequence`（同一 unit 内唯一，实测 0 冲突）
- 单元排序改用 `min(该单元下所有知识点的 sequence)` 的密集排名（实测 60 个 curriculum 零冲突）
