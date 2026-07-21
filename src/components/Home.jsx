import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const getToday = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const SEMESTER_PERIODS = {
  "2026학년도": {
    "1학기": { start: "2026-03-01", end: "2026-07-23" },
    "2학기": { start: "2026-08-19", end: "2027-02-28" },
  },
};

const detectSemesterContext = (dateText = getToday()) => {
  for (const [year, semesters] of Object.entries(SEMESTER_PERIODS)) {
    for (const [semester, period] of Object.entries(semesters)) {
      if (dateText >= period.start && dateText <= period.end) return { year, semester };
    }
  }
  return null;
};

const DEFAULT_CONTEXT = {
  year: "2026학년도",
  semester: "1학기",
  grade: "2학년",
};

const readContext = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!parsed) return null;
    return {
      year: parsed.year || DEFAULT_CONTEXT.year,
      semester: parsed.semester || DEFAULT_CONTEXT.semester,
      grade: parsed.grade || DEFAULT_CONTEXT.grade,
    };
  } catch {
    return null;
  }
};

export default function Home({ onNavigate } = {}) {
  const initialContext = readContext("peon_default_context") || {
    year: localStorage.getItem("peon_year") || DEFAULT_CONTEXT.year,
    semester: localStorage.getItem("peon_semester") || DEFAULT_CONTEXT.semester,
    grade: localStorage.getItem("peon_grade") || DEFAULT_CONTEXT.grade,
  };

  const [year, setYear] = useState(initialContext.year);
  const [semester, setSemester] = useState(initialContext.semester);
  const [grade, setGrade] = useState(initialContext.grade);
  const [appliedContext, setAppliedContext] = useState(initialContext);
  const [contextMessage, setContextMessage] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const [setupRevision, setSetupRevision] = useState(0);

  const [selectedDate, setSelectedDate] = useState(getToday());

  const todoKey = `peon_todos_${selectedDate}`;

  const [todos, setTodos] = useState(() =>
    JSON.parse(localStorage.getItem(todoKey) || "[]")
  );
  const [remoteReady, setRemoteReady] = useState(false);

  const [open, setOpen] = useState(false);
  const [todo, setTodo] = useState("");
  const [memo, setMemo] = useState("");



  const contextValue = { year, semester, grade };

  const getSetupStatus = () => {
    const students = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_students`) || "{}");
    const studentCount = Object.values(students).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const timetable = JSON.parse(localStorage.getItem(`peon_progress_timetable_${year}_${semester}`) || localStorage.getItem("peon_progress_timetable") || "[]");
    const assessment = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_assessment`) || "[]");
    const papsItems = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_paps_items`) || "[]");
    return [
      { id: "progress", icon: "📚", label: "시간표", done: Array.isArray(timetable) && timetable.length > 0, detail: Array.isArray(timetable) && timetable.length ? `${timetable.length}개 수업` : "미등록" },
      { id: "roster", icon: "👥", label: "명렬표", done: studentCount > 0, detail: studentCount ? `학생 ${studentCount}명` : "미등록" },
      { id: "assessment", icon: "🏃", label: "수행평가 기준", done: Array.isArray(assessment) && assessment.length > 0, detail: Array.isArray(assessment) && assessment.length ? `${assessment.length}개 영역` : "미등록" },
      { id: "paps", icon: "💗", label: "PAPS 명단", done: studentCount > 0 && Array.isArray(papsItems) && papsItems.length > 0, detail: studentCount ? `학생 ${studentCount}명` : "미등록" },
    ];
  };
  const setupStatus = getSetupStatus();
  const setupDone = setupStatus.filter((item) => item.done).length;

  const applyContext = (nextContext, message = "선택한 설정을 적용했습니다.") => {
    localStorage.setItem("peon_year", nextContext.year);
    localStorage.setItem("peon_semester", nextContext.semester);
    localStorage.setItem("peon_grade", nextContext.grade);
    setAppliedContext(nextContext);
    window.dispatchEvent(new CustomEvent("peon-context-change", { detail: nextContext }));
    setContextMessage(message);
  };

  useEffect(() => {
    const detected = detectSemesterContext();
    if (!detected) return;
    const currentDefault = readContext("peon_default_context");
    if (!currentDefault) {
      setYear(detected.year);
      setSemester(detected.semester);
      applyContext({ year: detected.year, semester: detected.semester, grade }, "오늘 날짜에 맞는 학기를 자동 적용했습니다.");
    }
  }, []);

  useEffect(() => {
    const refresh = () => setSetupRevision((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("peon-context-change", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("peon-context-change", refresh);
    };
  }, []);

  useEffect(() => {
    const loadRemoteDefault = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const ref = doc(db, "peonUsers", user.uid, "settings", "homeContext");
        const snap = await getDoc(ref);
        const remoteDefault = snap.exists() ? snap.data()?.defaultContext : null;
        if (remoteDefault?.year && remoteDefault?.semester && remoteDefault?.grade) {
          localStorage.setItem("peon_default_context", JSON.stringify(remoteDefault));
          setYear(remoteDefault.year);
          setSemester(remoteDefault.semester);
          setGrade(remoteDefault.grade);
          applyContext(remoteDefault, "저장된 기본 설정을 불러왔습니다.");
        }
      } catch {
        // 오프라인이거나 권한 확인 중이면 로컬 기본 설정을 그대로 사용합니다.
      }
    };
    loadRemoteDefault();
  }, []);

  const handleApplyContext = () => {
    applyContext(contextValue, "선택한 학년도·학기·학년으로 조회했습니다.");
  };

  const handleSaveContext = async () => {
    setContextBusy(true);
    try {
      localStorage.setItem("peon_saved_context", JSON.stringify(contextValue));
      const user = auth.currentUser;
      if (user) {
        const ref = doc(db, "peonUsers", user.uid, "settings", "homeContext");
        await setDoc(ref, {
          savedContext: contextValue,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      setContextMessage("현재 선택을 저장했습니다.");
    } catch {
      setContextMessage("로컬에는 저장했지만 온라인 저장은 완료하지 못했습니다.");
    } finally {
      setContextBusy(false);
    }
  };

  const handleLoadContext = async () => {
    setContextBusy(true);
    try {
      let saved = readContext("peon_saved_context");
      const user = auth.currentUser;
      if (user) {
        const ref = doc(db, "peonUsers", user.uid, "settings", "homeContext");
        const snap = await getDoc(ref);
        saved = snap.exists() ? (snap.data()?.savedContext || saved) : saved;
      }
      if (!saved) {
        setContextMessage("불러올 저장 설정이 없습니다.");
        return;
      }
      setYear(saved.year);
      setSemester(saved.semester);
      setGrade(saved.grade);
      applyContext(saved, "저장된 설정을 불러와 적용했습니다.");
    } catch {
      setContextMessage("설정을 불러오지 못했습니다.");
    } finally {
      setContextBusy(false);
    }
  };

  const handleKeepCurrentContext = async () => {
    setContextBusy(true);
    try {
      localStorage.setItem("peon_default_context", JSON.stringify(contextValue));
      applyContext(contextValue, "현재 설정을 기본값으로 지정했습니다.");
      const user = auth.currentUser;
      if (user) {
        const ref = doc(db, "peonUsers", user.uid, "settings", "homeContext");
        await setDoc(ref, {
          defaultContext: contextValue,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
    } catch {
      setContextMessage("기기에는 유지되지만 온라인 기본 설정 저장은 완료하지 못했습니다.");
    } finally {
      setContextBusy(false);
    }
  };

  useEffect(() => {
    const localTodos = JSON.parse(localStorage.getItem(todoKey) || "[]");
    setTodos(localTodos);
    setRemoteReady(false);

    const user = auth.currentUser;
    if (!user) {
      setRemoteReady(true);
      return undefined;
    }

    const ref = doc(db, "peonUsers", user.uid, "todos", selectedDate);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      const remoteTodos = snapshot.exists() ? snapshot.data()?.items || [] : localTodos;
      setTodos(remoteTodos);
      localStorage.setItem(todoKey, JSON.stringify(remoteTodos));
      setRemoteReady(true);
    }, () => {
      setRemoteReady(true);
    });

    return () => unsubscribe();
  }, [todoKey, selectedDate]);

  useEffect(() => {
    localStorage.setItem(todoKey, JSON.stringify(todos));
    const user = auth.currentUser;
    if (!user || !remoteReady) return;
    const ref = doc(db, "peonUsers", user.uid, "todos", selectedDate);
    setDoc(ref, { items: todos, date: selectedDate, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  }, [todos, todoKey, selectedDate, remoteReady]);

  const addTodo = () => {
    if (!todo.trim()) return;

    setTodos([
      { id: Date.now(), todo, memo, done: false },
      ...todos,
    ]);

    setTodo("");
    setMemo("");
    setOpen(false);
  };

  const toggleTodo = (id) => {
    setTodos(
      todos.map((t) =>
        t.id === id ? { ...t, done: !t.done } : t
      )
    );
  };

  const removeTodo = (id) => {
    setTodos(todos.filter((t) => t.id !== id));
  };

  const active = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  const dateText = new Date(selectedDate).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  return (
    <div className="page home-page">
      <section className="home-context-panel" aria-label="공통 조회 설정">
        <div className="select-row home-context-selects">
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="학년도">
            <option>2026학년도</option>
            <option>2027학년도</option>
            <option>2028학년도</option>
          </select>

          <select value={semester} onChange={(e) => setSemester(e.target.value)} aria-label="학기">
            <option>1학기</option>
            <option>2학기</option>
          </select>

          <select value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="학년">
            <option>1학년</option>
            <option>2학년</option>
            <option>3학년</option>
          </select>
        </div>

        <div className="home-context-actions">
          <button type="button" className="context-primary-btn" onClick={handleApplyContext} disabled={contextBusy}>조회</button>
          <button type="button" className="context-secondary-btn" onClick={handleSaveContext} disabled={contextBusy}>저장</button>
          <button type="button" className="context-secondary-btn" onClick={handleLoadContext} disabled={contextBusy}>불러오기</button>
          <button type="button" className="context-keep-btn" onClick={handleKeepCurrentContext} disabled={contextBusy}>현재 설정 유지</button>
        </div>

      </section>

      <section className="card date-card">
  <strong>📅 {dateText}</strong>

  <input
    type="date"
    value={selectedDate}
    onChange={(e) => setSelectedDate(e.target.value)}
  />
</section>

      <section className="card">
        <div className="title-row">
          <h2>
            ✅ 오늘의 할 일
            <span className="todo-count">
              {' '}({active.length}건 미완료 / {done.length}건 완료)
            </span>
          </h2>

          <button className="circle-btn" onClick={() => setOpen(true)}>
            ＋
          </button>
        </div>

        {active.map((item) => (
          <div className="todo-item" key={item.id}>
            <button className="text-btn" onClick={() => toggleTodo(item.id)}>
              ☐
            </button>

            <div className="grow">
              <strong>{item.todo}</strong>
              {item.memo && <p>{item.memo}</p>}
            </div>

            <button className="danger" onClick={() => removeTodo(item.id)}>
              삭제
            </button>
          </div>
        ))}

        {done.map((item) => (
          <div className="todo-item done" key={item.id}>
            <button className="text-btn" onClick={() => toggleTodo(item.id)}>
              ☑
            </button>

            <div className="grow">
              <strong>{item.todo}</strong>
              {item.memo && <p>{item.memo}</p>}
            </div>

            <button className="danger" onClick={() => removeTodo(item.id)}>
              삭제
            </button>
          </div>
        ))}
      </section>


      <section className="home-quick-cards home-quick-cards-field">
        <article className="home-quick-card mobile-field-card">
          <div className="home-quick-icon">📚</div>
          <h3>진도</h3>
          <p>학급별 진도 관리 및 차시 기록</p>
          <button type="button" onClick={() => onNavigate?.("progress")}>바로가기</button>
        </article>
        <article className="home-quick-card mobile-field-card">
          <div className="home-quick-icon">👥</div>
          <h3>명렬표</h3>
          <p>학생 명단 조회 및 학생카드 관리</p>
          <button type="button" onClick={() => onNavigate?.("roster")}>바로가기</button>
        </article>
        <article className="home-quick-card mobile-field-card">
          <div className="home-quick-icon">🏃</div>
          <h3>수행평가</h3>
          <p>평가 기준 설정 및 점수 입력</p>
          <button type="button" onClick={() => onNavigate?.("assessment", "input")}>바로가기</button>
        </article>
        <article className="home-quick-card mobile-field-card">
          <div className="home-quick-icon">💗</div>
          <h3>PAPS</h3>
          <p>측정 결과 입력 및 등급 관리</p>
          <button type="button" onClick={() => onNavigate?.("paps")}>바로가기</button>
        </article>
        <article className="home-quick-card pc-manage-card">
          <div className="home-quick-icon">✨</div>
          <h3>세특</h3>
          <p>AI 기반 과정중심 교과세특 작성</p>
          <button type="button" onClick={() => onNavigate?.("records")}>바로가기</button>
        </article>
      </section>

      {open && (
        <div className="modal-bg">
          <div className="modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setOpen(false)} aria-label="닫기">×</button>
            <h2>할 일 추가</h2>

            <input
              placeholder="할 일"
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
            />

            <input
              placeholder="메모"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />

            <div className="button-row">
              <button className="save-btn" onClick={addTodo}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}