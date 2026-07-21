import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const subjects = ["체육", "스포츠"];
const locations = ["운동장", "체육관", "강당", "다목적실", "교실", "기타"];
const lessonStatuses = ["변동사항 없음", "시간 변경", "시간 교환", "보강", "휴강", "행사", "시험", "학교 행사", "공휴일", "기타"];
const weekNames = ["일", "월", "화", "수", "목", "금", "토"];
const formatLocalDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = () => formatLocalDate(new Date());
const dateKey = (value) => formatLocalDate(value);

const safeParse = (value, fallback) => {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
};

const getUtf8ByteLength = (value) => new TextEncoder().encode(String(value || "")).length;
const limitUtf8Bytes = (value, maxBytes = 500) => {
  const text = String(value || "");
  if (getUtf8ByteLength(text) <= maxBytes) return text;
  let result = "";
  for (const char of text) {
    if (getUtf8ByteLength(result + char) > maxBytes) break;
    result += char;
  }
  return result;
};
const formatDayTitle = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return String(value || "");
  const weekday = weekNames[new Date(year, month - 1, day).getDay()];
  return `${value} (${weekday})`;
};

const normalizeRecord = (record) => ({
  id: record?.id || Date.now(),
  date: record?.date || today(),
  lesson: Number(record?.lesson || record?.period || 0) || 0,
  unit: record?.unit || "",
  content: record?.activity || record?.content || "",
  note: record?.note || "",
  location: record?.location || "",
  subject: record?.subject || "체육",
});


const timetableDays = [1, 2, 3, 4, 5];
const timetablePeriods = [1, 2, 3, 4, 5, 6];
const makeTimetableCellKey = (weekday, period) => `${weekday}-${period}`;
const timetableLabel = (item) => item ? `${item.subject || ""} ${item.cls || ""}`.trim() : "";
const parseTimetableLabel = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(/\s+/g, "");
  const match = normalized.match(/^(.+?)(\d+)-(\d+)$/);
  if (!match) return { raw: text, subject: "", cls: "" };
  return { raw: text, subject: match[1], cls: `${match[2]}-${match[3]}` };
};

const defaultTimetable = [
  { id: 1, weekday: 1, period: 1, subject: "체육", cls: "2-1" },
  { id: 2, weekday: 1, period: 2, subject: "체육", cls: "2-2" },
  { id: 3, weekday: 2, period: 1, subject: "체육", cls: "2-3" },
  { id: 4, weekday: 3, period: 2, subject: "체육", cls: "2-4" },
  { id: 5, weekday: 4, period: 1, subject: "체육", cls: "2-5" },
];

export default function Progress() {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";
  const progressKey = `peon_progress_${year}_${semester}`;
  const timetableKey = `peon_progress_timetable_${year}_${semester}`;
  const overridesKey = `peon_progress_day_overrides_${year}_${semester}`;
  const [records, setRecords] = useState(() => {
    const saved = safeParse(localStorage.getItem(progressKey) || localStorage.getItem("peon_progress"), {});
    const next = {};
    classes.forEach((cls) => { next[cls] = (saved[cls] || []).map(normalizeRecord); });
    return next;
  });
  const [timetable, setTimetable] = useState(() => safeParse(localStorage.getItem(timetableKey) || localStorage.getItem("peon_progress_timetable"), defaultTimetable));
  const [overrides, setOverrides] = useState(() => safeParse(localStorage.getItem(overridesKey) || localStorage.getItem("peon_progress_day_overrides"), {}));
  const [activeTab, setActiveTab] = useState("timetable");
  const [todayOpen, setTodayOpen] = useState(false);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [timetableFocusWeekday, setTimetableFocusWeekday] = useState(null);
  const [timetableDraft, setTimetableDraft] = useState({});
  const [timetableLocationDraft, setTimetableLocationDraft] = useState({});
  const [timetableToast, setTimetableToast] = useState("");
  const timetableInputRefs = useRef({});
  const timetableLocationInputRefs = useRef({});
  const [dayOpen, setDayOpen] = useState(null);
  const [dayDraft, setDayDraft] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState("체육");
  const [editId, setEditId] = useState(null);
  const [date, setDate] = useState(today());
  const [lesson, setLesson] = useState(1);
  const [unit, setUnit] = useState("");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [location, setLocation] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const [firebaseReady, setFirebaseReady] = useState(false);
  const [onlineRevision, setOnlineRevision] = useState(0);
  const lastRemoteJsonRef = useRef("");

  // 기기별 캐시는 항상 유지합니다. 인터넷이 끊겨도 입력한 내용이 사라지지 않습니다.
  useEffect(() => localStorage.setItem(progressKey, JSON.stringify(records)), [records]);
  useEffect(() => localStorage.setItem(timetableKey, JSON.stringify(timetable)), [timetable]);
  useEffect(() => localStorage.setItem(overridesKey, JSON.stringify(overrides)), [overrides]);

  // 로그인 사용자별 진도/시간표 문서를 최초 1회 불러오고 이후 실시간으로 구독합니다.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return undefined;

    let cancelled = false;
    let unsubscribe = () => {};
    const progressRef = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_progress_data`);

    const applyRemote = (data) => {
      const nextRecords = {};
      const remoteRecords = data?.records || {};
      classes.forEach((cls) => {
        nextRecords[cls] = (remoteRecords[cls] || []).map(normalizeRecord);
      });
      const nextTimetable = Array.isArray(data?.timetable) ? data.timetable : defaultTimetable;
      const nextOverrides = data?.overrides && typeof data.overrides === "object" ? data.overrides : {};
      const json = JSON.stringify({ records: nextRecords, timetable: nextTimetable, overrides: nextOverrides });
      lastRemoteJsonRef.current = json;
      setRecords(nextRecords);
      setTimetable(nextTimetable);
      setOverrides(nextOverrides);
    };

    (async () => {
      try {
        const snapshot = await getDoc(progressRef);
        if (cancelled) return;
        if (snapshot.exists()) {
          applyRemote(snapshot.data());
        } else {
          const initialPayload = { records, timetable, overrides, year, semester };
          lastRemoteJsonRef.current = JSON.stringify(initialPayload);
          await setDoc(progressRef, { ...initialPayload, updatedAt: serverTimestamp() }, { merge: true });
        }
      } catch (error) {
        console.warn("진도 Firebase 초기 동기화 실패 - 기기 저장을 사용합니다.", error);
      } finally {
        if (!cancelled) setFirebaseReady(true);
      }

      if (cancelled) return;
      unsubscribe = onSnapshot(
        progressRef,
        (snapshot) => {
          if (snapshot.exists()) applyRemote(snapshot.data());
        },
        (error) => console.warn("진도 Firebase 실시간 동기화 실패", error),
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // 컴포넌트가 열릴 때의 localStorage 값을 Firebase 최초 데이터로 사용합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 변경 사항은 잠깐 모아서 한 번에 Firebase에 저장합니다.
  useEffect(() => {
    if (!firebaseReady) return undefined;
    const user = auth.currentUser;
    if (!user) return undefined;

    const payload = { records, timetable, overrides, year, semester };
    const json = JSON.stringify(payload);
    if (json === lastRemoteJsonRef.current) return undefined;

    const timer = window.setTimeout(async () => {
      try {
        const progressRef = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_progress_data`);
        await setDoc(progressRef, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
        lastRemoteJsonRef.current = json;
      } catch (error) {
        console.warn("진도 Firebase 저장 실패 - 온라인 복구 후 다시 시도합니다.", error);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [records, timetable, overrides, firebaseReady, onlineRevision]);

  // 오프라인 중 저장에 실패했더라도 인터넷이 돌아오면 현재 기기 데이터를 다시 전송합니다.
  useEffect(() => {
    const handleOnline = () => {
      lastRemoteJsonRef.current = "";
      setOnlineRevision((value) => value + 1);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const buildTimetableDraft = (source = timetable) => {
    const draft = {};
    timetableDays.forEach((weekday) => timetablePeriods.forEach((period) => {
      const item = source.find((v) => Number(v.weekday) === weekday && Number(v.period) === period);
      draft[makeTimetableCellKey(weekday, period)] = item ? timetableLabel(item) : "";
    }));
    return draft;
  };

  const buildTimetableLocationDraft = (source = timetable) => {
    const draft = {};
    timetableDays.forEach((weekday) => timetablePeriods.forEach((period) => {
      const item = source.find((v) => Number(v.weekday) === weekday && Number(v.period) === period);
      draft[makeTimetableCellKey(weekday, period)] = item?.location || "";
    }));
    return draft;
  };

  const openTimetableEditor = (focusWeekday = null) => {
    setTimetableDraft(buildTimetableDraft());
    setTimetableLocationDraft(buildTimetableLocationDraft());
    setTimetableFocusWeekday(focusWeekday);
    setTimetableOpen(true);
  };

  const saveTimetableDraft = () => {
    const next = [];
    const invalid = [];
    timetablePeriods.forEach((period) => timetableDays.forEach((weekday) => {
      const key = makeTimetableCellKey(weekday, period);
      // Korean IME composition can finish at the same moment the Save button is clicked.
      // Read the current DOM value first so the last-entered class (for example Monday 5th period) is never dropped.
      const classValue = timetableInputRefs.current[key]?.value ?? timetableDraft[key] ?? "";
      const locationValue = timetableLocationInputRefs.current[key]?.value ?? timetableLocationDraft[key] ?? "";
      const parsed = parseTimetableLabel(classValue);
      if (!parsed) return;
      if (!parsed.subject || !parsed.cls) { invalid.push(classValue); return; }
      next.push({ id: `${weekday}-${period}`, weekday, period, subject: parsed.subject, cls: parsed.cls, location: String(locationValue).trim() });
    }));
    if (invalid.length) {
      alert(`입력 형식을 확인해 주세요.\n과목과 학년-반을 띄어 써 주세요.\n\n확인 필요: ${invalid.join(", ")}`);
      return;
    }
    setTimetable(next);
    setTimetableDraft(buildTimetableDraft(next));
    setTimetableLocationDraft(buildTimetableLocationDraft(next));
    setTimetableOpen(false);
    setTimetableFocusWeekday(null);
    setTimetableToast("기본 시간표가 저장되었습니다.");
    window.setTimeout(() => setTimetableToast(""), 1800);
  };

  const moveTimetableFocus = (weekday, period, key, shiftKey = false) => {
    let nextWeekday = weekday;
    let nextPeriod = period;

    if (key === "Tab" && shiftKey) {
      if (weekday > 1) nextWeekday -= 1;
      else if (period > 1) { nextWeekday = 5; nextPeriod -= 1; }
    } else if (key === "Tab" || key === "ArrowRight") {
      if (weekday < 5) nextWeekday += 1;
      else if (period < 6) { nextWeekday = 1; nextPeriod += 1; }
    } else if (key === "Enter" || key === "ArrowDown") {
      if (period < 6) nextPeriod += 1;
    } else if (key === "ArrowLeft") {
      if (weekday > 1) nextWeekday -= 1;
      else if (period > 1) { nextWeekday = 5; nextPeriod -= 1; }
    } else if (key === "ArrowUp") {
      if (period > 1) nextPeriod -= 1;
    }

    timetableInputRefs.current[makeTimetableCellKey(nextWeekday, nextPeriod)]?.focus();
  };

  const recordsFor = (subject, cls) => (records[cls] || []).filter((record) => (record.subject || "체육") === subject);
  const latest = (subject, cls) => recordsFor(subject, cls)[0];
  const statusRows = subjects.flatMap((subject) => classes.map((cls) => ({ subject, cls })))
    .filter(({ subject, cls }) => timetable.some((item) => item.subject === subject && item.cls === cls) || recordsFor(subject, cls).length);
  const lessonValues = statusRows.map(({ subject, cls }) => latest(subject, cls)?.lesson || 0).filter(Boolean).sort((a, b) => a - b);
  const medianLesson = lessonValues.length ? lessonValues[Math.floor(lessonValues.length / 2)] : 0;

  const scheduleForDate = (isoDate) => {
    const key = dateKey(isoDate);
    if (overrides[key]) return [...overrides[key]].sort((a, b) => a.period - b.period);
    const weekday = new Date(`${key}T12:00:00`).getDay();
    return timetable
      .filter((item) => Number(item.weekday) === weekday)
      .map((item) => ({ ...item, sourceId: item.id, location: item.location || "", status: "변동사항 없음" }))
      .sort((a, b) => a.period - b.period);
  };

  const todaySchedule = scheduleForDate(today());
  const todayCompleted = todaySchedule.filter((item) => recordsFor(item.subject || "체육", item.cls).some((r) => r.date === today() && Number(r.lesson) === Number(item.period))).length;

  const openToday = () => { setActiveTab("timetable"); setTodayOpen(true); };
  const openForm = (subject, cls, record = null, preset = {}) => {
    setSelectedSubject(subject || record?.subject || "체육");
    setSelected(cls);
    setEditId(record?.id || null);
    setDate(record?.date || preset.date || today());
    setLesson(Number(record?.lesson || preset.period || 1));
    setUnit(record?.unit || "");
    setContent(record?.content || "");
    setNote(record?.note || "");
    setLocation(record?.location || preset.location || "");
  };
  const closeForm = () => { setSelected(null); setSelectedSubject("체육"); setEditId(null); setDate(today()); setLesson(1); setUnit(""); setContent(""); setNote(""); setLocation(""); };

  const saveRecord = () => {
    if (!selected) return;
    if (!content.trim()) return alert("수업 활동 내용을 입력해 주세요.");
    const record = { id: editId || Date.now(), subject: selectedSubject, date, lesson: Math.max(1, Number(lesson) || 1), unit: unit.trim(), content: content.trim(), note: note.trim(), location };
    setRecords((prev) => {
      const list = prev[selected] || [];
      const nextList = editId ? list.map((item) => item.id === editId ? record : item) : [record, ...list];
      return { ...prev, [selected]: nextList.sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)) };
    });
    closeForm();
  };

  const deleteRecord = (cls, id) => {
    if (!confirm("이 수업 기록을 삭제할까요?")) return;
    setRecords((prev) => ({ ...prev, [cls]: (prev[cls] || []).filter((item) => item.id !== id) }));
  };

  const updateDayItem = (key, index, patch) => {
    const base = overrides[key] || scheduleForDate(key);
    const next = base.map((item, i) => i === index ? { ...item, ...patch } : item);
    setOverrides((prev) => ({ ...prev, [key]: next }));
  };
  const openDayEditor = (key) => {
    setDayOpen(key);
  };
  const closeDayLessons = () => setDayOpen(null);


  const monthCells = useMemo(() => {
    const y = monthCursor.getFullYear(); const m = monthCursor.getMonth();
    const firstDay = new Date(y, m, 1).getDay(); const lastDate = new Date(y, m + 1, 0).getDate();
    const cells = Array(firstDay).fill(null);
    for (let d = 1; d <= lastDate; d += 1) cells.push(new Date(y, m, d));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [monthCursor]);

  const printStatusPdf = () => {
    const rows = statusRows.map(({ subject, cls }) => { const r = latest(subject, cls); const gap = (r?.lesson || 0) - medianLesson; return `<tr><td>${subject} · ${cls}</td><td>${r?.date || "-"}</td><td>${r?.lesson ? `${r.lesson}차시` : "미입력"}</td><td>${gap > 0 ? `+${gap}` : gap}</td><td>${r?.content || "수업 기록 입력"}</td></tr>`; }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>PE-ON 진도현황</title><style>body{font-family:Arial,'Noto Sans KR',sans-serif;padding:28px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:10px;text-align:left}th{background:#eff6ff}</style></head><body><h1>PE-ON 진도현황</h1><p>기준 차시: ${medianLesson || "-"}</p><table><thead><tr><th>학급</th><th>최근 수업일</th><th>누적 차시</th><th>기준 대비</th><th>최근 수업 내용</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;
    const win = window.open("", "_blank"); if (!win) return alert("팝업 차단을 해제해 주세요."); win.document.write(html); win.document.close();
  };

  return (
    <div className="page progress-page progress-v10-page progress-v13-page">
      <div className="progress-v10-title-row"><div><h2>📚 진도관리</h2></div></div>

      <div className="progress-v10-tabs progress-two-tabs" role="tablist" aria-label="진도 메뉴">
        <button className={activeTab === "timetable" ? "active" : ""} onClick={() => setActiveTab("timetable")}>시간표</button>
        <button className={activeTab === "status" ? "active" : ""} onClick={() => setActiveTab("status")}>진도현황</button>
      </div>

      {activeTab === "timetable" && (
        <>
          <section className="progress-v10-panel progress-timetable-summary-panel">
            <div className="progress-v10-panel-head">
              <div><h2>기본 시간표</h2><p>요일별 수업과 장소를 설정하면 달력에 자동으로 표시됩니다.</p></div>
              <button className="progress-primary-btn" onClick={() => openTimetableEditor()}>시간표 작성</button>
            </div>
            <div className="progress-today-overview">
              <div>
                <strong>오늘 수업</strong>
                <span>{todaySchedule.length ? `${todayCompleted}/${todaySchedule.length} 완료` : "등록된 수업 없음"}</span>
              </div>
              <div className="progress-today-inline-list">
                {todaySchedule.length === 0 ? (
                  <span className="progress-today-inline-empty">기본 시간표에서 오늘 수업을 설정해 주세요.</span>
                ) : todaySchedule.map((item, index) => (
                  <button key={`${item.id}-${index}`} className={`progress-today-inline-item period-${item.period}`} onClick={openToday}>
                    <b>{item.period}교시</b> <span className="calendar-class-name">{item.subject} {item.cls}</span>{item.location ? <span className="calendar-location">{item.location}</span> : null}
                  </button>
                ))}
              </div>
              <button className="progress-outline-btn" onClick={openToday}>오늘 수업 열기</button>
            </div>
          </section>

          <section className="progress-v10-panel progress-calendar-panel">
            <div className="progress-calendar-toolbar">
              <div className="progress-month-nav"><button onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}>‹</button><h2>{monthCursor.getFullYear()}년 {monthCursor.getMonth() + 1}월</h2><button onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}>›</button></div>
            </div>
            <div className="progress-calendar-shell">
              <div className="progress-month-weekdays">{weekNames.map((name) => <span key={name}>{name}</span>)}</div>
              <div className="progress-month-grid">{monthCells.map((cell, index) => {
                if (!cell) return <div key={`blank-${index}`} className="progress-month-cell blank" />;
                const key = dateKey(cell); const schedule = scheduleForDate(key); const isToday = key === today();
                const weekdayTone = cell.getDay() === 0 ? "weekend-sun" : cell.getDay() === 6 ? "weekend-sat" : "";
                const weekday = cell.getDay();
                const canAddBasicLesson = schedule.length === 0 && weekday >= 1 && weekday <= 5;
                return <div role="button" tabIndex={0} aria-label={`${key} 수업 관리`} key={key} className={`progress-month-cell ${weekdayTone} ${isToday ? "today" : ""}`} onClick={() => openDayEditor(key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openDayEditor(key); }}>
                  <span className="progress-day-number">{cell.getDate()}</span>
                  <div className="progress-day-lessons">
                    {schedule.map((item, i) => {
                      const doneRecord = recordsFor(item.subject || "체육", item.cls).find((r) => r.date === key && Number(r.lesson) === Number(item.period));
                      return <button type="button" key={`${item.id}-${i}`} className={`progress-calendar-lesson progress-calendar-lesson-button period-${item.period} ${item.status === "휴강" ? "off" : ""}`} onClick={(e) => { e.stopPropagation(); openForm(item.subject || "체육", item.cls, doneRecord || null, { date: key, period: item.period, location: item.location }); }}><span className="calendar-lesson-main"><b>{item.period}교시</b><span className="calendar-class-name">{item.subject} {item.cls}</span></span></button>;
                    })}
                    {canAddBasicLesson && <button type="button" className="progress-calendar-add-basic" onClick={(e) => { e.stopPropagation(); openTimetableEditor(weekday); }}>＋ 수업 추가</button>}
                  </div>
                </div>;
              })}</div>
            </div>
          </section>
        </>
      )}

      {activeTab === "status" && (
        <section className="progress-v10-panel progress-status-panel">
          <div className="progress-v10-panel-head"><div><h2>진도현황</h2><p>{medianLesson || 0}차시를 기준으로 반별 최근 수업 기록을 비교합니다.</p></div><button className="progress-v10-pdf-btn" onClick={printStatusPdf}>PDF 저장</button></div>
          <div className="progress-status-table-wrap">
            <table className="progress-status-table">
              <thead><tr><th>학급</th><th>단원명</th><th>차시</th><th>최근 활동내용</th><th>유의사항</th><th>확인</th></tr></thead>
              <tbody>{statusRows.map(({ subject, cls }) => { const r = latest(subject, cls); return <tr key={`${subject}-${cls}`}><th>{subject} · {cls}</th><td>{r?.unit || "-"}</td><td>{r?.lesson ? `${r.lesson}차시` : "미입력"}</td><td>{r?.content || "-"}</td><td>{r?.note || "-"}</td><td><button className="progress-status-check-btn" onClick={() => openForm(subject, cls, r || null)}>{r ? "확인" : "입력"}</button></td></tr>; })}</tbody>
            </table>
          </div>
        </section>
      )}

      {todayOpen && (
        <div className="modal-bg progress-modal-overlay"><div className="modal progress-modal peon-popup-modal progress-today-modal">
          <div className="progress-modal-header"><div><h2>📅 오늘 수업</h2><p>{today()} · {todayCompleted}/{todaySchedule.length} 완료</p></div><button className="modal-close-x" onClick={() => setTodayOpen(false)}>×</button></div>
          <div className="progress-today-list">{todaySchedule.length === 0 ? <div className="progress-v10-empty">오늘 수업이 없습니다.</div> : todaySchedule.map((item, index) => {
            const doneRecord = recordsFor(item.subject || "체육", item.cls).find((r) => r.date === today() && Number(r.lesson) === Number(item.period));
            return <article key={`${item.id}-${index}`} className={`progress-today-card ${doneRecord ? "done" : ""} ${item.status === "휴강" ? "off" : ""}`}>
              <div className="progress-today-card-head"><span className="period-pill">{item.period}교시</span><strong>{item.subject} · {item.cls}</strong><span className="status-pill">{doneRecord ? "완료" : item.status}</span></div>
              <div className="progress-today-card-actions"><select value={item.location || ""} onChange={(e) => updateDayItem(today(), index, { location: e.target.value })}><option value="">장소 선택</option>{locations.slice(1).map((v) => <option key={v}>{v}</option>)}</select><button onClick={() => { setTodayOpen(false); openForm(item.subject || "체육", item.cls, doneRecord || null, { date: today(), period: item.period, location: item.location }); }}>{doneRecord ? "진도 수정" : "진도 입력"}</button></div>
            </article>;
          })}</div>
        </div></div>
      )}

      {dayOpen && (() => {
        const daySchedule = scheduleForDate(dayOpen);
        const completed = daySchedule.filter((item) => recordsFor(item.subject || "체육", item.cls).some((r) => r.date === dayOpen && Number(r.lesson) === Number(item.period))).length;
        return (
          <div className="modal-bg progress-modal-overlay"><div className="modal progress-modal peon-popup-modal progress-today-modal progress-day-lessons-modal">
            <div className="progress-modal-header"><div><h2>📅 {formatDayTitle(dayOpen)} 수업</h2><p>{completed}/{daySchedule.length} 완료</p></div><button className="modal-close-x" onClick={closeDayLessons}>×</button></div>
            <div className="progress-today-list">{daySchedule.length === 0 ? <div className="progress-v10-empty">이 날짜에 등록된 수업이 없습니다.</div> : daySchedule.map((item, index) => {
              const doneRecord = recordsFor(item.subject || "체육", item.cls).find((r) => r.date === dayOpen && Number(r.lesson) === Number(item.period));
              return <article key={`${item.id}-${index}`} className={`progress-today-card ${doneRecord ? "done" : ""} ${item.status === "휴강" ? "off" : ""}`}>
                <div className="progress-today-card-head"><span className="period-pill">{item.period}교시</span><strong>{item.subject} · {item.cls}</strong><span className="status-pill">{doneRecord ? "완료" : item.status}</span></div>
                <div className="progress-today-card-actions"><select value={item.location || ""} onChange={(e) => updateDayItem(dayOpen, index, { location: e.target.value })}><option value="">장소 선택</option>{locations.slice(1).map((v) => <option key={v}>{v}</option>)}</select><button onClick={() => { closeDayLessons(); openForm(item.subject || "체육", item.cls, doneRecord || null, { date: dayOpen, period: item.period, location: item.location }); }}>{doneRecord ? "진도 수정" : "진도 입력"}</button></div>
              </article>;
            })}</div>
          </div></div>
        );
      })()}

      {timetableOpen && (
        <div className="modal-bg progress-modal-overlay"><div className="modal peon-popup-modal progress-timetable-modal progress-timetable-grid-modal">
          <div className="progress-modal-header progress-timetable-grid-header">
            <h2>기본 시간표 작성</h2>
            <div className="progress-timetable-header-actions">
              <button className="progress-primary-btn progress-unified-action-btn" onClick={saveTimetableDraft}>저장</button>
              <button className="modal-close-x" onClick={() => { setTimetableOpen(false); setTimetableFocusWeekday(null); }}>×</button>
            </div>
          </div>
          <div className="progress-timetable-grid-wrap">
            <table className="progress-timetable-grid">
              <thead><tr><th>교시</th>{timetableDays.map((weekday) => <th key={weekday}>{weekNames[weekday]}</th>)}</tr></thead>
              <tbody>{timetablePeriods.map((period) => <tr key={period} className={`progress-timetable-period-row period-${period}`}>
                <th>{period}</th>
                {timetableDays.map((weekday) => {
                  const key = makeTimetableCellKey(weekday, period);
                  return <td key={key}>
                    <div className="progress-timetable-cell-editor">
                      <input
                        className="progress-timetable-class-input"
                        ref={(node) => { if (node) timetableInputRefs.current[key] = node; }}
                        value={timetableDraft[key] || ""}
                        aria-label={`${weekNames[weekday]}요일 ${period}교시 수업`}
                        onChange={(e) => setTimetableDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        onBlur={(e) => {
                          const parsed = parseTimetableLabel(e.target.value);
                          if (parsed?.subject && parsed?.cls) {
                            setTimetableDraft((prev) => ({ ...prev, [key]: `${parsed.subject} ${parsed.cls}` }));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (["Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                            e.preventDefault();
                            moveTimetableFocus(weekday, period, e.key, e.shiftKey);
                          }
                        }}
                      />
                      <div className="progress-timetable-location-row">
                        <span>장소</span>
                        <input
                          className="progress-timetable-location-input"
                          ref={(node) => { if (node) timetableLocationInputRefs.current[key] = node; }}
                          value={timetableLocationDraft[key] || ""}
                          aria-label={`${weekNames[weekday]}요일 ${period}교시 장소`}
                          onChange={(e) => setTimetableLocationDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </div>
                    </div>
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        </div></div>
      )}

      {timetableToast && <div className="progress-save-toast" role="status">{timetableToast}</div>}

      {selected && (
        <div className="modal-bg progress-modal-overlay progress-record-overlay"><div className="modal progress-modal peon-popup-modal progress-v10-modal progress-record-modal">
          <div className="progress-modal-header"><div><h2>진도 {editId ? "수정" : "입력"}</h2><p>{selectedSubject} · {selected} 수업 기록</p></div><button className="modal-close-x" onClick={closeForm}>×</button></div>
          <article className="progress-unified-lesson-card progress-record-card">
            <div className="progress-today-card-head progress-unified-card-head">
              <span className="period-pill">{lesson}차시</span>
              <strong>{selectedSubject} · {selected}</strong>
              <span className={`status-pill ${editId ? "done" : ""}`}>{editId ? "수정" : "입력"}</span>
            </div>
            <div className="progress-unified-record-form progress-record-form">
              <label className="progress-day-field"><span>📅 날짜</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="progress-day-field"><span>📍 장소</span><select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">장소 선택</option>{locations.slice(1).map((v) => <option key={v}>{v}</option>)}</select></label>
              <label className="progress-day-field"><span>📖 차시</span><div className="progress-v10-lesson-stepper"><button type="button" onClick={() => setLesson((v) => Math.max(1, Number(v) - 1))}>−</button><strong>{lesson}차시</strong><button type="button" onClick={() => setLesson((v) => Number(v) + 1)}>＋</button></div></label>
              <label className="progress-day-field"><span>📚 단원명</span><input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
              <label className="progress-day-field progress-byte-field progress-unified-wide"><span>📝 활동내용</span><textarea className="progress-content-input" value={content} onChange={(e) => setContent(limitUtf8Bytes(e.target.value, 500))} /><small>{getUtf8ByteLength(content)}/500 Byte</small></label>
              <label className="progress-day-field progress-byte-field progress-unified-wide"><span>📌 유의사항</span><textarea className="progress-note-input" placeholder="수업태도, 안전지도, 준비물, 특이사항 등" value={note} onChange={(e) => setNote(limitUtf8Bytes(e.target.value, 500))} /><small>{getUtf8ByteLength(note)}/500 Byte</small></label>
            </div>
          </article>
          <div className="progress-btn-row progress-modal-actions progress-v10-save-row progress-record-footer"><button className="progress-delete-btn" onClick={() => { if (!editId) return alert("삭제할 수업 기록이 없습니다."); deleteRecord(selected, editId); closeForm(); }}>삭제</button><button className="progress-save-btn" onClick={saveRecord}>저장</button></div>
        </div></div>
      )}
    </div>
  );
}
