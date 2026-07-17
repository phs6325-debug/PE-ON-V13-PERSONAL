import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import SharedFileBox from "./SharedFileBox";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];

const defaultItems = [
  { id: "grip", name: "악력", attempts: 4, best: true, grade: true },
  { id: "longjump", name: "제자리멀리뛰기", attempts: 2, best: true, grade: true },
  { id: "sitreach", name: "앉아윗몸앞으로굽히기", attempts: 2, best: true, grade: true },
  { id: "shuttle", name: "왕복오래달리기", attempts: 1, best: false, grade: true },
  { id: "bmi", name: "BMI", attempts: 0, best: false, grade: true },
];

const today = () => new Date().toISOString().slice(0, 10);

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
      "BMI": [
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
      "BMI": [
        { label: "마름", min: -Infinity, max: 15.6 },
        { label: "정상", min: 15.7, max: 22.7 },
        { label: "과체중", min: 22.8, max: 24.9 },
        { label: "경도비만", min: 25.0, max: 29.9 },
        { label: "고도비만", min: 30.0, max: Infinity },
      ],
    },
  },
};


export default function Paps() {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";

  const itemKey = `peon_${year}_${semester}_paps_items`;
  const scoreKey = `peon_${year}_${semester}_paps_scores`;
  const standardKey = `peon_${year}_${semester}_paps_standard_file`;
  const studentKey = `peon_${year}_${semester}_students`;

  const [tab, setTab] = useState("setting");
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem(itemKey) || "null") || defaultItems);
  const [scores, setScores] = useState(() => JSON.parse(localStorage.getItem(scoreKey) || "{}"));
  const [students, setStudents] = useState(() => JSON.parse(localStorage.getItem(studentKey) || "{}"));

  const [selectedId, setSelectedId] = useState(items[0]?.id || "grip");
  const [papsClass, setPapsClass] = useState("2-1");
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [standardFiles, setStandardFiles] = useState(() => {
    const saved = JSON.parse(localStorage.getItem(standardKey) || "null");
    if (saved && (saved.male || saved.female || saved.bmi)) return saved;
    if (saved?.name) return { male: saved, female: null, bmi: null };
    return { male: null, female: null, bmi: null };
  });
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const [checkedExcelIds, setCheckedExcelIds] = useState(["all"]);
  const [gradeSummaryOpen, setGradeSummaryOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const cloudReadyRef = useRef(false);
  const lastSavedJsonRef = useRef("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => setCurrentUser(nextUser));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const user = currentUser;
    if (!user) {
      cloudReadyRef.current = true;
      return undefined;
    }

    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_paps_data`);
    cloudReadyRef.current = false;

    const unsubscribe = onSnapshot(
      dataDoc,
      async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() || {};
          const cloudItems = data.items || defaultItems;
          const cloudScores = data.scores || {};
          const json = JSON.stringify({ items: cloudItems, scores: cloudScores });
          lastSavedJsonRef.current = json;
          localStorage.setItem(itemKey, JSON.stringify(cloudItems));
          localStorage.setItem(scoreKey, JSON.stringify(cloudScores));
          setItems(cloudItems);
          setScores(cloudScores);
          cloudReadyRef.current = true;
          return;
        }

        const localItems = JSON.parse(localStorage.getItem(itemKey) || "null") || defaultItems;
        const localScores = JSON.parse(localStorage.getItem(scoreKey) || "{}");
        const json = JSON.stringify({ items: localItems, scores: localScores });
        lastSavedJsonRef.current = json;
        await setDoc(dataDoc, {
          items: localItems,
          scores: localScores,
          year,
          semester,
          updatedAt: new Date().toISOString(),
        });
        cloudReadyRef.current = true;
      },
      (error) => {
        console.error("PAPS sync error", error);
        cloudReadyRef.current = false;
      }
    );

    return () => unsubscribe();
  }, [year, semester, itemKey, scoreKey, currentUser]);

  useEffect(() => {
    localStorage.setItem(itemKey, JSON.stringify(items));
    localStorage.setItem(scoreKey, JSON.stringify(scores));

    if (!cloudReadyRef.current) return;

    const user = currentUser;
    if (!user) return;

    const currentJson = JSON.stringify({ items, scores });
    if (currentJson === lastSavedJsonRef.current) return;
    lastSavedJsonRef.current = currentJson;

    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_paps_data`);
    const timer = window.setTimeout(() => {
      setDoc(dataDoc, {
        items,
        scores,
        year,
        semester,
        updatedAt: new Date().toISOString(),
      }).catch((error) => console.error("PAPS save error", error));
    }, 500);

    return () => window.clearTimeout(timer);
  }, [items, scores, itemKey, scoreKey, year, semester, currentUser]);

  const selected = useMemo(
    () => items.find((item) => String(item.id) === String(selectedId)) || items[0],
    [items, selectedId]
  );

  const classStudents = students[papsClass] || [];

  const showMessage = (message) => {
    setSaveMessage(message);
    window.clearTimeout(window.__peonPapsTimer);
    window.__peonPapsTimer = window.setTimeout(() => setSaveMessage(""), 1800);
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

  const inferClassFromRowOrFile = (row, fileName) => {
    const fullClass = getCell(row, ["학급", "반", "반명", "학년반", "className"]);
    const grade = getCell(row, ["학년", "grade"]);
    const ban = getCell(row, ["반명", "반", "class", "className"]);
    const text = String(fullClass || ban || fileName || "");
    const matched = text.match(/([1-3])\s*-?\s*([1-9])/);
    if (matched) return `${matched[1]}-${matched[2]}`;

    const fileBan = String(fileName || "").match(/([1-9])\s*반/);
    const gradeNumber = String(grade || papsClass.split("-")[0] || "2").replace(/[^0-9]/g, "") || "2";
    if (fileBan) return `${gradeNumber}-${fileBan[1]}`;

    const classNumber = String(ban || "").replace(/[^0-9]/g, "");
    if (classNumber) return `${gradeNumber}-${classNumber}`;
    return papsClass;
  };

  const normalizeGender = (value) => {
    const text = String(value ?? "").trim();
    const compact = text.replace(/\s/g, "").toLowerCase();
    if (compact === "2" || compact === "2.0" || compact.includes("여") || compact.includes("female") || compact === "f") return "여";
    return "남";
  };

  const readWorkbookRows = async (file) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const rows = [];

    const isUsefulHeader = (value) => {
      const text = normalize(value);
      return [
        "학생성명", "학생명", "성명", "이름", "번호", "출석번호", "반", "반명",
        "악력", "제자리멀리뛰기", "앉아윗몸", "셔틀런", "왕복오래달리기",
        "신장", "키", "체중", "몸무게"
      ].some((keyword) => text.includes(normalize(keyword)));
    };

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

      if (!matrix.length) return;

      let headerIndex = matrix.findIndex((row) => {
        const usefulCount = (row || []).filter(isUsefulHeader).length;
        return usefulCount >= 2;
      });

      if (headerIndex < 0) headerIndex = 0;

      const headers = (matrix[headerIndex] || []).map((header, index) => {
        const text = String(header || "").trim();
        return text || `열${index + 1}`;
      });

      matrix.slice(headerIndex + 1).forEach((line) => {
        if (!line || line.every((cell) => String(cell ?? "").trim() === "")) return;

        const row = {};
        headers.forEach((header, index) => {
          row[header] = line[index] ?? "";
        });

        row.__sheetName = sheetName;
        row.__fileName = file.name;
        rows.push(row);
      });
    });

    return rows;
  };

  const getFirstValue = (row, candidates) => {
    for (const candidate of candidates) {
      const value = getCell(row, [candidate]);
      if (value !== "" && value !== undefined && value !== null) return value;
    }
    return "";
  };

  const putTryValues = (record, values) => {
    values.forEach((value, index) => {
      if (value !== "" && value !== undefined && value !== null) {
        record[`try${index + 1}`] = String(value);
      }
    });
  };

  const saveStudentsToCloud = async (nextStudents) => {
    const user = currentUser || auth.currentUser;
    if (!user) return;
    const studentDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_students`);
    await setDoc(studentDoc, {
      students: nextStudents,
      year,
      semester,
      ownerEmail: user.email || "",
      updatedAt: new Date().toISOString(),
    });
  };

  const handlePapsRecordUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    try {
      const nextStudents = { ...students };
      const nextScores = { ...scores };
      let importedStudents = 0;
      let importedRecords = 0;

      const ensureItem = (itemId, className, studentId) => {
        nextScores[itemId] = { ...(nextScores[itemId] || {}) };
        nextScores[itemId][className] = { ...(nextScores[itemId][className] || {}) };
        nextScores[itemId][className][studentId] = { ...(nextScores[itemId][className][studentId] || {}) };
        return nextScores[itemId][className][studentId];
      };

      for (const file of files) {
        const rows = await readWorkbookRows(file);
        rows.forEach((row) => {
          const name = String(getCell(row, ["학생성명", "학생명", "성명", "이름", "name"])).trim();
          if (!name) return;

          const className = inferClassFromRowOrFile(row, file.name);
          const number = String(getCell(row, ["번호", "출석번호", "학번", "number"])).replace(/\.0$/, "").trim();
          const gender = normalizeGender(getCell(row, ["성별", "남녀", "gender"]));
          const health = String(getCell(row, ["유의사항", "건강상유의사항", "건강", "참고사항", "health"])).trim();

          const list = [...(nextStudents[className] || [])];
          let student = list.find((item) => String(item.number) === String(number) && item.name === name);
          if (!student) {
            student = {
              id: `${className}-${number || list.length + 1}-${name}`,
              className,
              number: number || String(list.length + 1),
              name,
              gender,
              health,
            };
            list.push(student);
            importedStudents += 1;
          } else {
            student = { ...student, gender: student.gender || gender, health: student.health || health };
            const idx = list.findIndex((item) => item.id === student.id);
            list[idx] = student;
          }

          nextStudents[className] = list.sort((a, b) => Number(a.number) - Number(b.number));

          const shuttle = getFirstValue(row, ["왕복오래달리기", "왕복오래달리기(회)", "오래달리기", "셔틀런", "20m왕복오래달리기"]);
          const gripValues = [
            getFirstValue(row, ["악력1", "악력 1", "악력1차", "악력 1차", "악력"]),
            getFirstValue(row, ["악력2", "악력 2", "악력2차", "악력 2차"]),
            getFirstValue(row, ["악력3", "악력 3", "악력3차", "악력 3차"]),
            getFirstValue(row, ["악력4", "악력 4", "악력4차", "악력 4차"]),
          ];
          const longjumpValues = [
            getFirstValue(row, ["제자리멀리뛰기1", "제자리 멀리뛰기1", "제자리멀리뛰기 1", "제자리멀리뛰기1차", "제자리멀리뛰기"]),
            getFirstValue(row, ["제자리멀리뛰기2", "제자리 멀리뛰기2", "제자리멀리뛰기 2", "제자리멀리뛰기2차"]),
          ];
          const sitreachValues = [
            getFirstValue(row, ["앉아윗몸앞으로굽히기1", "앉아윗몸 앞으로 굽히기1", "앉아윗몸1", "좌전굴1", "앉아윗몸앞으로굽히기", "앉아윗몸", "좌전굴"]),
            getFirstValue(row, ["앉아윗몸앞으로굽히기2", "앉아윗몸 앞으로 굽히기2", "앉아윗몸2", "좌전굴2"]),
          ];
          const height = getFirstValue(row, ["신장", "키", "신장(cm)", "키(cm)", "height"]);
          const weight = getFirstValue(row, ["체중", "몸무게", "체중(kg)", "몸무게(kg)", "weight"]);

          if (shuttle !== "") {
            ensureItem("shuttle", className, student.id).try1 = String(shuttle);
            importedRecords += 1;
          }

          if (gripValues.some((value) => value !== "")) {
            putTryValues(ensureItem("grip", className, student.id), gripValues);
            importedRecords += gripValues.filter((value) => value !== "").length;
          }

          if (longjumpValues.some((value) => value !== "")) {
            putTryValues(ensureItem("longjump", className, student.id), longjumpValues);
            importedRecords += longjumpValues.filter((value) => value !== "").length;
          }

          if (sitreachValues.some((value) => value !== "")) {
            putTryValues(ensureItem("sitreach", className, student.id), sitreachValues);
            importedRecords += sitreachValues.filter((value) => value !== "").length;
          }

          if (height !== "" || weight !== "") {
            const bmiRecord = ensureItem("bmi", className, student.id);
            if (height !== "") bmiRecord.height = String(height);
            if (weight !== "") bmiRecord.weight = String(weight);
            importedRecords += 1;
          }
        });
      }

      localStorage.setItem(studentKey, JSON.stringify(nextStudents));
      localStorage.setItem(scoreKey, JSON.stringify(nextScores));
      setStudents(nextStudents);
      setScores(nextScores);
      await saveStudentsToCloud(nextStudents);
      showMessage(`PAPS 파일을 가져왔습니다. 명단 ${importedStudents}명 추가/갱신, 기록 ${importedRecords}건 반영`);
    } catch (error) {
      console.error("PAPS upload error", error);
      showMessage("PAPS 업로드 중 오류가 발생했습니다. 엑셀 헤더 행 또는 파일 형식을 확인해 주세요.");
    }

    event.target.value = "";
  };

  const handleStandardFile = (type, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = {
      name: file.name,
      appliedAt: today(),
    };

    const next = {
      ...standardFiles,
      [type]: data,
    };

    localStorage.setItem(standardKey, JSON.stringify(next));
    setStandardFiles(next);
    showMessage(`${getStandardLabel(type)} 기준 파일이 등록되었습니다.`);
  };

  const applyStandards = () => {
    localStorage.setItem(standardKey, JSON.stringify(standardFiles));
    showMessage("PAPS 기준파일을 적용했습니다. 중2 남/여 기준으로 자동등급 계산이 적용됩니다.");
  };

  const getStandardLabel = (type) => {
    if (type === "male") return "남자";
    if (type === "female") return "여자";
    return "BMI";
  };

  const getStudentRecord = (studentId) => {
    return scores?.[String(selected?.id)]?.[papsClass]?.[studentId] || {};
  };

  const updateRecord = (studentId, key, value) => {
    if (!selected) return;

    const itemId = String(selected.id);

    setScores({
      ...scores,
      [itemId]: {
        ...(scores[itemId] || {}),
        [papsClass]: {
          ...((scores[itemId] || {})[papsClass] || {}),
          [studentId]: {
            ...(((scores[itemId] || {})[papsClass] || {})[studentId] || {}),
            [key]: value,
          },
        },
      },
    });
  };

  const getBest = (record) => {
    if (!selected || selected.name === "BMI") return "";

    const values = Array.from({ length: selected.attempts })
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

  const getStudentGenderKey = (student) => {
    return student?.gender === "여" ? "female" : "male";
  };

  const getSchoolGradeKey = () => {
    const gradeNumber = String(papsClass).split("-")[0] || "2";
    return `중${gradeNumber}`;
  };

  const findGradeByValue = (rules, value) => {
    const numericValue = Number(value);

    if (Number.isNaN(numericValue)) return "-";
    if (!rules || rules.length === 0) return "기준없음";

    const matched = rules.find(
      (rule) => numericValue >= rule.min && numericValue <= rule.max
    );

    if (matched) return matched.label;

    const sortedRules = [...rules].sort((a, b) => a.min - b.min);

    const lowestRule = sortedRules[0];
    const highestRule = sortedRules[sortedRules.length - 1];

    if (numericValue > highestRule.max) return highestRule.label;
    if (numericValue < lowestRule.min) return lowestRule.label;

    return "-";
  };

  const getGradeLabel = (record, student) => {
    if (!selected) return "-";

    const gradeKey = getSchoolGradeKey();
    const genderKey = getStudentGenderKey(student);
    const rules = papsGradeStandards?.[gradeKey]?.[genderKey]?.[selected.name];

    if (selected.name === "BMI") {
      const bmi = getBmi(record);
      if (bmi === "") return "-";
      return findGradeByValue(rules, bmi);
    }

    const best = getBest(record);
    if (best === "") return "-";

    if (!rules) return "기준없음";
    return findGradeByValue(rules, best);
  };

  const getSimpleGrade = (record, student) => {
    const grade = String(getGradeLabel(record, student));

    return grade
      .replace("1등급", "1")
      .replace("2등급", "2")
      .replace("3등급", "3")
      .replace("4등급", "4")
      .replace("5등급", "5");
  };

  const hasInput = (record) => {
    if (!selected) return false;
    if (selected.name === "BMI") return Boolean(record.height || record.weight);
    return Array.from({ length: selected.attempts }).some((_, index) => record[`try${index + 1}`]);
  };

  const toggleStudent = (studentId) => {
    setSelectedStudents((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const toggleAll = () => {
    const ids = classStudents.map((student) => student.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedStudents.includes(id));
    setSelectedStudents(allSelected ? [] : ids);
  };

  const saveSelected = () => {
    if (selectedStudents.length === 0) {
      showMessage("저장할 학생을 선택하세요.");
      return;
    }
    localStorage.setItem(scoreKey, JSON.stringify(scores));
    showMessage(`${selectedStudents.length}명 PAPS 기록을 저장했습니다.`);
  };

  const editSelected = () => {
    if (selectedStudents.length === 0) {
      showMessage("수정할 학생을 선택하세요.");
      return;
    }
    showMessage(`${selectedStudents.length}명 기록을 수정할 수 있습니다.`);
  };

  const deleteSelected = () => {
    if (!selected || selectedStudents.length === 0) {
      showMessage("삭제할 학생을 선택하세요.");
      return;
    }

    const itemId = String(selected.id);
    const nextScores = { ...scores };
    const nextItem = { ...(nextScores[itemId] || {}) };
    const nextClass = { ...(nextItem[papsClass] || {}) };

    selectedStudents.forEach((studentId) => delete nextClass[studentId]);

    nextItem[papsClass] = nextClass;
    nextScores[itemId] = nextItem;
    setScores(nextScores);
    setSelectedStudents([]);
    showMessage("선택한 학생의 현재 종목 기록을 삭제했습니다.");
  };


  const toggleExcelCheck = (id) => {
    setCheckedExcelIds((prev) => {
      if (id === "all") return ["all"];
      const withoutAll = prev.filter((value) => value !== "all");
      return withoutAll.includes(id)
        ? withoutAll.filter((value) => value !== id)
        : [...withoutAll, id];
    });
  };

  const safeExcel = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const getRecordForItem = (item, student) => {
    return scores?.[String(item.id)]?.[papsClass]?.[student.id] || {};
  };

  const getBestForItem = (item, record) => {
    if (!item || item.name === "BMI") return "";
    const values = Array.from({ length: Number(item.attempts) || 0 })
      .map((_, index) => {
        const raw = record?.[`try${index + 1}`];
        if (raw === "" || raw === null || raw === undefined) return NaN;
        return Number(raw);
      })
      .filter((value) => !Number.isNaN(value));
    if (values.length === 0) return "";
    return Math.max(...values);
  };

  const getGradeLabelForItem = (item, record, student) => {
    if (!item) return "-";
    const gradeKey = getSchoolGradeKey();
    const genderKey = getStudentGenderKey(student);
    const rules = papsGradeStandards?.[gradeKey]?.[genderKey]?.[item.name];

    if (item.name === "BMI") {
      const height = Number(record.height);
      const weight = Number(record.weight);
      if (!height || !weight) return "-";
      const meter = height / 100;
      const bmi = (weight / (meter * meter)).toFixed(1);
      return findGradeByValue(rules, bmi);
    }

    const best = getBestForItem(item, record);
    if (best === "") return "-";
    if (!rules) return "기준없음";
    return findGradeByValue(rules, best);
  };

  const makePapsExcelTable = (item) => {
    const headers = item.name === "BMI"
      ? ["번호", "이름", "성별", "신장(cm)", "체중(kg)", "BMI", "등급"]
      : [
          "번호",
          "이름",
          "성별",
          ...Array.from({ length: item.attempts }).map((_, index) => `${index + 1}차`),
          item.best ? "최고기록" : null,
          item.grade ? "등급" : null,
        ].filter(Boolean);

    const rows = classStudents.map((student) => {
      const record = getRecordForItem(item, student);
      if (item.name === "BMI") {
        const height = record.height || "";
        const weight = record.weight || "";
        const bmi = height && weight ? (() => {
          const meter = Number(height) / 100;
          return (Number(weight) / (meter * meter)).toFixed(1);
        })() : "";
        return [student.number, student.name, student.gender || "", height, weight, bmi, getGradeLabelForItem(item, record, student)];
      }

      const tries = Array.from({ length: item.attempts }).map((_, index) => record[`try${index + 1}`] || "");
      const cells = [student.number, student.name, student.gender || "", ...tries];
      if (item.best) cells.push(getBestForItem(item, record) || "");
      if (item.grade) cells.push(getGradeLabelForItem(item, record, student));
      return cells;
    });

    return `
      <h2>${safeExcel(papsClass)} ${safeExcel(item.name)} PAPS 결과</h2>
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${safeExcel(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell) => `<td>${safeExcel(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
      <br />
    `;
  };

  const downloadCheckedPapsExcel = () => {
    const targets = checkedExcelIds.length === 0 ? [] : checkedExcelIds;
    if (targets.length === 0) {
      showMessage("다운로드할 PAPS 항목을 선택하세요.");
      return;
    }

    const targetItems = targets.includes("all")
      ? items
      : items.filter((item) => targets.includes(String(item.id)));

    if (targetItems.length === 0) {
      showMessage("다운로드할 PAPS 항목을 선택하세요.");
      return;
    }

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
            th, td { border: 1px solid #999; padding: 8px; text-align: center; }
            th { background: #f1f5f9; font-weight: bold; }
            h2 { text-align: center; margin-top: 24px; }
          </style>
        </head>
        <body>
          ${targetItems.map((item) => makePapsExcelTable(item)).join("")}
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateText = today();
    const names = targets.includes("all") ? "전영역" : targetItems.map((item) => item.name).join("_");

    link.href = url;
    link.download = `${dateText}_${papsClass}_PAPS_${names}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExcelMenuOpen(false);
  };

  const getAllPapsSummary = (student) => {
    const row = {};

    items.forEach((item) => {
      const record = scores?.[String(item.id)]?.[papsClass]?.[student.id] || {};
      const value = item.name === "BMI" ? getBmi(record) : getBestForItem(item, record);
      const grade = getGradeLabelForItem(item, record, student);
      row[item.id] = {
        name: item.name,
        value: value === "" ? "-" : value,
        grade: grade || "-",
      };
    });

    return row;
  };

  const getOverallGradeForStudent = (student) => {
    const summary = getAllPapsSummary(student);
    const numericGrades = items
      .filter((item) => item.name !== "BMI")
      .map((item) => String(summary[item.id]?.grade || "").match(/[1-5]/)?.[0])
      .filter(Boolean)
      .map(Number);

    if (numericGrades.length === 0) return "-";
    return String(Math.round(numericGrades.reduce((sum, value) => sum + value, 0) / numericGrades.length));
  };

  const getAllPapsCompleted = (student) => {
    return items.some((item) => {
      const record = scores?.[String(item.id)]?.[papsClass]?.[student.id] || {};
      if (item.name === "BMI") return Boolean(getBmi(record));
      return getBestForItem(item, record) !== "";
    });
  };

  const getStats = () => {
    if (selectedId === "all") {
      const total = classStudents.length;
      const completed = classStudents.filter((student) => getAllPapsCompleted(student)).length;
      const missing = total - completed;
      const gradeCounts = { "1등급": 0, "2등급": 0, "3등급": 0, "4등급": 0, "5등급": 0, 마름: 0, 정상: 0, 과체중: 0, 경도비만: 0, 고도비만: 0 };

      classStudents.forEach((student) => {
        const summary = getAllPapsSummary(student);
        Object.values(summary).forEach((item) => {
          if (gradeCounts[item.grade] !== undefined) gradeCounts[item.grade] += 1;
        });
      });

      return { total, completed, missing, gradeCounts };
    }

    const total = classStudents.length;
    const completed = classStudents.filter((student) => {
      const record = getStudentRecord(student.id);
      if (selected?.name === "BMI") return Boolean(getBmi(record));
      return Boolean(getBest(record));
    }).length;
    const missing = total - completed;
    const gradeCounts = { "1등급": 0, "2등급": 0, "3등급": 0, "4등급": 0, "5등급": 0, 마름: 0, 정상: 0, 과체중: 0, 경도비만: 0, 고도비만: 0 };

    classStudents.forEach((student) => {
      const grade = getGradeLabel(getStudentRecord(student.id), student);
      if (gradeCounts[grade] !== undefined) gradeCounts[grade] += 1;
    });

    return { total, completed, missing, gradeCounts };
  };

  const stats = getStats();

  return (
    <div className="page paps-page">
      <h2>🏃 PAPS</h2>

      <div className="assessment-main-tabs sticky-section-tabs">
        <button className={tab === "setting" ? "active" : ""} onClick={() => setTab("setting")}>측정설정</button>
        <button className={tab === "input" ? "active" : ""} onClick={() => setTab("input")}>측정입력</button>
        <button className={tab === "check" ? "active" : ""} onClick={() => setTab("check")}>결과확인</button>
      </div>

      {saveMessage && <div className="assessment-save-message">{saveMessage}</div>}

      {tab === "setting" && (
        <>
          <SharedFileBox
            title="📎 PAPS 기준표/자료"
            description="PAPS 기준표, 참고자료, PDF/HWP/HWPX/엑셀 파일을 여러 개 올려 PC·모바일·태블릿에서 함께 확인할 수 있습니다."
            category="paps"
            year={year}
            semester={semester}
            localKey={`${itemKey}_shared_files`}
            accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
          />

          <section className="card paps-setting-card paps-import-card">
            <h3>📥 PAPS 측정파일 업로드</h3>
            <p className="paps-help-text">
              나이스 PAPS에서 내려받은 반별 엑셀(.xlsx, .xls, .csv)을 올리면 명렬표와 PAPS 측정값을 함께 가져옵니다.
              파일명에 1반, 2반처럼 표시되어 있거나 엑셀 안에 학년/반/번호/학생성명 항목이 있으면 자동으로 반을 맞춥니다.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              onChange={handlePapsRecordUpload}
            />
          </section>



          <section className="card">
            <h3>종목 구성</h3>
            <div className="assessment-tabs">
              {items.map((item) => (
                <button key={item.id} className={String(selected?.id) === String(item.id) ? "active" : ""} onClick={() => setSelectedId(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>

            <table className="student-table paps-config-table">
              <thead>
                <tr>
                  <th>측정</th>
                  <th>기록</th>
                  <th>등급</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name === "BMI" ? "신장/체중" : `${item.attempts}회`}</td>
                    <td>{item.best ? "사용" : "-"}</td>
                    <td>{item.grade ? "자동계산" : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "input" && (
        <section className="card paps-input-card">
          <div className="assessment-input-header assessment-input-header-clean paps-sticky-controls">
            <select className="assessment-class-select" value={papsClass} onChange={(e) => { setPapsClass(e.target.value); setSelectedStudents([]); }}>
              {classes.map((c) => <option key={c}>{c}</option>)}
            </select>

            <select className="assessment-activity-select" value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setSelectedStudents([]); }}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>

            <div className="assessment-top-actions">
              <button className="save-btn" onClick={saveSelected}>저장({selectedStudents.length})</button>
              <button className="setting-btn" onClick={editSelected}>수정({selectedStudents.length})</button>
              <button className="delete-btn" onClick={deleteSelected}>삭제({selectedStudents.length})</button>
            </div>
          </div>

          <div className="assessment-upload-box paps-inline-upload-box">
            <div>
              <h3>📥 PAPS 자료 업로드</h3>
              <p>측정입력 화면에서도 엑셀(.xlsx, .xls, .csv)을 바로 올릴 수 있습니다. 업로드 후 PC·모바일·태블릿에 같은 계정으로 동기화됩니다.</p>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              onChange={handlePapsRecordUpload}
            />
          </div>

          {selected && (
            <>
              <div className="assessment-guide-box compact">
                선택한 학생: {selectedStudents.length}명 · 현재 종목: {selected.name}
              </div>

              <table className="student-table paps-input-table">
                <colgroup>
                  <col className="paps-col-check" />
                  <col className="paps-col-number" />
                  <col className="paps-col-name" />
                  {selected.attempts > 0 && Array.from({ length: selected.attempts }).map((_, index) => (
                    <col className="paps-col-try" key={`try-col-${index}`} />
                  ))}
                  {selected.best && <col className="paps-col-best" />}
                  {selected.grade && <col className="paps-col-grade" />}
                  <col className="paps-col-manage" />
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <label className="table-all-check">
                        <input
                          type="checkbox"
                          checked={classStudents.length > 0 && classStudents.every((student) => selectedStudents.includes(student.id))}
                          onChange={toggleAll}
                        />
                        전체
                      </label>
                    </th>
                    <th>번호</th>
                    <th>이름</th>
                    {selected.name === "BMI" ? (
                      <>
                        <th>신장(cm)</th>
                        <th>체중(kg)</th>
                        <th>BMI</th>
                      </>
                    ) : (
                      Array.from({ length: selected.attempts }).map((_, index) => <th key={index}>{index + 1}차</th>)
                    )}
                    {selected.best && <th>최고</th>}
                    {selected.grade && <th>등급</th>}
                    <th className="paps-manage-col">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student) => {
                    const record = getStudentRecord(student.id);
                    return (
                      <tr key={student.id}>
                        <td>
                          <input
                            type="checkbox"
                            className="student-select-checkbox"
                            checked={selectedStudents.includes(student.id)}
                            onChange={() => toggleStudent(student.id)}
                          />
                        </td>
                        <td>{student.number}</td>
                        <td className="paps-name-cell">{student.name}</td>

                        {selected.name === "BMI" ? (
                          <>
                            <td><input value={record.height || ""} onChange={(e) => updateRecord(student.id, "height", e.target.value)} /></td>
                            <td><input value={record.weight || ""} onChange={(e) => updateRecord(student.id, "weight", e.target.value)} /></td>
                            <td><strong>{getBmi(record) || "-"}</strong></td>
                          </>
                        ) : (
                          Array.from({ length: selected.attempts }).map((_, index) => (
                            <td key={index}>
                              <input
                                value={record[`try${index + 1}`] || ""}
                                onChange={(e) => updateRecord(student.id, `try${index + 1}`, e.target.value)}
                              />
                            </td>
                          ))
                        )}

                        {selected.best && <td><strong>{getBest(record) || "-"}</strong></td>}
                        {selected.grade && (
                          <td className="paps-grade-cell">
                            <strong>{getSimpleGrade(record, student)}</strong>
                          </td>
                        )}
                        <td className="paps-manage-col">
                          <div className="assessment-row-actions">
                            <button className="save-btn" onClick={() => { localStorage.setItem(scoreKey, JSON.stringify(scores)); showMessage(`${student.name} PAPS 기록을 저장했습니다.`); }}>저장</button>
                            <button className="setting-btn" onClick={() => { toggleStudent(student.id); showMessage(`${student.name} 기록을 수정할 수 있습니다.`); }}>수정</button>
                            <button className="delete-btn" onClick={() => deleteStudentScoreCompat(scores, setScores, selected, papsClass, student.id, showMessage)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {tab === "check" && (
        <section className="card paps-check-card">
          <div className="assessment-input-header assessment-input-header-clean paps-sticky-controls">
            <select className="assessment-class-select" value={papsClass} onChange={(e) => setPapsClass(e.target.value)}>
              {classes.map((c) => <option key={c}>{c}</option>)}
            </select>

            <select className="assessment-activity-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="all">전영역</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>

            <div className="excel-check-wrap paps-excel-wrap">
              <button
                className="excel-icon-only-btn"
                title="PAPS 엑셀 다운로드"
                onClick={() => setExcelMenuOpen(!excelMenuOpen)}
              >
                💾
              </button>

              {excelMenuOpen && (
                <div className="excel-check-panel paps-excel-panel">
                  <div className="excel-check-header">
                    <strong>💾 PAPS 다운로드</strong>
                    <button
                      type="button"
                      className="excel-popup-close"
                      onClick={() => setExcelMenuOpen(false)}
                      aria-label="PAPS 다운로드 창 닫기"
                    >
                      ✕
                    </button>
                  </div>

                  <label className="excel-check-row">
                    <input
                      type="checkbox"
                      checked={checkedExcelIds.includes("all")}
                      onChange={() => toggleExcelCheck("all")}
                    />
                    전영역
                  </label>

                  {items.map((item) => (
                    <label key={item.id} className="excel-check-row">
                      <input
                        type="checkbox"
                        checked={!checkedExcelIds.includes("all") && checkedExcelIds.includes(String(item.id))}
                        onChange={() => toggleExcelCheck(String(item.id))}
                      />
                      {item.name}
                    </label>
                  ))}

                  <button className="excel-panel-download-btn" onClick={downloadCheckedPapsExcel} title="다운로드">
                    💾
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="paps-check-compact-summary">
            <div className="paps-check-main-stats" aria-label="PAPS 입력 현황">
              <span>전체 <strong>{stats.total}명</strong></span>
              <span>입력 <strong>{stats.completed}명</strong></span>
              <span>미입력 <strong>{stats.missing}명</strong></span>
            </div>

            <button
              type="button"
              className="paps-grade-toggle"
              onClick={() => setGradeSummaryOpen((open) => !open)}
              aria-expanded={gradeSummaryOpen}
            >
              📊 등급현황 {gradeSummaryOpen ? "접기 ▲" : "보기 ▼"}
            </button>

            {gradeSummaryOpen && (
              <div className="paps-grade-summary-list">
                {["1등급", "2등급", "3등급", "4등급", "5등급"].map((grade) => (
                  <div key={grade}>
                    <span>{grade}</span>
                    <strong>{stats.gradeCounts[grade] || 0}명</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedId === "all" ? (
            <div className="paps-all-check-wrap">
              <table className="student-table paps-check-table paps-all-check-table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>이름</th>
                    <th>전체등급</th>
                    {items.map((item) => (
                      <th key={item.id}>{item.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student) => {
                    const summary = getAllPapsSummary(student);
                    return (
                      <tr key={student.id}>
                        <td>{student.number}</td>
                        <td className="paps-name-cell">{student.name}</td>
                        <td className="paps-overall-grade-cell"><strong>{getOverallGradeForStudent(student)}</strong></td>
                        {items.map((item) => (
                          <td key={item.id}>
                            <div className="paps-all-cell">
                              <strong>{summary[item.id]?.value || "-"}</strong>
                              <span>{summary[item.id]?.grade || "-"}</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <table className="student-table paps-check-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>이름</th>
                  <th>
                    {selected?.name === "BMI"
                      ? "BMI"
                      : selected?.name === "왕복오래달리기"
                      ? "기록"
                      : "최고기록"}
                  </th>
                  <th>등급</th>
                </tr>
              </thead>
              <tbody>
                {classStudents.map((student) => {
                  const record = getStudentRecord(student.id);
                  return (
                    <tr key={student.id}>
                      <td>{student.number}</td>
                      <td className="paps-name-cell">{student.name}</td>
                      <td>{selected?.name === "BMI" ? getBmi(record) || "-" : getBest(record) || "-"}</td>
                      <td className="paps-grade-cell">
                        <strong>{getSimpleGrade(record, student)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function deleteStudentScoreCompat(scores, setScores, selected, papsClass, studentId, showMessage) {
  if (!selected) return;

  const itemId = String(selected.id);
  const nextScores = { ...scores };
  const nextItem = { ...(nextScores[itemId] || {}) };
  const nextClass = { ...(nextItem[papsClass] || {}) };

  delete nextClass[studentId];

  nextItem[papsClass] = nextClass;
  nextScores[itemId] = nextItem;
  setScores(nextScores);
  showMessage("현재 학생의 PAPS 기록을 삭제했습니다.");
}