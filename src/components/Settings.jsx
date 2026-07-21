import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import PhotoStudio from "./PhotoStudio";
import SharedFileBox from "./SharedFileBox";
import { importAssessmentScores } from "../utils/assessmentScoreImport";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];

const getCurrentInfo = () => {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";
  return { year, semester };
};

const getStudentKey = (year, semester) => `peon_${year}_${semester}_students`;
const getStudentDocId = (year, semester) => `${year}_${semester}_students`;
const getStudentDoc = (year, semester) => {
  const user = auth.currentUser;
  if (!user) return null;
  return doc(db, "peonUsers", user.uid, "records", getStudentDocId(year, semester));
};
const countStudents = (students = {}) => classes.reduce((sum, className) => sum + (students[className] || []).length, 0);
const makeClassSummary = (students = {}) => classes.map((className) => `${className}: ${(students[className] || []).length}명`).join("\n");

function SettingsSection({ number, icon, title, description, open, onToggle, children, accent = "blue" }) {
  return (
    <section className={`card settings-accordion-row settings-accent-${accent} ${["①","②","③","④","⑦","⑧"].includes(number) ? "desktop-tablet-only" : ""} ${open ? "is-open" : ""}`}>
      <button type="button" className="settings-accordion-head" onClick={onToggle}>
        <span className="settings-number-label">{number}</span>
        <span className="settings-accordion-titlebox">
          <strong><span className="settings-section-icon">{icon}</span>{title}</strong>
          <em>{description}</em>
        </span>
        <span className="settings-open-indicator">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && <div className="settings-accordion-body">{children}</div>}
    </section>
  );
}

export default function Settings({ onNavigate } = {}) {
  const [isPhotoStudioOpen, setIsPhotoStudioOpen] = useState(false);
  const [isPhotoFocusMode, setIsPhotoFocusMode] = useState(false);
  const [openSection, setOpenSection] = useState("");
  const { year, semester } = getCurrentInfo();
  const students = JSON.parse(localStorage.getItem(getStudentKey(year, semester)) || "{}");
  const studentCount = countStudents(students);
  const timetable = JSON.parse(localStorage.getItem(`peon_progress_timetable_${year}_${semester}`) || localStorage.getItem("peon_progress_timetable") || "[]");
  const assessment = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_assessment`) || "[]");
  const papsItems = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_paps_items`) || "[]");
  const setupItems = [
    { label: "시간표", icon: "📚", done: Array.isArray(timetable) && timetable.length > 0, detail: `${timetable.length || 0}개 수업`, tab: "progress" },
    { label: "명렬표", icon: "👥", done: studentCount > 0, detail: `학생 ${studentCount}명`, tab: "roster" },
    { label: "수행평가 기준", icon: "🏃", done: Array.isArray(assessment) && assessment.length > 0, detail: `${assessment.length || 0}개 영역`, tab: "assessment" },
    { label: "PAPS 명단", icon: "💗", done: studentCount > 0 && Array.isArray(papsItems) && papsItems.length > 0, detail: `학생 ${studentCount}명`, tab: "paps" },
  ];
  const setupDone = setupItems.filter((item) => item.done).length;

  useEffect(() => {
    if (isPhotoStudioOpen && isPhotoFocusMode) document.body.classList.add("peon-photo-focus");
    else document.body.classList.remove("peon-photo-focus");
    return () => document.body.classList.remove("peon-photo-focus");
  }, [isPhotoStudioOpen, isPhotoFocusMode]);

  const toggleSection = (id) => setOpenSection((current) => (current === id ? "" : id));
  const today = () => new Date().toISOString().slice(0, 10);

  const importFirstSemesterStudents = () => {
    if (semester === "1학기") {
      alert("현재 1학기입니다. 2학기에서 사용하세요.");
      return;
    }
    const firstKey = `peon_${year}_1학기_students`;
    const currentKey = getStudentKey(year, semester);
    const firstData = localStorage.getItem(firstKey);
    if (!firstData) {
      alert("1학기 명렬표 자료가 없습니다.");
      return;
    }
    if (!confirm("1학기 명렬표와 유의사항을 현재 학기로 가져올까요?")) return;
    localStorage.setItem(currentKey, firstData);
    alert("1학기 학생정보를 가져왔습니다. 새로고침 후 확인하세요.");
  };

  const uploadLocalRosterToServer = async () => {
    const user = auth.currentUser;
    if (!user) return alert("로그인 후 사용할 수 있습니다.");
    const key = getStudentKey(year, semester);
    const students = JSON.parse(localStorage.getItem(key) || "{}");
    const total = countStudents(students);
    if (total === 0) return alert("현재 PC에 업로드할 명렬표 자료가 없습니다.");
    if (!confirm(`현재 PC의 명렬표를 서버에 업로드할까요?\n\n${makeClassSummary(students)}\n\n총 ${total}명`)) return;
    try {
      await setDoc(getStudentDoc(year, semester), { students, year, semester, ownerEmail: user.email || "", updatedAt: new Date().toISOString() });
      alert(`서버 업로드 완료\n\n${makeClassSummary(students)}\n\n총 ${total}명 업로드되었습니다.`);
    } catch (error) {
      console.error(error);
      alert("서버 업로드 중 오류가 발생했습니다. Firebase Firestore 설정과 권한을 확인하세요.");
    }
  };

  const downloadServerRosterToLocal = async () => {
    const user = auth.currentUser;
    if (!user) return alert("로그인 후 사용할 수 있습니다.");
    if (!confirm("서버 명렬표를 현재 PC로 가져올까요? 현재 PC의 명렬표가 덮어쓰기 될 수 있습니다.")) return;
    try {
      const snapshot = await getDoc(getStudentDoc(year, semester));
      if (!snapshot.exists()) return alert("서버에 저장된 명렬표가 없습니다.");
      const students = snapshot.data()?.students || {};
      const total = countStudents(students);
      localStorage.setItem(getStudentKey(year, semester), JSON.stringify(students));
      alert(`서버 명렬표를 가져왔습니다.\n\n${makeClassSummary(students)}\n\n총 ${total}명\n\n새로고침 후 확인하세요.`);
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert("서버 자료를 가져오는 중 오류가 발생했습니다. Firebase Firestore 설정과 권한을 확인하세요.");
    }
  };

  const exportBackup = () => {
    const backup = { app: "PE-ON", exportedAt: new Date().toISOString(), data: {} };
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("peon_") || key.startsWith("student_photo_")) backup.data[key] = localStorage.getItem(key);
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `PE-ON_백업_${today()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed.data || parsed;
      if (!confirm("백업 파일을 복원하면 현재 PE-ON 자료가 일부 덮어쓰기 됩니다. 계속할까요?")) return;
      Object.entries(data).forEach(([key, value]) => {
        if (key.startsWith("peon_") || key.startsWith("student_photo_")) localStorage.setItem(key, value);
      });
      alert("백업 자료를 복원했습니다. 새로고침 후 확인하세요.");
      window.location.reload();
    } catch {
      alert("백업 파일을 읽을 수 없습니다. JSON 파일인지 확인하세요.");
    }
    event.target.value = "";
  };

  const [scoreMatchBusy, setScoreMatchBusy] = useState(false);

  const handleManagementScoreMatch = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const scoreKey = `peon_${year}_${semester}_assessment_scores`;
    const activities = JSON.parse(localStorage.getItem(`peon_${year}_${semester}_assessment`) || "[]");

    if (!Array.isArray(activities) || activities.length === 0) {
      alert("먼저 '수행' 탭 → 평가설정에서 평가활동을 만든 뒤 업로드해 주세요.");
      event.target.value = "";
      return;
    }

    setScoreMatchBusy(true);
    try {
      const existingScores = JSON.parse(localStorage.getItem(scoreKey) || "{}");
      const { nextScores, imported, skipped, rowCount } = await importAssessmentScores({
        files,
        activities,
        students,
        existingScores,
        targetActivityId: "all",
        fallbackClass: classes[0],
      });

      localStorage.setItem(scoreKey, JSON.stringify(nextScores));
      alert(`수행평가 점수 매칭이 끝났습니다.\n\n반영 ${imported}건 · 미매칭 ${skipped}명 · 읽은 행 ${rowCount}개\n\n'수행' 탭 → 점수확인에서 확인해 주세요.`);
    } catch (error) {
      console.error(error);
      alert(error?.message === "PDF_TEXT_NOT_FOUND"
        ? "스캔 이미지 PDF는 자동 인식할 수 없습니다. 글자를 선택할 수 있는 PDF 또는 엑셀 파일을 사용해 주세요."
        : "점수 매칭 중 오류가 발생했습니다. 파일 형식과 표 머리글을 확인해 주세요.");
    }
    setScoreMatchBusy(false);
    event.target.value = "";
  };

  const clearAllData = () => {
    if (!confirm("PE-ON 로컬 저장 자료를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("peon_") || key.startsWith("student_photo_")) localStorage.removeItem(key);
    });
    alert("자료를 삭제했습니다. 새로고침합니다.");
    window.location.reload();
  };

  return (
    <div className={`page settings-page ${isPhotoStudioOpen && isPhotoFocusMode ? "settings-photo-focus" : ""}`}>
      <h2>⚙️ 관리</h2>
      <p className="page-subtitle">필요한 항목만 펼쳐서 관리할 수 있습니다.</p>

      <section className="card settings-basic-dashboard desktop-tablet-only">
        <div className="basic-status-head"><div><h2>🧰 기초작업 현황</h2><p>{year} · {semester}</p></div><strong>{setupDone} / 4 완료</strong></div>
        <div className="basic-progress"><span style={{ width: `${setupDone * 25}%` }} /></div>
        <div className="basic-status-grid">
          {setupItems.map((item) => <button type="button" key={item.label} className={`basic-status-card ${item.done ? "done" : "missing"}`} onClick={() => onNavigate?.(item.tab)}><span className="basic-status-icon">{item.icon}</span><span><strong>{item.label}</strong><em>{item.done ? "저장 완료" : "미등록"} · {item.detail}</em></span><b>{item.done ? "수정" : "등록하기"}</b></button>)}
        </div>
      </section>

      <div className="settings-numbered-list settings-accordion-list">
        <SettingsSection number="①" icon="📋" title="명렬표 파일" description="학생 명렬표 Excel, PDF, HWP/HWPX 원본 파일" open={openSection === "1"} onToggle={() => toggleSection("1")}>
          <SharedFileBox title="명렬표 파일" description="학생 명렬표 Excel, PDF, HWP/HWPX 원본 파일을 보관합니다." category="roster" year={year} semester={semester} localKey={`${getStudentKey(year, semester)}_shared_files`} accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv" />
        </SettingsSection>

        <SettingsSection number="②" icon="🏃" title="수행평가" description="기준표 업로드 · 점수 업로드" open={openSection === "2"} onToggle={() => toggleSection("2")} accent="orange">
          <div className="settings-action-panel">
            <label className="file-label-btn">
              {scoreMatchBusy ? "매칭 중..." : "📥 점수 파일로 자동 매칭"}
              <input type="file" accept=".xlsx,.xls,.csv,.pdf" multiple disabled={scoreMatchBusy} onChange={handleManagementScoreMatch} />
            </label>
            <p className="settings-inline-hint">엑셀(.xlsx,.xls,.csv) 또는 텍스트형 PDF를 올리면 반/번호/이름 기준으로 학생을 찾아 점수를 바로 채워 넣습니다. (아래 파일함은 보관·열람 전용이며 이 매칭 기능과는 별개입니다)</p>
          </div>
          <SharedFileBox title="수행평가 기준표 · 점수 업로드" description="수행평가 기준표, 점수 입력 파일, 활동별 자료를 보관합니다." category="assessment" year={year} semester={semester} localKey={`peon_${year}_${semester}_assessment_shared_files`} accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv" />
        </SettingsSection>

        <SettingsSection number="③" icon="💗" title="PAPS" description="기준표 업로드 · 기록 업로드" open={openSection === "3"} onToggle={() => toggleSection("3")} accent="pink">
          <SharedFileBox title="PAPS 기준표 · 기록 업로드" description="PAPS 기준표, 측정 기록, 반별 Excel 자료를 보관합니다." category="paps" year={year} semester={semester} localKey={`peon_${year}_${semester}_paps_shared_files`} accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv" />
        </SettingsSection>

        <SettingsSection number="④" icon="🖼️" title="사진" description="학생 사진 PDF · 이미지 파일 업로드" open={openSection === "4"} onToggle={() => toggleSection("4")} accent="green">
          <SharedFileBox title="사진 파일" description="반별 학생 사진 PDF, JPG, PNG 원본 파일을 보관합니다." category="photo" year={year} semester={semester} localKey={`peon_${year}_${semester}_photo_shared_files`} accept=".pdf,.png,.jpg,.jpeg" />
        </SettingsSection>

        <SettingsSection number="⑤" icon="📷" title="사진등록센터" description="PDF 불러오기 · 학생 선택 · 사진 저장" open={openSection === "5"} onToggle={() => { toggleSection("5"); setIsPhotoStudioOpen(true); }} accent="purple">
          <div className="settings-inline-actions photo-center-actions">
            <button className="save-btn" onClick={() => setIsPhotoStudioOpen((prev) => !prev)}>{isPhotoStudioOpen ? "사진등록센터 닫기" : "사진등록센터 열기"}</button>
            {isPhotoStudioOpen && <button className="setting-btn" onClick={() => setIsPhotoFocusMode((prev) => !prev)}>{isPhotoFocusMode ? "기본 화면" : "작업 화면 크게"}</button>}
          </div>
          {isPhotoStudioOpen && <PhotoStudio embedded focusMode={isPhotoFocusMode} />}
        </SettingsSection>

        <SettingsSection number="⑥" icon="💾" title="백업 / 복원" description="백업 다운로드 · 백업 복원 · 로컬 자료 삭제" open={openSection === "6"} onToggle={() => toggleSection("6")} accent="slate">
          <div className="settings-action-panel">
            <button className="save-btn" onClick={exportBackup}>백업 다운로드</button>
            <label className="file-label-btn">백업 복원<input type="file" accept=".json" onChange={importBackup} /></label>
            <button className="delete-btn" onClick={clearAllData}>로컬 자료 삭제</button>
          </div>
        </SettingsSection>

        <SettingsSection number="⑦" icon="📚" title="학기자료 가져오기" description="1학기 학생정보를 2학기로 가져오기" open={openSection === "7"} onToggle={() => toggleSection("7")} accent="teal">
          <div className="settings-action-panel"><button className="setting-btn" onClick={importFirstSemesterStudents}>1학기 학생정보 가져오기</button></div>
        </SettingsSection>

        <SettingsSection number="⑧" icon="☁️" title="Firebase 명렬표 동기화" description="현재 PC ↔ 서버 명렬표 동기화" open={openSection === "8"} onToggle={() => toggleSection("8")} accent="blue">
          <div className="settings-action-panel">
            <button className="save-btn" onClick={uploadLocalRosterToServer}>현재 PC → 서버 업로드</button>
            <button className="setting-btn" onClick={downloadServerRosterToLocal}>서버 → 현재 PC 가져오기</button>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
