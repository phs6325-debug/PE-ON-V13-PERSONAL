import { useEffect, useMemo, useState } from "react";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const today = () => new Date().toISOString().slice(0, 10);

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeRecord = (record) => ({
  id: record?.id || Date.now(),
  date: record?.date || today(),
  lesson: Number(record?.lesson || record?.period || 0) || 0,
  content: record?.activity || record?.content || "",
  note: record?.note || "",
});

export default function Progress() {
  const [records, setRecords] = useState(() => {
    const saved = safeParse(localStorage.getItem("peon_progress"), {});
    const next = {};
    classes.forEach((cls) => {
      next[cls] = (saved[cls] || []).map(normalizeRecord);
    });
    return next;
  });

  const [activeTab, setActiveTab] = useState("status");
  const [historyClass, setHistoryClass] = useState("all");
  const [selected, setSelected] = useState(null);
  const [editId, setEditId] = useState(null);
  const [date, setDate] = useState(today());
  const [lesson, setLesson] = useState(1);
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    localStorage.setItem("peon_progress", JSON.stringify(records));
  }, [records]);

  const latest = (cls) => (records[cls] || [])[0];
  const maxLesson = Math.max(0, ...classes.map((cls) => latest(cls)?.lesson || 0));

  const allHistory = useMemo(() => {
    const list = [];
    classes.forEach((cls) => {
      (records[cls] || []).forEach((record) => list.push({ cls, ...record }));
    });
    return list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id));
  }, [records]);

  const filteredHistory = historyClass === "all" ? allHistory : allHistory.filter((r) => r.cls === historyClass);

  const openForm = (cls, record = null) => {
    setSelected(cls);
    setEditId(record?.id || null);
    setDate(record?.date || today());
    setLesson(Number(record?.lesson || 1));
    setContent(record?.content || "");
    setNote(record?.note || "");
  };

  const closeForm = () => {
    setSelected(null);
    setEditId(null);
    setDate(today());
    setLesson(1);
    setContent("");
    setNote("");
  };

  const saveRecord = () => {
    if (!selected) return;
    if (!content.trim()) {
      alert("수업 활동 내용을 입력해 주세요.");
      return;
    }

    const record = {
      id: editId || Date.now(),
      date,
      lesson: Math.max(1, Number(lesson) || 1),
      content: content.trim(),
      note: note.trim(),
    };

    setRecords((prev) => {
      const list = prev[selected] || [];
      const nextList = editId ? list.map((item) => (item.id === editId ? record : item)) : [record, ...list];
      return { ...prev, [selected]: nextList.sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)) };
    });

    closeForm();
  };

  const deleteRecord = (cls, id) => {
    if (!confirm("이 수업 기록을 삭제할까요?")) return;
    setRecords((prev) => ({ ...prev, [cls]: (prev[cls] || []).filter((item) => item.id !== id) }));
  };

  const lessonState = (record) => {
    if (!record?.lesson) return "none";
    const gap = maxLesson - record.lesson;
    if (gap <= 0) return "good";
    if (gap === 1) return "warn";
    return "danger";
  };

  const printStatusPdf = () => {
    const rows = classes
      .map((cls) => {
        const r = latest(cls);
        return `<tr><td>${cls}</td><td>${r?.date || "-"}</td><td>${r?.lesson ? `${r.lesson}차시` : "미입력"}</td><td>${r?.content || "수업 기록 입력"}</td><td>${r?.note || ""}</td></tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>PE-ON 진도현황</title><style>body{font-family:Arial,'Noto Sans KR',sans-serif;padding:28px;color:#111827}h1{font-size:24px;margin:0 0 8px}p{color:#6b7280;margin:0 0 24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:10px;text-align:left;font-size:13px;vertical-align:top}th{background:#eff6ff}td:first-child{font-weight:800;color:#2563eb}@media print{button{display:none}}</style></head><body><h1>PE-ON 진도현황</h1><p>${today()} 저장</p><table><thead><tr><th>학급</th><th>최근 날짜</th><th>차시</th><th>수업 활동 내용</th><th>유의사항</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return alert("팝업 차단을 해제해 주세요.");
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="page progress-page progress-v10-page">
      <div className="progress-v10-title-row">
        <div>
          <h2>📚 진도관리</h2>
          <p>수업 기록을 입력하고, 반별 진도 현황과 이력을 확인합니다.</p>
        </div>
      </div>

      <div className="progress-v10-tabs" role="tablist" aria-label="진도 메뉴">
        <button className={activeTab === "status" ? "active" : ""} onClick={() => setActiveTab("status")}>진도현황</button>
        <span>|</span>
        <button className={activeTab === "input" ? "active" : ""} onClick={() => setActiveTab("input")}>진도입력</button>
        <span>|</span>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>진도이력</button>
      </div>

      {activeTab === "status" && (
        <section className="progress-v10-panel">
          <div className="progress-v10-panel-head">
            <div>
              <h2>진도현황</h2>
            </div>
            <button className="progress-v10-pdf-btn" onClick={printStatusPdf}>PDF 저장</button>
          </div>

          <div className="progress-v10-status-table">
            <div className="progress-v10-status-header">
              <span>학급</span><span>최근 날짜</span><span>차시</span><span>수업 활동 내용</span><span>상태</span>
            </div>
            {classes.map((cls) => {
              const r = latest(cls);
              const state = lessonState(r);
              return (
                <button key={cls} className={`progress-v10-status-row ${state}`} onClick={() => openForm(cls, r || null)}>
                  <strong>{cls}</strong>
                  <span>{r?.date || "-"}</span>
                  <span className="progress-v10-lesson-badge">{r?.lesson ? `${r.lesson}차시` : "미입력"}</span>
                  <span className="progress-v10-content-text">{r?.content || "수업 기록 입력"}</span>
                  <span className="progress-v10-state-text">{state === "none" ? "입력 필요" : state === "good" ? "진행" : state === "warn" ? "확인" : "지연"}</span>
                  <span className="progress-v10-edit-icon" aria-hidden="true">✏️</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "input" && (
        <section className="progress-v10-panel">
          <div className="progress-v10-panel-head">
            <div>
              <h2>진도입력</h2>
            </div>
          </div>
          <div className="progress-v10-class-grid">
            {classes.map((cls) => {
              const r = latest(cls);
              return (
                <button key={cls} className="progress-v10-class-card" onClick={() => openForm(cls)}>
                  <strong>{cls}</strong>
                  <span>{r?.lesson ? `${r.lesson}차시` : "미입력"}</span>
                  <p>{r?.content || "수업 기록을 입력해 주세요"}</p>
                  <small>{r?.date || "-"}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "history" && (
        <section className="progress-v10-panel">
          <div className="progress-v10-history-top left-filter">
            <label className="progress-v10-history-filter">학급 선택
              <select value={historyClass} onChange={(e) => setHistoryClass(e.target.value)}>
                <option value="all">전체</option>
                {classes.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
              </select>
            </label>
            <h2>진도이력</h2>
          </div>

          <div className="progress-v10-history-list">
            {filteredHistory.length === 0 && <div className="progress-v10-empty">저장된 진도 이력이 없습니다.</div>}
            {filteredHistory.map((r) => (
              <article key={`${r.cls}-${r.id}`} className="progress-v10-history-card">
                <div className="progress-v10-history-meta">
                  <strong>{r.cls}</strong>
                  <span>{r.lesson ? `${r.lesson}차시` : "미입력"}</span>
                  <time>{r.date}</time>
                </div>
                <p>{r.content}</p>
                {r.note && <small>유의사항: {r.note}</small>}
              </article>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <div className="modal-bg progress-modal-overlay">
          <div className="modal progress-modal peon-popup-modal progress-v10-modal">
            <div className="progress-modal-header">
              <h2>{selected} 수업 기록</h2>
              <button className="modal-close-x" type="button" onClick={closeForm} aria-label="닫기">×</button>
            </div>
            <div className="progress-modal-body progress-v10-modal-body">
              <label className="progress-label">📅 날짜</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

              <label className="progress-label">📖 차시</label>
              <div className="progress-v10-lesson-stepper">
                <button type="button" onClick={() => setLesson((v) => Math.max(1, Number(v) - 1))}>−</button>
                <strong>{lesson}차시</strong>
                <button type="button" onClick={() => setLesson((v) => Number(v) + 1)}>＋</button>
              </div>

              <label className="progress-label">📝 수업 활동 내용</label>
              <textarea className="progress-content-input" placeholder={"예) 배구 언더핸드 패스\n2인 1조 연습\n미니게임 실시"} value={content} onChange={(e) => setContent(e.target.value)} />

              <label className="progress-label">📌 유의사항</label>
              <textarea className="progress-note-input" placeholder="수업태도, 안전지도, 준비물, 특이사항 등" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="progress-btn-row progress-modal-actions progress-v10-save-row">
              <button
                type="button"
                className="progress-delete-btn"
                onClick={() => {
                  if (!editId) {
                    alert("삭제할 수업 기록이 없습니다.");
                    return;
                  }
                  deleteRecord(selected, editId);
                  closeForm();
                }}
              >
                🗑 삭제
              </button>
              <button className="progress-save-btn" onClick={saveRecord}>💾 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
