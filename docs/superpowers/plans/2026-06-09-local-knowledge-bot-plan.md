# Local Knowledge Bot — Implementation Plan (hand-off)

> **สถานะ:** ดีไซน์ approve แล้ว (brainstorm 2026-06-09) · แผนย่อสำหรับส่งต่อให้ทีมทำต่อทีละ phase
> **เป้าหมาย:** แทน Codex ด้วยบอทถาม-ตอบความรู้องค์กรที่ "ช่วยๆ กันสอน" ทำงานออฟไลน์ 100% ส่งต่อกันเป็นไฟล์เดียว

---

## 1. สรุปดีไซน์ (locked)

- **ลบ Codex** → provider ใหม่ `'local'`
- **kb-server/** = Python server แยก process (`127.0.0.1:8770`), spawn แบบเดียวกับ miku-server (`run.bat` + IPC `kb:*` + `window.claudedeck.kb`)
- **Retrieval-first, LLM-optional (DLC):**
  - ชั้น 1 Retrieval (ทุกเครื่อง ไม่ต้อง GPU) = hybrid semantic(e5-small) + keyword(BM25) + confidence threshold
  - ชั้น 2 Ollama (optional) = เรียบเรียงคำตอบให้ลื่นขึ้น ถ้าเจอ `localhost:11434`
- **Knowledge Pack** = ไฟล์ SQLite เดียว (`.ckpack`) ส่งกันได้
- **Local Bot view** (Activity Bar) accessible-first: แท็บ ถามบอท / สอนบอท / จัดการ Pack
- **ไม่มี role/PIN** (ใครก็สอนได้) แต่มี provenance + soft-delete + verified flag กันป่วน

### Pre-mortem ที่ "ต้องฝังตั้งแต่แรก" (retrofit ยาก)
| # | ปัญหาจริง | กันไว้ใน |
|---|---|---|
| 1 | ออฟไลน์โหลด embedding model ไม่ได้ | **bundle โมเดลมากับ kb-server** (P1) |
| 2 | บอทมั่นใจแต่ตอบผิด | confidence threshold + "ไม่แน่ใจ→ถามหัวหน้า" (P2) |
| 3 | ไทย/ศัพท์เฉพาะค้นไม่เจอ | hybrid semantic+BM25 + หลายสำนวนต่อคำตอบ (P2) |
| 4 | สอนผิด/ป่วน ไม่รู้ใครทำ | author + soft-delete + verified flag (P3) |
| 5 | ความรู้เก่าค้าง | lastReviewed + ป้าย "เก่า N เดือน" (P3) |
| 6 | ไฟล์ pack พัง/หาย | atomic write/WAL + auto-backup + integrity check (P3) |
| 7 | ส่งข้ามเครื่องแล้วค้นมั่ว | meta(embModel,schemaVersion) + **re-embed/migrate on mismatch** (P3) |
| 8 | บอทไม่รู้ → ถามหัวหน้าเหมือนเดิม | **unanswered-question log** (P2, value loop หลัก) |
| + | STT สอนเพี้ยน | อ่านทวนก่อนเซฟ (P2) |
| + | สอนแล้วไม่รู้ได้ผลไหม | "ลองถามทันที" หลังสอน (P2) |

---

## 2. สถาปัตยกรรม

```
ClaudeDeck (Electron renderer)
  Activity Bar → [Local Bot] view (ถาม/สอน/จัดการ)
        │ window.claudedeck.kb  (IPC kb:*)
  electron/main.ts ── spawn ──► kb-server/  127.0.0.1:8770  (Python)
                                  ├─ embedding: multilingual-e5-small (bundled, CPU)
                                  ├─ retrieval: semantic + BM25 + threshold
                                  ├─ endpoints: /kb/ask /teach /import-doc /pack/* /merge /unanswered /health
                                  └─ Ollama? (optional) → rephrase
                                          ▼
                          Knowledge Pack  (.ckpack = SQLite)
```

### Pack schema (`.ckpack`, SQLite)
```sql
meta(key TEXT PRIMARY KEY, value TEXT)            -- name, embModel, schemaVersion, isMaster
entries(
  id TEXT PRIMARY KEY,        -- UUID ถาวร (ใช้ merge ด้วย id)
  question TEXT, answer TEXT, source TEXT,
  author TEXT, verified INTEGER DEFAULT 0,
  embedding BLOB,             -- float32 ของ e5-small
  created_at TEXT, updated_at TEXT, last_reviewed TEXT,
  deleted INTEGER DEFAULT 0   -- soft delete
)
phrasings(entry_id TEXT, text TEXT, embedding BLOB)  -- หลายสำนวนต่อ 1 คำตอบ
unanswered(id TEXT, question TEXT, asked_at TEXT, count INTEGER)
```

### API contract (kb-server, JSON over HTTP localhost)
| Method | Path | In | Out |
|---|---|---|---|
| POST | `/kb/ask` | `{query, packId}` | `{answer, confidence, source, author, candidates[], usedLlm}` หรือ `{lowConfidence:true}` |
| POST | `/kb/teach` | `{question, answer, source?, author}` | `{id, duplicateOf?}` |
| POST | `/kb/import-doc` | `{packId, fileBytes, type}` | `{added, chunks}` |
| POST | `/kb/pack/export` | `{packId, path}` | `{ok, path}` |
| POST | `/kb/pack/import` | `{path, mode:"merge"|"replace"}` | `{added, updated, conflicts[]}` |
| POST | `/kb/merge/resolve` | `{conflictId, choice}` | `{ok}` |
| GET | `/kb/unanswered` | — | `{items[]}` |
| GET | `/kb/health` | — | `{modelLoaded, ollama, packs[]}` |

---

## 3. Phases (แต่ละ phase ship ได้เอง + acceptance)

### Phase 1 — โครง + ลบ Codex + kb-server ว่างๆ ตอบได้
**ทำ**
- ลบ provider `'codex'`: `fixtures.ts` (type `Provider`, MODELS, usage groups), `ModelPicker.tsx`, `UsageView.tsx` → ใส่ `'local'`
- สร้าง `kb-server/` (`server.py`, `run.bat`, `requirements.txt`) — HTTP บน 8770, **bundle e5-small** ลง repo/installer
- electron: spawn/stop kb-server (mirror miku ใน `main.ts`) + IPC `kb:*` + preload `window.claudedeck.kb` + `settings/kbServer.ts`
- `/kb/teach` + `/kb/ask` แบบ semantic ล้วน + SQLite pack เดี่ยว
- Local Bot view + Activity Bar entry: แท็บ "ถามบอท" + "สอนบอท" ขั้นพื้นฐาน

**Acceptance:** เครื่องไม่มีเน็ต → start kb-server ได้, สอน 1 คู่แล้วถามได้คำตอบถูก, ModelPicker/Usage ไม่มี Codex แล้ว, ทดสอบผ่าน (retrieval ranking, ModelPicker ไม่มี codex)

### Phase 2 — ความแม่น + value loop + accessibility
**ทำ**
- hybrid retrieval (semantic + BM25) + **confidence threshold** → ต่ำกว่าเกณฑ์ตอบ "ไม่แน่ใจ ลองถามหัวหน้า"
- **unanswered log** + แท็บ/ลิสต์ให้หัวหน้าดูคำถามที่ตอบไม่ได้
- สอนด้วยเสียง (reuse STT เดิม) + **อ่านทวนก่อนเซฟ**
- อัปไฟล์ .txt/.md/.pdf → chunk → teach (จำกัดขนาด/หน้า + progress)
- accessible: aria-live สถานะ, พูดระดับความมั่นใจ, ปุ่มอ่านออกเสียงคำตอบ + ที่มา, "ลองถามทันที" หลังสอน
- Ollama optional: detect + rephrase (ปิดได้)

**Acceptance:** ถามคำถามนอกคลัง → ได้ "ไม่แน่ใจ" + ถูกบันทึกใน unanswered, ศัพท์เฉพาะ/โค้ดค้นเจอด้วย keyword, ใช้งานครบด้วยคีย์บอร์ด+screen reader, มี Ollama → คำตอบลื่นขึ้น/ไม่มีก็ยังตอบครบ

### Phase 3 — ส่งต่อ pack + กันพัง + accountability
**ทำ**
- export/import pack + **merge (UUID set-union)** + **review queue** สำหรับ conflict (เก็บเดิม/ใหม่/ทั้งคู่/รวม)
- จัดการ Pack: สร้าง/สลับ/เปลี่ยนชื่อ/ลบ/นับข้อ/ตั้ง master
- กันพัง: atomic write + WAL + **auto-backup N เวอร์ชัน** + integrity check ตอนเปิด
- **re-embed + schema migrate on mismatch** (เปิด pack ต่างเวอร์ชันได้)
- provenance (author) + **soft-delete + กู้คืน** + **verified flag** (จัดอันดับ/แสดงก่อน)
- ความรู้เก่า: lastReviewed + ป้ายเตือน

**Acceptance:** export จากเครื่อง A → import merge ที่ B, conflict เข้า review queue ตัดสินใจได้, ทำไฟล์ pack พังครึ่งทาง → กู้จาก backup ได้, เปิด pack ที่ embModel ต่าง → re-embed อัตโนมัติแล้วค้นถูก

---

## 4. Out of scope (ภายหลัง, retrofit ง่าย)
- สอนจากแชต (แก้คำตอบผิดระหว่างใช้) · contribute-back ของลูกน้อง
- แชร์ LAN/โฟลเดอร์อัตโนมัติ (pack กลางสด) · role/PIN
- ดัชนี ANN ตอน pack ใหญ่หลายพันข้อ (MVP scan ตรงๆ พอ — ออกแบบ table ให้สลับ index ได้)
- เข้ารหัส pack / ข้อมูลลับ (MVP: เตือน "อย่าใส่ความลับ") · dashboard สุขภาพความรู้

## 5. Tech notes
- embedding: `intfloat/multilingual-e5-small` (~120MB, CPU, ไทยโอเค) — prefix `query:` / `passage:` ตามสเปกโมเดล
- BM25: `rank_bm25` หรือ FTS5 ของ SQLite (เลี่ยง dep เพิ่ม → FTS5 ดีกว่า)
- ออกแบบ retrieval ให้ swap index ได้ (interface `Retriever`) เผื่อเปลี่ยนเป็น sqlite-vss/faiss ตอน scale
- ทุก endpoint คืน error envelope สม่ำเสมอ; renderer แสดง error ที่ผู้พิการทางสายตาเข้าถึงได้
