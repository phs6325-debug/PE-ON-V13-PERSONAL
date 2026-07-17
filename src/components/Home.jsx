import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const getToday = () => new Date().toISOString().slice(0, 10);

export default function Home({ onNavigate } = {}) {
  const [year, setYear] = useState(localStorage.getItem("peon_year") || "2026학년도");
  const [semester, setSemester] = useState(localStorage.getItem("peon_semester") || "1학기");
  const [grade, setGrade] = useState(localStorage.getItem("peon_grade") || "2학년");

  const [selectedDate, setSelectedDate] = useState(getToday());

  const todoKey = `peon_todos_${selectedDate}`;

  const [todos, setTodos] = useState(() =>
    JSON.parse(localStorage.getItem(todoKey) || "[]")
  );
  const [remoteReady, setRemoteReady] = useState(false);

  const [open, setOpen] = useState(false);
  const [todo, setTodo] = useState("");
  const [memo, setMemo] = useState("");

  useEffect(() => localStorage.setItem("peon_year", year), [year]);
  useEffect(() => localStorage.setItem("peon_semester", semester), [semester]);
  useEffect(() => localStorage.setItem("peon_grade", grade), [grade]);

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
      <div className="select-row">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option>2026학년도</option>
          <option>2027학년도</option>
          <option>2028학년도</option>
        </select>

        <select value={semester} onChange={(e) => setSemester(e.target.value)}>
          <option>1학기</option>
          <option>2학기</option>
        </select>

        <select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option>1학년</option>
          <option>2학년</option>
          <option>3학년</option>
        </select>
      </div>

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