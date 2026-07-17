import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import StudentCard from "./StudentCard";
import SharedFileBox from "./SharedFileBox";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];

const emptyForm = {
  number: "",
  name: "",
  gender: "남",
  health: "",
};

const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();

const getCell = (row, candidates) => {
  const entries = Object.entries(row || {});
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const exact = entries.find(([key]) => normalize(key) === target);
    if (exact) return exact[1];
  }
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const partial = entries.find(([key]) => normalize(key).includes(target));
    if (partial) return partial[1];
  }
  return "";
};

const inferClassName = (row, fallbackClass) => {
  const fullClass = getCell(row, ["학급", "반", "반명", "학년반", "className"]);
  const grade = getCell(row, ["학년", "grade"]);
  const ban = getCell(row, ["반명", "반", "class", "className"]);

  const text = String(fullClass || ban || "");
  const matched = text.match(/([1-3])\s*-?\s*([1-9])/);
  if (matched) return `${matched[1]}-${matched[2]}`;

  const gradeNumber = String(grade || fallbackClass.split("-")[0] || "2").replace(/[^0-9]/g, "") || "2";
  const classNumber = String(ban || "").replace(/[^0-9]/g, "");
  if (classNumber) return `${gradeNumber}-${classNumber}`;

  return fallbackClass;
};

const normalizeGender = (value) => {
  const text = String(value ?? "").trim();
  const compact = text.replace(/\s/g, "").toLowerCase();

  // 나이스/엑셀 성별 코드 자동 인식
  // 1 = 남, 2 = 여
  if (compact === "1" || compact === "1.0") return "남";
  if (compact === "2" || compact === "2.0") return "여";

  // 한글/영문 자동 인식
  if (compact.includes("여") || compact.includes("female") || compact === "f" || compact === "w") return "여";
  if (compact.includes("남") || compact.includes("male") || compact === "m") return "남";

  return "남";
};

const makeStudentDocId = (year, semester) => `${year}_${semester}_students`;

const getUserDataDoc = (year, semester) => {
  const user = auth.currentUser;
  if (!user) return null;
  return doc(db, "peonUsers", user.uid, "records", makeStudentDocId(year, semester));
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const normalizeHealthRecords = (student = {}) => {
  const records = Array.isArray(student.healthRecords)
    ? student.healthRecords.filter((record) => String(record?.text || "").trim())
    : [];
  if (records.length) {
    return records
      .map((record, index) => ({
        id: record.id || `${record.date || todayIso()}-${index}-${Date.now()}`,
        date: record.date || todayIso(),
        text: String(record.text || "").trim(),
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  const legacy = String(student.health || "").trim();
  return legacy ? [{ id: `legacy-${student.id || Date.now()}`, date: todayIso(), text: legacy }] : [];
};

const makeHealthSummary = (records = []) => {
  const first = records[0];
  return first ? `[${first.date}] ${first.text}` : "";
};

export default function Roster() {
  const [cls, setCls] = useState("2-1");

  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";
  const studentStorageKey = `peon_${year}_${semester}_students`;

  const [students, setStudents] = useState(() =>
    JSON.parse(localStorage.getItem(studentStorageKey) || "{}")
  );

  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [editId, setEditId] = useState(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [cloudStatus, setCloudStatus] = useState("서버 연결 준비 중");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [healthModalStudent, setHealthModalStudent] = useState(null);
  const [healthNoteDate, setHealthNoteDate] = useState(todayIso());
  const [healthNoteText, setHealthNoteText] = useState("");

  const cloudReadyRef = useRef(false);
  const lastSavedJsonRef = useRef("");

  useEffect(() => {
    const dataDoc = getUserDataDoc(year, semester);
    if (!dataDoc) {
      setCloudStatus("로그인 정보를 확인할 수 없습니다.");
      return undefined;
    }

    setCloudStatus("서버 자료 불러오는 중");
    cloudReadyRef.current = false;

    const unsubscribe = onSnapshot(
      dataDoc,
      async (snapshot) => {
        if (snapshot.exists()) {
          const cloudStudents = snapshot.data()?.students || {};
          const cloudJson = JSON.stringify(cloudStudents);
          lastSavedJsonRef.current = cloudJson;
          localStorage.setItem(studentStorageKey, cloudJson);
          setStudents(cloudStudents);
          setCloudStatus("서버 저장됨");
          cloudReadyRef.current = true;
          return;
        }

        const localStudents = JSON.parse(localStorage.getItem(studentStorageKey) || "{}");
        const localJson = JSON.stringify(localStudents);
        lastSavedJsonRef.current = localJson;
        setStudents(localStudents);
        await setDoc(dataDoc, {
          students: localStudents,
          updatedAt: new Date().toISOString(),
          year,
          semester,
          ownerEmail: auth.currentUser?.email || "",
        });
        setCloudStatus("로컬 명렬표를 서버로 옮겼습니다.");
        cloudReadyRef.current = true;
      },
      (error) => {
        console.error(error);
        setCloudStatus("서버 연결 오류: Firebase 규칙/권한을 확인하세요.");
        cloudReadyRef.current = false;
      }
    );

    return () => unsubscribe();
  }, [year, semester, studentStorageKey]);

  useEffect(() => {
    localStorage.setItem(studentStorageKey, JSON.stringify(students));

    if (!cloudReadyRef.current) return;

    const dataDoc = getUserDataDoc(year, semester);
    if (!dataDoc) return;

    const currentJson = JSON.stringify(students);
    if (currentJson === lastSavedJsonRef.current) return;

    lastSavedJsonRef.current = currentJson;
    const timer = window.setTimeout(() => {
      setDoc(dataDoc, {
        students,
        updatedAt: new Date().toISOString(),
        year,
        semester,
        ownerEmail: auth.currentUser?.email || "",
      })
        .then(() => {
          setCloudStatus("서버 저장됨");
        })
        .catch((error) => {
          console.error(error);
          setCloudStatus("서버 저장 실패");
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [students, studentStorageKey, year, semester]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
  };

  const showMessage = (message) => {
    setUploadMessage(message);
    window.clearTimeout(window.__peonRosterTimer);
    window.__peonRosterTimer = window.setTimeout(() => setUploadMessage(""), 2500);
  };

  const saveStudent = () => {
    if (!form.number || !form.name.trim()) return;

    if (editId) {
      setStudents({
        ...students,
        [cls]: (students[cls] || [])
          .map((s) =>
            s.id === editId
              ? {
                  ...s,
                  className: cls,
                  number: form.number,
                  name: form.name,
                  gender: form.gender,
                  health: form.health,
                }
              : s
          )
          .sort((a, b) => Number(a.number) - Number(b.number)),
      });

      resetForm();
      showMessage("학생 정보를 서버에 저장했습니다.");
      return;
    }

    const student = {
      id: `${cls}-${form.number}-${Date.now()}`,
      className: cls,
      ...form,
    };

    setStudents({
      ...students,
      [cls]: [...(students[cls] || []), student].sort(
        (a, b) => Number(a.number) - Number(b.number)
      ),
    });

    resetForm();
    showMessage("학생 정보를 서버에 저장했습니다.");
  };

  const editStudent = (student) => {
    setEditId(student.id);
    setForm({
      number: student.number || "",
      name: student.name || "",
      gender: student.gender || "남",
      health: student.health || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeStudent = (id) => {
    setStudents({
      ...students,
      [cls]: (students[cls] || []).filter((s) => s.id !== id),
    });

    if (editId === id) resetForm();
    showMessage("학생 정보를 삭제하고 서버에 반영했습니다.");
  };

  const updateStudentHealth = (studentId, value, recordsOverride = null) => {
    setStudents((prev) => ({
      ...prev,
      [cls]: (prev[cls] || []).map((student) => {
        if (student.id !== studentId) return student;
        const records = recordsOverride || normalizeHealthRecords({ ...student, health: value });
        return { ...student, health: makeHealthSummary(records), healthRecords: records };
      }),
    }));

    setSelectedStudent((prev) => {
      if (prev?.id !== studentId) return prev;
      const records = recordsOverride || normalizeHealthRecords({ ...prev, health: value });
      return { ...prev, health: makeHealthSummary(records), healthRecords: records };
    });

    setHealthModalStudent((prev) => {
      if (prev?.id !== studentId) return prev;
      const records = recordsOverride || normalizeHealthRecords({ ...prev, health: value });
      return { ...prev, health: makeHealthSummary(records), healthRecords: records };
    });
  };

  const openHealthModal = (student) => {
    setHealthModalStudent(student);
    setHealthNoteDate(todayIso());
    setHealthNoteText("");
  };

  const addHealthRecord = () => {
    if (!healthModalStudent || !healthNoteText.trim()) return;
    const currentRecords = normalizeHealthRecords(healthModalStudent);
    const nextRecords = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, date: healthNoteDate || todayIso(), text: healthNoteText.trim() },
      ...currentRecords,
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    updateStudentHealth(healthModalStudent.id, makeHealthSummary(nextRecords), nextRecords);
    setHealthNoteText("");
    showMessage("유의사항을 날짜별 기록으로 저장했습니다.");
  };

  const deleteHealthRecord = (recordId) => {
    if (!healthModalStudent) return;
    const nextRecords = normalizeHealthRecords(healthModalStudent).filter((record) => record.id !== recordId);
    updateStudentHealth(healthModalStudent.id, makeHealthSummary(nextRecords), nextRecords);
    showMessage("유의사항 기록을 삭제했습니다.");
  };

  const readWorkbookRows = async (file) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const rows = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      rows.push(...XLSX.utils.sheet_to_json(sheet, { defval: "" }));
    });
    return rows;
  };

  const importRosterFiles = async (files) => {
    const excelFiles = Array.from(files || []).filter((file) =>
      /\.(xlsx|xls|csv)$/i.test(file.name || "")
    );

    if (excelFiles.length === 0) return 0;

    const nextStudents = { ...students };
    let importedCount = 0;

    for (const file of excelFiles) {
      const rows = await readWorkbookRows(file);

      rows.forEach((row) => {
        const name = String(getCell(row, ["학생성명", "학생명", "성명", "이름", "name"])).trim();
        if (!name) return;

        const className = inferClassName(row, cls);
        const number = String(getCell(row, ["번호", "출석번호", "학번", "number"])).replace(/\.0$/, "").trim();
        const gender = normalizeGender(getCell(row, ["성별", "성별(남:1여:2)", "성별(남:1 여:2)", "남녀", "gender", "sex"]));
        const health = String(getCell(row, ["유의사항", "건강상유의사항", "건강", "참고사항", "health"])).trim();

        const list = [...(nextStudents[className] || [])];
        const existsIndex = list.findIndex(
          (student) => String(student.number) === String(number) && student.name === name
        );

        const studentData = {
          id: existsIndex >= 0 ? list[existsIndex].id : `${className}-${number || list.length + 1}-${name}`,
          className,
          number: number || String(list.length + 1),
          name,
          gender,
          health,
        };

        if (existsIndex >= 0) list[existsIndex] = { ...list[existsIndex], ...studentData };
        else list.push(studentData);

        nextStudents[className] = list.sort((a, b) => Number(a.number) - Number(b.number));
        importedCount += 1;
      });
    }

    if (importedCount > 0) {
      setStudents(nextStudents);
      localStorage.setItem(studentStorageKey, JSON.stringify(nextStudents));
      showMessage(`명렬표 ${importedCount}명을 가져와 서버에 저장했습니다.`);
    } else {
      showMessage("명렬표에서 학생 이름을 찾지 못했습니다. 엑셀의 이름/성명/학생성명 열을 확인해 주세요.");
    }

    return importedCount;
  };

  const handleRosterUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    try {
      await importRosterFiles(files);
    } catch (error) {
      console.error(error);
      showMessage("명렬표 업로드 중 오류가 발생했습니다. 엑셀 양식을 확인해 주세요.");
    }

    event.target.value = "";
  };

  const downloadRosterExcel = () => {
    const rows = [];
    classes.forEach((className) => {
      (students[className] || []).forEach((student) => {
        rows.push({
          학급: className,
          번호: student.number,
          이름: student.name,
          성별: student.gender,
          유의사항: student.health || "",
        });
      });
    });

    if (rows.length === 0) {
      showMessage("다운로드할 명렬표 자료가 없습니다.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "명렬표");
    XLSX.writeFile(workbook, `${year}_${semester}_명렬표.xlsx`);
  };

  const list = (students[cls] || []).filter(
    (s) => s.name.includes(search) || String(s.number).includes(search)
  );

  return (
    <div className="page roster-page">
      <h2>👨‍🎓 명렬표</h2>


<div className="assessment-save-message">
        ☁️ 명렬표 클라우드 상태: {cloudStatus}
      </div>

      <section className="card roster-control-bar roster-sticky-control-bar">
        <label className="roster-class-select-wrap">
          <span>학급(인원)</span>
          <select value={cls} onChange={(e) => { setCls(e.target.value); setSearch(""); resetForm(); }}>
            {classes.map((c) => (
              <option key={c} value={c}>{c} ({(students[c] || []).length}명)</option>
            ))}
          </select>
        </label>
        <button className="save-btn roster-quick-add-btn" type="button" onClick={() => setIsAddOpen(true)}>학생추가</button>
        <input
          className="roster-inline-search"
          placeholder="🔍 학생검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="excel-btn roster-download-btn" type="button" onClick={downloadRosterExcel}>엑셀 다운로드</button>
      </section>

      <SharedFileBox
        title="📎 명렬표 파일/자료"
        description="명렬표 원본 파일을 올리면 엑셀은 학생명단으로 가져오고, PDF/HWP/HWPX/이미지는 자료로 보관됩니다."
        category="roster"
        year={year}
        semester={semester}
        localKey={`${studentStorageKey}_shared_files`}
        accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
        onLocalFilesSelected={importRosterFiles}
      />

      <section className="card upload-card">
        <div className="upload-title-row">
          <div>
            <h3>📂 명렬표 업로드</h3>
            <p>학생 명단을 실제로 가져올 때는 엑셀(.xlsx, .xls, .csv)을 사용합니다. PDF/HWP/HWPX/이미지는 위 파일/자료 영역에 보관하세요.</p>
          </div>
          <button className="excel-btn" onClick={downloadRosterExcel}>엑셀 다운로드</button>
        </div>
        <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleRosterUpload} />
        {uploadMessage && <div className="assessment-save-message">{uploadMessage}</div>}
      </section>


      <div className="class-tabs roster-class-tabs-under-add roster-sticky-class-tabs roster-old-tabs-hidden">
        {classes.map((c) => (
          <button
            key={c}
            className={cls === c ? "active" : ""}
            onClick={() => {
              setCls(c);
              setSearch("");
              resetForm();
            }}
          >
            {c} ({(students[c] || []).length}명)
          </button>
        ))}
      </div>

      {(isAddOpen || editId) && (
      <section className="card roster-add-card collapsible-card open">
        <div className="roster-collapsible-header">
          <div>
            <h3>{editId ? "학생 정보 수정" : `${cls} 학생 추가`}</h3>
          </div>
          <button className="setting-btn compact-toggle-btn" onClick={() => { setIsAddOpen(false); if (!editId) resetForm(); }}>
            접기
          </button>
        </div>

          <>
            <div className="roster-edit-header">
              {editId && (
                <div className="roster-edit-actions">
                  <button className="cancel-btn" onClick={resetForm}>
                    수정취소
                  </button>

                  <button className="save-btn" onClick={saveStudent}>
                    수정저장
                  </button>
                </div>
              )}
            </div>

            {editId && (
              <div className="edit-notice roster-edit-notice">
                수정 중입니다. 내용을 바꾼 뒤 수정저장을 누르세요.
              </div>
            )}

            <div className="student-input-row">
              <input
                placeholder="번호"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />

              <input
                placeholder="이름"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option>남</option>
                <option>여</option>
              </select>
            </div>

            <textarea
              placeholder="유의사항 (건강 및 참고사항)"
              value={form.health}
              onChange={(e) => setForm({ ...form, health: e.target.value })}
            />

            {!editId && (
              <div className="button-row">
                <button className="save-btn" onClick={saveStudent}>
                  학생 추가
                </button>
              </div>
            )}
          </>
      </section>
      )}


      <section className={`card roster-search-card collapsible-card roster-search-card-hidden ${isSearchOpen ? "open" : "collapsed"}`}>
        <div className="roster-collapsible-header">
          <div>
            <h3>학생 검색</h3>
            {!isSearchOpen && <p>{search ? `검색어: ${search}` : "필요할 때만 펼쳐 검색합니다."}</p>}
          </div>
          <button className="setting-btn compact-toggle-btn" onClick={() => setIsSearchOpen((v) => !v)}>
            {isSearchOpen ? "접기" : "펼치기"}
          </button>
        </div>
        {isSearchOpen && (
          <div className="roster-search-row">
            <input
              placeholder="🔍 학생 이름 또는 번호 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="setting-btn" onClick={() => setSearch("")}>초기화</button>
          </div>
        )}
      </section>

      <section className="card roster-list-card">
        <table className="student-table roster-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>이름</th>
              <th>성별</th>
              <th>유의사항</th>
              <th>학생카드</th>
            </tr>
          </thead>

          <tbody>
            {list.map((student) => (
              <tr key={student.id}>
                <td>{student.number}</td>
                <td className="paps-name-cell">{student.name}</td>
                <td>{student.gender}</td>
                <td className="roster-health-cell">
                  {(() => {
                    const records = normalizeHealthRecords(student);
                    return (
                      <button
                        type="button"
                        className={`roster-health-chip ${records.length ? "has-records" : "empty"}`}
                        onClick={() => openHealthModal(student)}
                        title={records.length ? records.map((record) => `[${record.date}] ${record.text}`).join("\n") : "유의사항 작성"}
                      >
                        {records.length ? `유의사항 ${records.length}건` : "유의사항 작성"}
                      </button>
                    );
                  })()}
                </td>
                <td>
                  <button
                    className={`${student.gender === "여" ? "view-btn-female" : "view-btn-male"} ${String(student.health || "").trim() ? "has-note" : ""}`}
                    title={String(student.health || "").trim() ? `유의사항: ${student.health}` : "학생카드 보기"}
                    onClick={() => setSelectedStudent(student)}
                  >
                    보기
                  </button>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {healthModalStudent && (
        <div className="modal-bg roster-health-modal-bg">
          <div className="modal roster-health-modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setHealthModalStudent(null)} aria-label="닫기">×</button>
            <h2>{healthModalStudent.className} {healthModalStudent.number}번 {healthModalStudent.name} 유의사항</h2>
            <div className="roster-health-input-row">
              <input type="date" value={healthNoteDate} onChange={(event) => setHealthNoteDate(event.target.value)} />
              <textarea value={healthNoteText} onChange={(event) => setHealthNoteText(event.target.value)} placeholder="유의사항을 입력하세요." />
              <button type="button" className="save-btn" onClick={addHealthRecord}>저장</button>
            </div>
            <div className="roster-health-record-list">
              {normalizeHealthRecords(healthModalStudent).length ? normalizeHealthRecords(healthModalStudent).map((record) => (
                <div className="roster-health-record-card" key={record.id}>
                  <strong>{record.date}</strong>
                  <p>{record.text}</p>
                  <button type="button" className="delete-btn" onClick={() => deleteHealthRecord(record.id)}>삭제</button>
                </div>
              )) : <div className="roster-health-empty">아직 기록된 유의사항이 없습니다.</div>}
            </div>
          </div>
        </div>
      )}

      {selectedStudent && (
        <StudentCard
          student={selectedStudent}
          onClose={() => setSelectedStudent(null)}
          onUpdateHealth={updateStudentHealth}
        />
      )}
    </div>
  );
}
