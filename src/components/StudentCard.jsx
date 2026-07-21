import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import { evaluatePaps, getPapsUnit } from "../utils/papsStandards";

const defaultPapsItems = [
  { id: "grip", name: "악력", attempts: 4, best: true, grade: true },
  { id: "longjump", name: "제자리멀리뛰기", attempts: 2, best: true, grade: true },
  { id: "sitreach", name: "앉아윗몸앞으로굽히기", attempts: 2, best: true, grade: true },
  { id: "shuttle", name: "왕복오래달리기", attempts: 1, best: false, grade: true },
  { id: "bmi", name: "BMI", attempts: 0, best: false, grade: true },
];

const papsGradeStandards = {
  "중2": {
    male: {
      "왕복오래달리기": [
        { label: "5등급", min: -Infinity, max: 21 },
        { label: "4등급", min: 22, max: 37 },
        { label: "3등급", min: 38, max: 51 },
        { label: "2등급", min: 52, max: 65 },
        { label: "1등급", min: 66, max: Infinity },
      ],
      "악력": [
        { label: "5등급", min: -Infinity, max: 21.9 },
        { label: "4등급", min: 22.0, max: 28.4 },
        { label: "3등급", min: 28.5, max: 36.9 },
        { label: "2등급", min: 37.0, max: 44.4 },
        { label: "1등급", min: 44.5, max: Infinity },
      ],
      "앉아윗몸앞으로굽히기": [
        { label: "5등급", min: -Infinity, max: -4.1 },
        { label: "4등급", min: -4.0, max: 1.9 },
        { label: "3등급", min: 2.0, max: 5.9 },
        { label: "2등급", min: 6.0, max: 9.9 },
        { label: "1등급", min: 10.0, max: Infinity },
      ],
      "제자리멀리뛰기": [
        { label: "5등급", min: -Infinity, max: 136.0 },
        { label: "4등급", min: 136.1, max: 168.0 },
        { label: "3등급", min: 169.1, max: 187.0 },
        { label: "2등급", min: 187.1, max: 218.0 },
        { label: "1등급", min: 218.1, max: Infinity },
      ],
      BMI: [
        { label: "마름", min: -Infinity, max: 15.7 },
        { label: "정상", min: 15.8, max: 23.8 },
        { label: "과체중", min: 23.9, max: 24.9 },
        { label: "경도비만", min: 25.0, max: 29.9 },
        { label: "고도비만", min: 30.0, max: Infinity },
      ],
    },
    female: {
      "왕복오래달리기": [
        { label: "5등급", min: -Infinity, max: 14 },
        { label: "4등급", min: 15, max: 20 },
        { label: "3등급", min: 21, max: 28 },
        { label: "2등급", min: 29, max: 39 },
        { label: "1등급", min: 40, max: Infinity },
      ],
      "악력": [
        { label: "5등급", min: -Infinity, max: 13.9 },
        { label: "4등급", min: 14.0, max: 19.4 },
        { label: "3등급", min: 19.5, max: 25.4 },
        { label: "2등급", min: 25.5, max: 35.9 },
        { label: "1등급", min: 36.0, max: Infinity },
      ],
      "앉아윗몸앞으로굽히기": [
        { label: "5등급", min: -Infinity, max: 1.9 },
        { label: "4등급", min: 2.0, max: 7.9 },
        { label: "3등급", min: 8.0, max: 10.9 },
        { label: "2등급", min: 11.0, max: 14.9 },
        { label: "1등급", min: 15.0, max: Infinity },
      ],
      "제자리멀리뛰기": [
        { label: "5등급", min: -Infinity, max: 100.0 },
        { label: "4등급", min: 100.1, max: 127.0 },
        { label: "3등급", min: 127.1, max: 145.0 },
        { label: "2등급", min: 145.1, max: 183.0 },
        { label: "1등급", min: 183.1, max: Infinity },
      ],
      BMI: [
        { label: "마름", min: -Infinity, max: 15.6 },
        { label: "정상", min: 15.7, max: 22.7 },
        { label: "과체중", min: 22.8, max: 24.9 },
        { label: "경도비만", min: 25.0, max: 29.9 },
        { label: "고도비만", min: 30.0, max: Infinity },
      ],
    },
  },
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

export default function StudentCard({ student, onClose, onUpdateHealth }) {
  const [isHealthEditing, setIsHealthEditing] = useState(false);
  const [healthDraft, setHealthDraft] = useState("");
  const [healthDate, setHealthDate] = useState(todayIso());

  useEffect(() => {
    setHealthDraft("");
    setHealthDate(todayIso());
    setIsHealthEditing(false);
  }, [student.id, student.health]);

  const healthRecords = normalizeHealthRecords(student);

  const saveHealthNote = () => {
    if (!healthDraft.trim()) return;
    const nextRecords = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, date: healthDate || todayIso(), text: healthDraft.trim() },
      ...healthRecords,
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    onUpdateHealth?.(student.id, makeHealthSummary(nextRecords), nextRecords);
    setHealthDraft("");
    setIsHealthEditing(false);
  };

  const deleteHealthNote = (recordId) => {
    const nextRecords = healthRecords.filter((record) => record.id !== recordId);
    onUpdateHealth?.(student.id, makeHealthSummary(nextRecords), nextRecords);
  };
  const photoKey = `student_photo_${student.id}`;
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";

  const [photo, setPhoto] = useState(localStorage.getItem(photoKey) || "");
  const adjustKey = `student_photo_adjust_${student.id}`;
  const defaultAdjust = { x: 0, y: 0, scale: 1.08 };
  const [photoAdjust, setPhotoAdjust] = useState(() => {
    try {
      return { ...defaultAdjust, ...(JSON.parse(localStorage.getItem(adjustKey) || "{}")) };
    } catch {
      return defaultAdjust;
    }
  });
  const [adjustMessage, setAdjustMessage] = useState("");
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, pointerId: null });

  useEffect(() => {
    const handlePhotoUpdate = (event) => {
      if (event.detail?.studentId !== student.id) return;
      const nextPhoto = event.detail?.url || localStorage.getItem(photoKey) || "";
      if (nextPhoto) setPhoto(nextPhoto);
      if (event.detail?.adjust) setPhotoAdjust({ ...defaultAdjust, ...event.detail.adjust });
    };
    window.addEventListener("peon-student-photo-updated", handlePhotoUpdate);
    return () => window.removeEventListener("peon-student-photo-updated", handlePhotoUpdate);
  }, [student.id, photoKey]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return undefined;

    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    const unsubscribe = onSnapshot(dataDoc, (snapshot) => {
      const data = snapshot.data() || {};
      const url = data.photos?.[student.id];
      const cloudAdjust = data.adjustments?.[student.id];
      if (url) {
        localStorage.setItem(photoKey, url);
        setPhoto(url);
      }
      if (cloudAdjust) {
        const merged = { ...defaultAdjust, ...cloudAdjust };
        localStorage.setItem(adjustKey, JSON.stringify(merged));
        setPhotoAdjust(merged);
      }
    });

    return () => unsubscribe();
  }, [student.id, photoKey, year, semester]);

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const user = auth.currentUser;
    if (!user) return;

    const storagePath = `peonUsers/${user.uid}/studentPhotos/${year}_${semester}/${student.id}_${Date.now()}_${file.name}`;
    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, file);
    const downloadUrl = await getDownloadURL(fileRef);

    localStorage.setItem(photoKey, downloadUrl);
    setPhoto(downloadUrl);
    const resetAdjust = { ...defaultAdjust };
    localStorage.setItem(adjustKey, JSON.stringify(resetAdjust));
    setPhotoAdjust(resetAdjust);

    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    await setDoc(
      dataDoc,
      {
        photos: {
          [student.id]: downloadUrl,
        },
        adjustments: {
          [student.id]: resetAdjust,
        },
        year,
        semester,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  };

  const nudgePhoto = (dx, dy) => {
    setPhotoAdjust((prev) => ({ ...prev, x: Math.max(-90, Math.min(90, Number(prev.x || 0) + dx)), y: Math.max(-90, Math.min(90, Number(prev.y || 0) + dy)) }));
    setAdjustMessage("");
  };

  const zoomPhoto = (delta) => {
    setPhotoAdjust((prev) => ({ ...prev, scale: Math.max(0.85, Math.min(1.45, Number(prev.scale || 1) + delta)) }));
    setAdjustMessage("");
  };

  const resetPhotoAdjust = () => {
    setPhotoAdjust({ ...defaultAdjust });
    setAdjustMessage("");
  };

  const savePhotoAdjust = async () => {
    const user = auth.currentUser;
    localStorage.setItem(adjustKey, JSON.stringify(photoAdjust));
    if (user) {
      const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
      await setDoc(
        dataDoc,
        {
          adjustments: { [student.id]: photoAdjust },
          year,
          semester,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    setAdjustMessage("사진 위치를 저장했습니다.");
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getPointFromEvent = (event) => ({
    x: Number(event.clientX ?? event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX ?? 0),
    y: Number(event.clientY ?? event.touches?.[0]?.clientY ?? event.changedTouches?.[0]?.clientY ?? 0),
  });

  const startPhotoDrag = (event) => {
    if (!photo) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    const point = getPointFromEvent(event);
    dragRef.current = {
      active: true,
      startX: point.x,
      startY: point.y,
      baseX: Number(photoAdjust.x || 0),
      baseY: Number(photoAdjust.y || 0),
      pointerId: event.pointerId ?? null,
    };
    setAdjustMessage("사진을 끌어서 얼굴을 가운데에 맞춘 뒤 저장하세요.");
  };

  const movePhotoDrag = (event) => {
    if (!dragRef.current.active) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const point = getPointFromEvent(event);
    const nextX = clamp(dragRef.current.baseX + point.x - dragRef.current.startX, -130, 130);
    const nextY = clamp(dragRef.current.baseY + point.y - dragRef.current.startY, -130, 130);
    setPhotoAdjust((prev) => ({ ...prev, x: nextX, y: nextY }));
  };

  const endPhotoDrag = (event) => {
    if (!dragRef.current.active) return;
    event?.currentTarget?.releasePointerCapture?.(dragRef.current.pointerId);
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
  };

  const getAssessmentData = () => {
    const year = localStorage.getItem("peon_year") || "2026학년도";
    const semester = localStorage.getItem("peon_semester") || "1학기";

    const activities = JSON.parse(
      localStorage.getItem(`peon_${year}_${semester}_assessment`) || "[]"
    );

    const scores = JSON.parse(
      localStorage.getItem(`peon_${year}_${semester}_assessment_scores`) || "{}"
    );

    const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();

    const normalizeItemType = (type) => {
      if (type === "자세평가" || type === "참여도") return "choice";
      if (type === "횟수" || type === "시간" || type === "거리") return "number";
      if (type === "직접점수입력") return "direct";
      return type || "direct";
    };

    const getRuleLabel = (rule) =>
      String(rule?.label ?? rule?.condition ?? rule?.name ?? rule?.grade ?? rule?.level ?? "");

    const getRuleScore = (rule) =>
      Number(rule?.score ?? rule?.point ?? rule?.value ?? 0) || 0;

    const getItemScore = (item, value) => {
      if (value === undefined || value === null || value === "") return 0;

      const type = normalizeItemType(item.type);
      const text = String(value).trim();
      const numericValue = Number(text);

      if (type === "direct") return Number(value || 0);

      // 현재 수행평가 점수입력은 선택형 값을 실제 점수 숫자로 저장합니다.
      if (type === "choice") {
        if (!Number.isNaN(numericValue) && text !== "") return numericValue;

        const matched = (item.rules || []).find((rule) =>
          normalize(getRuleLabel(rule)) === normalize(value)
        );

        return matched ? getRuleScore(matched) : 0;
      }

      if (type === "number") {
        if (Number.isNaN(numericValue)) return 0;

        const matched = (item.rules || []).find((rule) => {
          const min = rule.min === "" || rule.min === undefined ? -Infinity : Number(rule.min);
          const max = rule.max === "" || rule.max === undefined ? Infinity : Number(rule.max);
          return numericValue >= min && numericValue <= max;
        });

        return matched ? getRuleScore(matched) : numericValue;
      }

      return 0;
    };

    const className = student.className || "2-1";

    const assessmentRows = (activities || [])
      .map((activity) => {
        let activityScore = 0;
        let hasInput = false;

        // NEIS PDF/엑셀로 일괄 매칭한 점수는 항목(items) 유무와 상관없이
        // activity.directTotal 자리에 저장되므로, 있으면 이 값을 우선 사용합니다.
        const directTotal = scores?.[activity.id]?.[className]?.[student.id]?.directTotal;
        if (directTotal !== undefined && directTotal !== null && directTotal !== "") {
          activityScore = Number(directTotal) || 0;
          hasInput = true;
        } else {
          const items = (activity.items || []).length
            ? activity.items
            : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

          items.forEach((item) => {
            const value = scores?.[activity.id]?.[className]?.[student.id]?.[item.id];
            if (value === undefined || value === null || value === "") return;

            hasInput = true;
            activityScore += getItemScore(item, value);
          });
        }

        return {
          id: activity.id,
          name: activity.name,
          score: activityScore,
          maxScore: Number(activity.score || 0),
          hasInput,
        };
      })
      .filter((activity) => activity.hasInput);

    const totalScore = assessmentRows.reduce((sum, activity) => sum + activity.score, 0);
    const totalMaxScore = assessmentRows.reduce((sum, activity) => sum + activity.maxScore, 0);

    return { assessmentRows, totalScore, totalMaxScore };
  };

  const getPapsData = () => {
    const year = localStorage.getItem("peon_year") || "2026학년도";
    const semester = localStorage.getItem("peon_semester") || "1학기";
    const className = student.className || "2-1";

    const items = JSON.parse(
      localStorage.getItem(`peon_${year}_${semester}_paps_items`) || "null"
    ) || defaultPapsItems;

    const scores = JSON.parse(
      localStorage.getItem(`peon_${year}_${semester}_paps_scores`) || "{}"
    );

    const genderKey = student.gender === "여" ? "female" : "male";
    const gradeKey = `중${String(className).split("-")[0] || "2"}`;

    const findGradeByValue = (rules, value) => {
      const numericValue = Number(value);
      if (Number.isNaN(numericValue)) return "-";
      const matched = (rules || []).find((rule) => numericValue >= rule.min && numericValue <= rule.max);
      return matched?.label || "범위외";
    };

    const simpleGrade = (grade) =>
      String(grade)
        .replace("1등급", "1")
        .replace("2등급", "2")
        .replace("3등급", "3")
        .replace("4등급", "4")
        .replace("5등급", "5");

    const getBest = (item, record) => {
      if (!item || item.name === "BMI") return "";
      const values = Array.from({ length: item.attempts })
        .map((_, index) => Number(record[`try${index + 1}`]))
        .filter((value) => !Number.isNaN(value));
      if (values.length === 0) return "";
      return Math.max(...values);
    };

    const getBmi = (record) => {
      const height = Number(record.height);
      const weight = Number(record.weight);
      if (!height || !weight) return "";
      const meter = height / 100;
      return (weight / (meter * meter)).toFixed(1);
    };

    const papsRows = items
      .map((item) => {
        const record = scores?.[String(item.id)]?.[className]?.[student.id] || {};
        let value = "";
        let rawGrade = "-";
        let hasInput = false;

        if (item.name === "BMI") {
          value = getBmi(record);
          hasInput = Boolean(record.height || record.weight);
          const result = value ? evaluatePaps({ grade: gradeKey, gender: student.gender, itemName: item.name, value }) : null;
          rawGrade = result?.gradeLabel || "-";
        } else {
          value = getBest(item, record);
          hasInput = Array.from({ length: item.attempts }).some((_, index) => record[`try${index + 1}`]);
          const result = value === "" ? null : evaluatePaps({ grade: gradeKey, gender: student.gender, itemName: item.name, value });
          rawGrade = result?.gradeLabel || (value === "" ? "-" : "기준없음");
        }

        return {
          id: item.id,
          name: item.name,
          value,
          grade: item.name === "BMI" ? rawGrade : simpleGrade(rawGrade),
          score: value === "" ? "" : evaluatePaps({ grade: gradeKey, gender: student.gender, itemName: item.name, value })?.score ?? "",
          unit: getPapsUnit(item.name),
          rawGrade,
          hasInput,
        };
      })
      .filter((row) => row.hasInput);

    const numericGrades = papsRows
      .filter((row) => row.name !== "BMI")
      .map((row) => Number(simpleGrade(row.rawGrade)))
      .filter((value) => !Number.isNaN(value));

    const overallGrade = numericGrades.length
      ? Math.round(numericGrades.reduce((sum, value) => sum + value, 0) / numericGrades.length)
      : null;

    return { papsRows, overallGrade };
  };

  const { assessmentRows, totalScore, totalMaxScore } = getAssessmentData();
  const { papsRows, overallGrade } = getPapsData();

  return (
    <div className="modal-bg student-card-backdrop">
      <div className={`modal student-card-modal student-card-clean ${student.gender === "남" ? "male-card" : "female-card"}`}>
        <div className="title-row student-card-title-row">
          <h2>학생카드</h2>
          <button className="card-close-fixed" onClick={onClose} aria-label="학생카드 닫기">✕</button>
        </div>
        <label className="student-photo-file-top">
          <span>사진 변경</span>
          <input type="file" accept="image/*" onChange={handlePhoto} />
        </label>

        <div className="student-card-clean-body">
          <div className="student-card-photo-column">
            <div className="student-photo-large photo-no-label adjustable-photo-frame">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  draggable="false"
                  style={{
                    "--photo-x": `${photoAdjust.x || 0}px`,
                    "--photo-y": `${photoAdjust.y || 0}px`,
                    "--photo-scale": photoAdjust.scale || 1,
                  }}
                />
              ) : <span>👤</span>}
            </div>
          </div>

          <div className="student-card-info-column">
            <section className="card student-card-basic-box">
              <h3>기본정보</h3>
              <div className="student-card-info-list">
                <div><span>이름</span><strong>{student.name}</strong></div>
                <div><span>학급</span><strong>{student.className}</strong></div>
                <div><span>번호</span><strong>{student.number}</strong></div>
                <div><span>성별</span><strong>{student.gender}</strong></div>
                <div className="student-card-health-summary">
                  <span>유의사항</span>
                  <strong>{healthRecords.length ? `${healthRecords.length}건` : "-"}</strong>
                </div>
              </div>
              <div className="student-card-health-editor">
                <button type="button" className="setting-btn student-health-edit-btn" onClick={() => setIsHealthEditing((prev) => !prev)}>
                  {isHealthEditing ? "작성 닫기" : "유의사항 작성"}
                </button>
                {isHealthEditing && (
                  <div className="student-health-edit-panel">
                    <input type="date" value={healthDate} onChange={(event) => setHealthDate(event.target.value)} />
                    <textarea
                      value={healthDraft}
                      onChange={(event) => setHealthDraft(event.target.value)}
                      placeholder="유의사항을 입력하세요."
                    />
                    <div className="student-health-edit-actions">
                      <button type="button" className="cancel-btn" onClick={() => { setHealthDraft(""); setIsHealthEditing(false); }}>취소</button>
                      <button type="button" className="save-btn" onClick={saveHealthNote}>저장</button>
                    </div>
                  </div>
                )}
                <div className="student-health-record-list">
                  {healthRecords.length ? healthRecords.map((record) => (
                    <div className="student-health-record-card" key={record.id}>
                      <strong>{record.date}</strong>
                      <p>{record.text}</p>
                      <button type="button" className="delete-btn" onClick={() => deleteHealthNote(record.id)}>삭제</button>
                    </div>
                  )) : <div className="student-health-empty">기록된 유의사항이 없습니다.</div>}
                </div>
              </div>
            </section>

            <div className="student-card-summary-grid">
              <section className="card">
                <h3>수행평가</h3>
                {assessmentRows.length > 0 ? (
                  <>
                    {assessmentRows.map((activity) => (
                      <div key={activity.id} className="student-score-row">
                        <span>{activity.name}</span>
                        <strong>{activity.score}점 / {activity.maxScore}점</strong>
                      </div>
                    ))}
                    <hr />
                    <div className="student-score-total">총점 <strong>{totalScore}점 / {totalMaxScore}점</strong></div>
                  </>
                ) : <p>입력된 수행평가 점수가 없습니다.</p>}
              </section>

              <section className="card">
                <h3>PAPS</h3>
                {papsRows.length > 0 ? (
                  <>
                    {papsRows.map((row) => (
                      <div key={row.id} className="student-score-row paps-card-row">
                        <span>{row.name}</span>
                        <strong>{`${row.value}${row.unit} · ${row.name === "BMI" ? row.grade : `${row.grade}등급`}(${row.score}점)`}</strong>
                      </div>
                    ))}
                    {overallGrade && <><hr /><div className="student-score-total">종합 <strong>등급 {overallGrade}</strong></div></>}
                  </>
                ) : <p>입력된 PAPS 기록이 없습니다.</p>}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
