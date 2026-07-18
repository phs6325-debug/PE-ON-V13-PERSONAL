import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import SharedFileBox from "./SharedFileBox";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];

const inputTypes = [
  { value: "direct", label: "직접점수입력" },
  { value: "choice", label: "선택형평가" },
  { value: "checklist", label: "체크형(평가요소)" },
  { value: "distance", label: "거리" },
  { value: "count", label: "횟수" },
  { value: "time", label: "시간" },
];

const unitOptions = {
  distance: ["m", "cm"],
  count: ["회", "개"],
  time: ["분·초", "초"],
};

const defaultUnit = { distance: "m", count: "회", time: "분·초" };
const defaultDirection = { distance: "high", count: "high", time: "low" };
const isMeasuredType = (type) => ["distance", "count", "time", "number"].includes(type);

const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
const normalizeName = (value) => String(value ?? "").replace(/\s/g, "").trim().toLowerCase();
const normalizeNumber = (value) => String(value ?? "").replace(/\.0$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "") || String(value ?? "").replace(/\.0$/, "").trim();


const defaultChoiceRules = [
  { label: "매우우수", score: "30" },
  { label: "우수", score: "27" },
  { label: "보통", score: "24" },
  { label: "미흡", score: "21" },
  { label: "매우미흡", score: "18" },
];

const defaultChecklistCriteria = [
  { id: "criterion_1", label: "준비자세" },
  { id: "criterion_2", label: "손 짚기" },
  { id: "criterion_3", label: "턱 당기기" },
  { id: "criterion_4", label: "구르기 동작" },
  { id: "criterion_5", label: "마무리 자세" },
];

const makeChecklistRules = (criteriaCount = 5, totalScore = 15) =>
  Array.from({ length: criteriaCount + 1 }, (_, index) => {
    const achieved = criteriaCount - index;
    const score = Math.max(0, Number(totalScore || 0) - index * 2);
    return {
      label: `${achieved}개 충족`,
      condition: `${achieved}개 충족`,
      min: String(achieved),
      max: String(achieved),
      score: String(score),
    };
  });

const emptyRule = { label: "", min: "", max: "", score: "" };

const toArray = (value) => Array.isArray(value) ? value : [];

const getRuleLabel = (rule) =>
  String(rule?.label ?? rule?.condition ?? rule?.name ?? rule?.grade ?? rule?.level ?? "");

const getRuleScore = (rule) =>
  Number(rule?.score ?? rule?.point ?? rule?.value ?? 0) || 0;

const normalizeItemType = (type) => {
  if (type === "자세평가" || type === "참여도") return "choice";
  if (type === "횟수") return "count";
  if (type === "시간") return "time";
  if (type === "거리") return "distance";
  if (type === "number") return "count";
  if (type === "직접점수입력") return "direct";
  if (type === "체크형" || type === "평가요소체크") return "checklist";
  return type || "direct";
};

const normalizeItem = (item = {}) => {
  const type = normalizeItemType(item.type);
  const rules = toArray(item.rules).map((rule) => ({
    label: getRuleLabel(rule),
    condition: getRuleLabel(rule),
    min: rule?.min ?? "",
    max: rule?.max ?? "",
    score: String(rule?.score ?? rule?.point ?? rule?.value ?? ""),
  }));

  return {
    id: item.id || makeId(),
    name: item.name || "평가점수",
    type,
    score: String(item.score ?? ""),
    unit: item.unit || defaultUnit[type] || "",
    direction: item.direction || defaultDirection[type] || "high",
    criteria: toArray(item.criteria).map((criterion, index) => ({
      id: criterion?.id || `criterion_${index + 1}`,
      label: String(criterion?.label ?? criterion?.name ?? criterion ?? "").trim(),
    })).filter((criterion) => criterion.label),
    rules,
  };
};


const secondsToParts = (value) => {
  const total = Math.max(0, Number(value) || 0);
  return { minutes: Math.floor(total / 60), seconds: Math.round(total % 60) };
};

const partsToSeconds = (minutes, seconds) => {
  const m = Math.max(0, Number(minutes) || 0);
  const s = Math.max(0, Math.min(59, Number(seconds) || 0));
  return m * 60 + s;
};


const readExcelRows = async (file) => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const rows = [];

  const normalizeHeader = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
  const isUsefulHeader = (value) => {
    const text = normalizeHeader(value);
    return [
      "번호", "출석번호", "학생성명", "학생명", "성명", "이름", "반", "반명", "학년반",
      "평가점수", "점수", "총점", "활동", "평가활동"
    ].some((keyword) => text.includes(normalizeHeader(keyword)));
  };

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    if (!matrix.length) return;

    let headerIndex = matrix.findIndex((row) => (row || []).filter(isUsefulHeader).length >= 2);
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

const getExcelCell = (row, candidates) => {
  const normalizeKey = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
  const entries = Object.entries(row || {});

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const exact = entries.find(([key]) => normalizeKey(key) === target);
    if (exact) return exact[1];
  }

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const partial = entries.find(([key]) => normalizeKey(key).includes(target));
    if (partial) return partial[1];
  }

  return "";
};

const inferClassNameFromRow = (row, fallbackClass) => {
  const normalizeKey = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
  const fullClass = getExcelCell(row, ["학급", "반", "반명", "학년반", "className"]);
  const grade = getExcelCell(row, ["학년", "grade"]);
  const ban = getExcelCell(row, ["반명", "반", "class", "className"]);
  const fileName = row.__fileName || "";
  const text = String(fullClass || ban || fileName || "");
  const matched = text.match(/([1-3])\s*-?\s*([1-9])/);
  if (matched) return `${matched[1]}-${matched[2]}`;

  const fileBan = String(fileName || "").match(/([1-9])\s*반/);
  const gradeNumber = String(grade || fallbackClass.split("-")[0] || "2").replace(/[^0-9]/g, "") || "2";
  if (fileBan) return `${gradeNumber}-${fileBan[1]}`;

  const classNumber = String(ban || "").replace(/[^0-9]/g, "");
  if (classNumber) return `${gradeNumber}-${classNumber}`;

  return fallbackClass;
};


const extractNeisClassAndNumber = (row, fallbackClass) => {
  const fallbackGrade = String(fallbackClass || "2-1").split("-")[0] || "2";
  const fileName = String(row?.__fileName || "");
  const combined = getExcelCell(row, ["반/번호", "반번호", "강의실번호", "학급번호"]);
  const combinedText = String(combined ?? "").trim();

  const slashMatch = combinedText.match(/(\d+)\s*[\/\-]\s*(\d+)/);
  if (slashMatch) {
    return { className: `${fallbackGrade}-${slashMatch[1]}`, number: slashMatch[2] };
  }

  const fileClass = fileName.match(/([1-3])\s*[-_]\s*([1-9])/);
  const classFromFile = fileClass ? `${fileClass[1]}-${fileClass[2]}` : "";

  const classText = String(getExcelCell(row, ["학급", "학년반", "반명", "반", "className"]) || "").trim();
  const classMatch = classText.match(/([1-3])\s*[-_]\s*([1-9])/);
  const className = classMatch ? `${classMatch[1]}-${classMatch[2]}` : (classFromFile || fallbackClass);

  const rawNumber = getExcelCell(row, ["번호", "출석번호", "학번", "number", "no"]);
  return { className, number: normalizeNumber(rawNumber) };
};

const parseScoreNumber = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return "";
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
};

const findAnyScoreValue = (row) => {
  const ignored = ["반", "반명", "학년", "학급", "학년반", "번호", "출석번호", "학번", "학생성명", "학생명", "성명", "이름", "name", "number", "no"];
  const normalizeKey = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
  const ignoredSet = ignored.map(normalizeKey);
  for (const [key, value] of Object.entries(row || {})) {
    if (String(key).startsWith("__")) continue;
    const k = normalizeKey(key);
    if (ignoredSet.some((target) => k === target || k.includes(target))) continue;
    const text = String(value ?? "").trim();
    if (text !== "" && !Number.isNaN(Number(text))) return text;
  }
  return "";
};

const findColumnValueForItem = (row, item) => {
  const candidates = [
    item.name,
    `${item.name}점수`,
    `${item.name} 점수`,
    `${item.name}(점수)`,
    `${item.name}기록`,
    `${item.name} 기록`,
    "평가점수",
    "점수",
    "총점",
  ];

  for (const candidate of candidates) {
    const value = getExcelCell(row, [candidate]);
    if (value !== "" && value !== undefined && value !== null) return value;
  }

  return "";
};


const normalizeActivity = (activity = {}) => ({
  id: activity.id || makeId(),
  name: activity.name || "평가활동",
  score: String(activity.score ?? ""),
  items: toArray(activity.items).map(normalizeItem),
  useConversion: Boolean(activity.useConversion),
  conversionRules: toArray(activity.conversionRules).map((rule) => ({
    score: String(rule?.score ?? ""),
    max: String(rule?.max ?? ""),
    min: String(rule?.min ?? ""),
  })),
});

export default function Assessment() {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";

  const storageKey = `peon_${year}_${semester}_assessment`;
  const scoreKey = `peon_${year}_${semester}_assessment_scores`;
  const studentKey = `peon_${year}_${semester}_students`;

  const settingsDocId = `${year}_${semester}_assessment_settings`;
  const scoresDocId = `${year}_${semester}_assessment_scores`;

  const loadedRef = useRef(false);
  const saveTimerRef = useRef(null);

  const [tab, setTab] = useState(() => localStorage.getItem("peon_assessment_default_tab") || "setting");
  const [activities, setActivities] = useState(() =>
    toArray(JSON.parse(localStorage.getItem(storageKey) || "[]")).map(normalizeActivity)
  );
  const [scores, setScores] = useState(() => JSON.parse(localStorage.getItem(scoreKey) || "{}"));
  const [students, setStudents] = useState(() => JSON.parse(localStorage.getItem(studentKey) || "{}"));

  const [selectedId, setSelectedId] = useState("");
  const [inputActivityId, setInputActivityId] = useState("");
  const [scoreClass, setScoreClass] = useState("2-1");
  const [checkClass, setCheckClass] = useState("2-1");
  const [checkActivityId, setCheckActivityId] = useState("all");
  const [queryClass, setQueryClass] = useState("");
  const [queryArea, setQueryArea] = useState("all");
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const [activityName, setActivityName] = useState("");
  const [activityScore, setActivityScore] = useState("");
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState("choice");
  const [itemScore, setItemScore] = useState("");
  const [itemUnit, setItemUnit] = useState("");
  const [itemDirection, setItemDirection] = useState("high");
  const [itemRules, setItemRules] = useState(defaultChoiceRules);
  const [itemCriteria, setItemCriteria] = useState(defaultChecklistCriteria);
  const [editItemId, setEditItemId] = useState(null);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [checklistSettingsOpen, setChecklistSettingsOpen] = useState(false);
  const [checklistModal, setChecklistModal] = useState(null);
  const [conversionModalOpen, setConversionModalOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [message, setMessage] = useState("");

  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const user = currentUser;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => setCurrentUser(nextUser));
    return () => unsubscribe();
  }, []);
  useEffect(() => {
    const handleAssessmentTab = (event) => {
      const nextTab = event.detail || localStorage.getItem("peon_assessment_default_tab") || "setting";
      if (["setting", "input", "check"].includes(nextTab)) setTab(nextTab);
    };
    window.addEventListener("peon-assessment-tab", handleAssessmentTab);
    return () => window.removeEventListener("peon-assessment-tab", handleAssessmentTab);
  }, []);


  useEffect(() => {
    const latestStudents = JSON.parse(localStorage.getItem(studentKey) || "{}");
    setStudents(latestStudents);
  }, [studentKey]);

  useEffect(() => {
    if (!user) {
      loadedRef.current = true;
      return undefined;
    }

    const settingRef = doc(db, "peonUsers", user.uid, "records", settingsDocId);
    const scoreRef = doc(db, "peonUsers", user.uid, "records", scoresDocId);

    const unsubscribeSettings = onSnapshot(
      settingRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const next = toArray(snapshot.data()?.activities).map(normalizeActivity);
          setActivities(next);
          localStorage.setItem(storageKey, JSON.stringify(next));
        }
        loadedRef.current = true;
      },
      () => {
        loadedRef.current = true;
      }
    );

    const unsubscribeScores = onSnapshot(
      scoreRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const next = snapshot.data()?.scores || {};
          setScores(next);
          localStorage.setItem(scoreKey, JSON.stringify(next));
        }
      },
      () => {}
    );

    return () => {
      unsubscribeSettings();
      unsubscribeScores();
    };
  }, [user, settingsDocId, scoresDocId, storageKey, scoreKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(activities));

    if (!loadedRef.current || !user) return;

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setDoc(doc(db, "peonUsers", user.uid, "records", settingsDocId), {
        activities,
        year,
        semester,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }, 350);
  }, [activities, user, settingsDocId, year, semester, storageKey]);

  useEffect(() => {
    localStorage.setItem(scoreKey, JSON.stringify(scores));

    if (!loadedRef.current || !user) return;

    window.clearTimeout(window.__peonAssessmentScoreSaveTimer);
    window.__peonAssessmentScoreSaveTimer = window.setTimeout(() => {
      setDoc(doc(db, "peonUsers", user.uid, "records", scoresDocId), {
        scores,
        year,
        semester,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }, 350);
  }, [scores, user, scoresDocId, year, semester, scoreKey]);

  useEffect(() => {
    if (activities.length === 0) {
      setSelectedId("");
      setInputActivityId("");
      return;
    }

    if (!activities.some((activity) => String(activity.id) === String(selectedId))) {
      setSelectedId(String(activities[0].id));
    }

    if (inputActivityId !== "all" && !activities.some((activity) => String(activity.id) === String(inputActivityId))) {
      setInputActivityId("all");
    }
  }, [activities, selectedId, inputActivityId]);

  const showMessage = (text) => {
    setMessage(text);
    window.clearTimeout(window.__peonAssessmentMessageTimer);
    window.__peonAssessmentMessageTimer = window.setTimeout(() => setMessage(""), 1800);
  };


  const handleAssessmentScoreUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    if (activities.length === 0) {
      showMessage("평가설정에서 평가활동을 먼저 만든 뒤 업로드하세요.");
      event.target.value = "";
      return;
    }

    try {
      const nextScores = { ...scores };
      let imported = 0;
      let skipped = 0;
      let rowCount = 0;

      const selectedTarget = activities.find((activity) => String(activity.id) === String(inputActivityId));
      const targetActivities = inputActivityId === "all" ? activities : (selectedTarget ? [selectedTarget] : activities);

      for (const file of files) {
        const rows = await readExcelRows(file);
        rows.forEach((row) => {
          rowCount += 1;
          const neisInfo = extractNeisClassAndNumber(row, scoreClass);
          const className = neisInfo.className || inferClassNameFromRow(row, scoreClass);
          const rawName = getExcelCell(row, ["학생성명", "학생명", "성명", "이름", "name"]);
          const name = normalizeName(rawName);
          const number = normalizeNumber(neisInfo.number || getExcelCell(row, ["번호", "출석번호", "학번", "number", "no"]));
          const list = students[className] || [];
          const student = list.find((item) => {
            const studentNumber = normalizeNumber(item.number);
            const studentName = normalizeName(item.name);
            return (number && name && studentNumber === number && studentName === name)
              || (number && studentNumber && studentNumber === number)
              || (name && studentName && studentName === name);
          });

          if (!student) {
            skipped += 1;
            return;
          }

          targetActivities.forEach((activity) => {
            const activityId = String(activity.id);
            const items = activity.items.length
              ? activity.items
              : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

            nextScores[activityId] = { ...(nextScores[activityId] || {}) };
            nextScores[activityId][className] = { ...(nextScores[activityId][className] || {}) };
            nextScores[activityId][className][student.id] = {
              ...(nextScores[activityId][className][student.id] || {}),
            };

            let activityImported = false;

            items.forEach((item) => {
              const value = findColumnValueForItem(row, item);
              if (value === "" || value === undefined || value === null) return;
              const scoreValue = parseScoreNumber(value);
              if (!scoreValue) return;
              nextScores[activityId][className][student.id][String(item.id)] = scoreValue;
              imported += 1;
              activityImported = true;
            });

            const directValue = findColumnValueForItem(row, activity) || findAnyScoreValue(row);
            if (directValue !== "" && directValue !== undefined && directValue !== null) {
              const scoreValue = parseScoreNumber(directValue);
              if (!scoreValue) return;
              nextScores[activityId][className][student.id].directTotal = scoreValue;
              if (!activityImported) imported += 1;
              activityImported = true;
            }
          });
        });
      }

      setScores(nextScores);
      localStorage.setItem(scoreKey, JSON.stringify(nextScores));
      showMessage(`수행평가 점수 ${imported}건을 업로드했습니다.${skipped ? ` 미매칭 ${skipped}명` : ""}${rowCount ? ` · 읽은 행 ${rowCount}개` : ""}`);
    } catch (error) {
      console.error("Assessment upload error", error);
      showMessage("수행평가 업로드 중 오류가 발생했습니다. 엑셀 헤더 행과 파일 형식을 확인해 주세요.");
    }

    event.target.value = "";
  };

  const selectedActivity = useMemo(
    () => activities.find((activity) => String(activity.id) === String(selectedId)) || activities[0] || null,
    [activities, selectedId]
  );

  const inputActivity = useMemo(
    () => inputActivityId === "all" ? null : activities.find((activity) => String(activity.id) === String(inputActivityId)) || activities[0] || null,
    [activities, inputActivityId]
  );

  const classStudents = students[scoreClass] || [];
  const checkStudents = students[checkClass] || [];

  const currentInputItems = useMemo(() => {
    if (!inputActivity) return [];
    return inputActivity.items.length
      ? inputActivity.items
      : [{ id: "directTotal", name: "평가점수", type: "direct", score: inputActivity.score, rules: [] }];
  }, [inputActivity]);

  const resetItemForm = () => {
    setEditItemId(null);
    setItemName("");
    setItemType("choice");
    setItemScore("");
    setItemUnit("");
    setItemDirection("high");
    setItemRules(defaultChoiceRules);
    setItemCriteria(defaultChecklistCriteria);
    setRuleModalOpen(false);
  };

  const saveActivity = () => {
    if (!activityName.trim()) {
      showMessage("평가활동 이름을 입력하세요.");
      return;
    }

    if (editingActivityId) {
      const before = activities.find((activity) => String(activity.id) === String(editingActivityId));
      const beforeScore = String(before?.score ?? "");
      const nextScore = String(activityScore || "0");

      if (beforeScore !== nextScore) {
        const ok = window.confirm("배점을 변경하면 기존 학생 점수는 그대로 유지됩니다.\n\n계속 수정하시겠습니까?");
        if (!ok) return;
      }

      setActivities((prev) =>
        prev.map((activity) =>
          String(activity.id) === String(editingActivityId)
            ? { ...activity, name: activityName.trim(), score: nextScore }
            : activity
        )
      );

      setEditingActivityId(null);
      setActivityName("");
      setActivityScore("");
      showMessage("평가활동을 수정했습니다.");
      return;
    }

    const nextActivity = {
      id: makeId(),
      name: activityName.trim(),
      score: activityScore || "0",
      items: [],
    };

    setActivities((prev) => [...prev, nextActivity]);
    setSelectedId(String(nextActivity.id));
    setInputActivityId(String(nextActivity.id));
    setActivityName("");
    setActivityScore("");
    showMessage("평가활동을 저장했습니다.");
  };

  const startEditActivity = (activity) => {
    if (!activity) return;
    setEditingActivityId(String(activity.id));
    setActivityName(activity.name || "");
    setActivityScore(String(activity.score ?? ""));
    setSelectedId(String(activity.id));
    showMessage("평가활동 수정 모드입니다.");
  };

  const cancelEditActivity = () => {
    setEditingActivityId(null);
    setActivityName("");
    setActivityScore("");
    showMessage("평가활동 수정을 취소했습니다.");
  };

  const moveActivity = (activityId, direction) => {
    setActivities((prev) => {
      const index = prev.findIndex((activity) => String(activity.id) === String(activityId));
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });

    showMessage("평가활동 순서를 변경했습니다.");
  };

  const deleteActivity = (activityId) => {
    const target = activities.find((activity) => String(activity.id) === String(activityId));
    const ok = window.confirm(`${target?.name || "평가활동"} 활동을 삭제하시겠습니까?\n\n학생 점수도 함께 삭제됩니다.`);
    if (!ok) return;

    setActivities((prev) => prev.filter((activity) => String(activity.id) !== String(activityId)));

    setScores((prev) => {
      const next = { ...prev };
      delete next[String(activityId)];
      return next;
    });

    if (String(selectedId) === String(activityId)) setSelectedId("");
    if (String(inputActivityId) === String(activityId)) setInputActivityId("");
    if (String(editingActivityId) === String(activityId)) {
      setEditingActivityId(null);
      setActivityName("");
      setActivityScore("");
    }

    showMessage("평가활동과 관련 점수를 삭제했습니다.");
  };

  const saveCurrentActivity = () => {
    setActivities((prev) => [...prev]);
    showMessage("평가설정을 저장했습니다.");
  };

  const saveItem = () => {
    if (!selectedActivity) {
      showMessage("먼저 평가활동을 만드세요.");
      return;
    }

    const cleanRules = itemRules
      .map((rule) => ({
        label: getRuleLabel(rule),
        condition: getRuleLabel(rule),
        min: rule.min ?? "",
        max: rule.max ?? "",
        score: String(rule.score ?? ""),
      }))
      .filter((rule) => rule.label || rule.min || rule.max || rule.score);

    const nextItem = {
      id: editItemId || makeId(),
      name: itemName.trim() || "평가점수",
      type: normalizeItemType(itemType),
      score: itemScore || selectedActivity.score || "0",
      unit: itemUnit || defaultUnit[normalizeItemType(itemType)] || "",
      direction: itemDirection || defaultDirection[normalizeItemType(itemType)] || "high",
      criteria: normalizeItemType(itemType) === "checklist"
        ? itemCriteria.map((criterion, index) => ({
            id: criterion.id || `criterion_${index + 1}`,
            label: String(criterion.label || "").trim(),
          })).filter((criterion) => criterion.label)
        : [],
      rules: cleanRules,
    };

    setActivities((prev) =>
      prev.map((activity) => {
        if (String(activity.id) !== String(selectedActivity.id)) return activity;

        const exists = activity.items.some((item) => String(item.id) === String(nextItem.id));
        return {
          ...activity,
          items: exists
            ? activity.items.map((item) => String(item.id) === String(nextItem.id) ? nextItem : item)
            : [...activity.items, nextItem],
        };
      })
    );

    resetItemForm();
    showMessage(editItemId ? "평가내용을 수정 저장했습니다." : "평가내용을 추가했습니다.");
  };

  const editItem = (item) => {
    const normalized = normalizeItem(item);
    setEditItemId(normalized.id);
    setItemName(normalized.name);
    setItemType(normalized.type);
    setItemScore(normalized.score);
    setItemUnit(normalized.unit || defaultUnit[normalized.type] || "");
    setItemDirection(normalized.direction || defaultDirection[normalized.type] || "high");
    setItemRules(normalized.rules.length ? normalized.rules : (normalized.type === "checklist" ? makeChecklistRules(normalized.criteria.length || 5, normalized.score || 15) : defaultChoiceRules));
    setItemCriteria(normalized.criteria.length ? normalized.criteria : defaultChecklistCriteria);
    setTab("setting");
  };

  const deleteItem = (itemId) => {
    setActivities((prev) =>
      prev.map((activity) =>
        String(activity.id) === String(selectedActivity?.id)
          ? { ...activity, items: activity.items.filter((item) => String(item.id) !== String(itemId)) }
          : activity
      )
    );
    if (String(editItemId) === String(itemId)) resetItemForm();
    showMessage("평가내용을 삭제했습니다.");
  };

  const updateRule = (index, key, value) => {
    setItemRules((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] || emptyRule), [key]: value };
      if (key === "label") next[index].condition = value;
      return next;
    });
  };

  const addRule = () => setItemRules((prev) => [...prev, emptyRule]);
  const deleteRule = (index) => setItemRules((prev) => prev.filter((_, i) => i !== index));

  const updateCriterion = (index, value) => {
    setItemCriteria((prev) => prev.map((criterion, i) => i === index ? { ...criterion, label: value } : criterion));
  };

  const addCriterion = () => {
    setItemCriteria((prev) => [...prev, { id: makeId(), label: `평가요소 ${prev.length + 1}` }]);
  };

  const deleteCriterion = (index) => {
    setItemCriteria((prev) => prev.filter((_, i) => i !== index));
  };

  const syncChecklistRules = () => {
    setItemRules(makeChecklistRules(itemCriteria.filter((criterion) => String(criterion.label || "").trim()).length || 1, itemScore || selectedActivity?.score || 15));
  };

  const makeRulePreset = (count) => {
    const total = Number(itemScore || selectedActivity?.score || 30) || 30;
    const step = Math.max(1, Math.round(total / Math.max(count + 2, 7)));
    const labels5 = ["매우우수", "우수", "보통", "미흡", "매우미흡"];
    const labels7 = ["최우수", "매우우수", "우수", "보통", "미흡", "매우미흡", "노력필요"];
    const labels = count === 7 ? labels7 : labels5;
    setItemRules(labels.map((label, index) => ({
      label,
      condition: label,
      min: "",
      max: "",
      score: String(Math.max(0, total - step * index)),
    })));
  };

  const makeFiveRules = () => makeRulePreset(5);
  const makeSevenRules = () => makeRulePreset(7);

  const makeConversionRules = (activity, count = 7) => {
    const total = Number(activity?.score || 30) || 30;
    if (total === 30 && count === 7) {
      return [
        { score: "30", max: "30", min: "27" },
        { score: "27", max: "26", min: "22" },
        { score: "24", max: "21", min: "18" },
        { score: "21", max: "17", min: "14" },
        { score: "18", max: "13", min: "10" },
        { score: "15", max: "9", min: "6" },
        { score: "12", max: "5", min: "0" },
      ];
    }
    const size = total + 1;
    const base = Math.floor(size / count);
    const extra = size % count;
    let top = total;
    const scoreStep = Math.max(1, Math.round(total * 0.1));
    return Array.from({ length: count }, (_, index) => {
      const width = base + (index < extra ? 1 : 0);
      const min = Math.max(0, top - width + 1);
      const row = { score: String(Math.max(0, total - scoreStep * index)), max: String(top), min: String(min) };
      top = min - 1;
      return row;
    });
  };

  const updateActivityConversion = (patch) => {
    if (!selectedActivity) return;
    setActivities((prev) => prev.map((activity) =>
      String(activity.id) === String(selectedActivity.id) ? { ...activity, ...patch } : activity
    ));
  };

  const updateConversionRule = (index, key, value) => {
    const rules = [...(selectedActivity?.conversionRules || [])];
    rules[index] = { ...(rules[index] || { score: "", max: "", min: "" }), [key]: value };
    updateActivityConversion({ conversionRules: rules });
  };

  const applyConversion = (activity, rawTotal) => {
    if (!activity?.useConversion || !(activity.conversionRules || []).length) return rawTotal;
    const matched = activity.conversionRules.find((rule) => {
      const max = rule.max === "" ? Infinity : Number(rule.max);
      const min = rule.min === "" ? -Infinity : Number(rule.min);
      return rawTotal <= max && rawTotal >= min;
    });
    return matched ? Number(matched.score) || 0 : rawTotal;
  };

  const getItemScoreFromValue = (item, value) => {
    if (value === "" || value === null || value === undefined) return 0;

    const type = normalizeItemType(item.type);
    const text = String(value).trim();
    const numericValue = Number(text);

    if (type === "direct") return Number(value) || 0;

    if (type === "checklist") {
      const checked = Array.isArray(value?.checked) ? value.checked : [];
      const achieved = checked.length;
      const matched = (item.rules || []).find((rule) => {
        const min = rule.min === "" || rule.min === undefined ? achieved : Number(rule.min);
        const max = rule.max === "" || rule.max === undefined ? achieved : Number(rule.max);
        return achieved >= min && achieved <= max;
      });
      return matched ? getRuleScore(matched) : Number(value?.score) || 0;
    }

    if (type === "choice") {
      if (!Number.isNaN(numericValue) && text !== "") return numericValue;

      const matched = (item.rules || []).find((rule) => {
        const label = getRuleLabel(rule);
        return normalize(label) === normalize(value);
      });

      return matched ? getRuleScore(matched) : 0;
    }

    if (isMeasuredType(type)) {
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

  const getActivityClassScores = (activityId, className) =>
    scores[String(activityId)]?.[className] || {};

  const getStoredValue = (activityId, className, studentId, itemId) =>
    scores[String(activityId)]?.[className]?.[studentId]?.[itemId] ?? "";

  const updateScore = (activity, studentId, item, value) => {
    if (!activity) return;

    const activityId = String(activity.id);
    const itemId = String(item.id);

    setScores((prev) => ({
      ...prev,
      [activityId]: {
        ...(prev[activityId] || {}),
        [scoreClass]: {
          ...((prev[activityId] || {})[scoreClass] || {}),
          [studentId]: {
            ...(((prev[activityId] || {})[scoreClass] || {})[studentId] || {}),
            [itemId]: value,
          },
        },
      },
    }));
  };

  const getStudentActivityRawTotal = (activity, student, className = scoreClass) => {
    if (!activity) return 0;
    const directTotal = getStoredValue(activity.id, className, student.id, "directTotal");
    if (directTotal !== "" && directTotal !== undefined && directTotal !== null) return Number(directTotal) || 0;

    const items = activity.items.length
      ? activity.items
      : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

    return items.reduce((sum, item) => {
      const value = getStoredValue(activity.id, className, student.id, item.id);
      return sum + getItemScoreFromValue(item, value);
    }, 0);
  };

  const getStudentActivityTotal = (activity, student, className = scoreClass) => {
    const rawTotal = getStudentActivityRawTotal(activity, student, className);
    return applyConversion(activity, rawTotal);
  };

  const hasStudentInput = (activity, student, className = scoreClass) => {
    if (!activity) return false;
    const items = activity.items.length
      ? activity.items
      : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

    return items.some((item) => {
      const value = getStoredValue(activity.id, className, student.id, item.id);
      return value !== "" && value !== null && value !== undefined;
    });
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
    showMessage(`${selectedStudents.length}명 점수를 저장했습니다.`);
  };

  const deleteSelected = () => {
    if (!inputActivity || selectedStudents.length === 0) {
      showMessage("삭제할 학생을 선택하세요.");
      return;
    }

    const activityId = String(inputActivity.id);
    setScores((prev) => {
      const next = { ...prev };
      const activityScores = { ...(next[activityId] || {}) };
      const classScores = { ...(activityScores[scoreClass] || {}) };

      selectedStudents.forEach((id) => delete classScores[id]);

      activityScores[scoreClass] = classScores;
      next[activityId] = activityScores;
      return next;
    });
    setSelectedStudents([]);
    showMessage("선택 학생 점수를 삭제했습니다.");
  };

  const deleteOneScore = (studentId) => {
    if (!inputActivity) return;

    const activityId = String(inputActivity.id);
    setScores((prev) => {
      const next = { ...prev };
      const activityScores = { ...(next[activityId] || {}) };
      const classScores = { ...(activityScores[scoreClass] || {}) };
      delete classScores[studentId];
      activityScores[scoreClass] = classScores;
      next[activityId] = activityScores;
      return next;
    });
    showMessage("학생 점수를 삭제했습니다.");
  };

  const renderInputCell = (student, item) => {
    const value = getStoredValue(inputActivity.id, scoreClass, student.id, item.id);
    const type = normalizeItemType(item.type);

    if (type === "checklist") {
      const checked = Array.isArray(value?.checked) ? value.checked : [];
      const score = getItemScoreFromValue(item, value);
      return (
        <button
          type="button"
          className={`checklist-evaluate-btn ${checked.length ? "completed" : ""}`}
          onClick={() => setChecklistModal({ student, item, checked })}
        >
          {checked.length}/{(item.criteria || []).length || 0} · {score}점
        </button>
      );
    }

    if (type === "choice") {
      return (
        <select value={value} onChange={(e) => updateScore(inputActivity, student.id, item, e.target.value)}>
          <option value="">선택</option>
          {(item.rules || []).map((rule, index) => {
            const label = getRuleLabel(rule);
            const score = getRuleScore(rule);
            return (
              <option key={index} value={String(score)}>
                {label} ({score}점)
              </option>
            );
          })}
        </select>
      );
    }

    return (
      <input
        value={value}
        placeholder={type === "direct" ? "점수" : "기록"}
        onChange={(e) => updateScore(inputActivity, student.id, item, e.target.value)}
      />
    );
  };

  const checkTargetActivities = checkActivityId === "all"
    ? activities
    : activities.filter((activity) => String(activity.id) === String(checkActivityId));

  const checkStats = useMemo(() => {
    const rows = checkStudents.map((student) => {
      const hasInput = activities.some((activity) => hasStudentInput(activity, student, checkClass));
      const total = activities.reduce((sum, activity) => sum + getStudentActivityTotal(activity, student, checkClass), 0);
      return { hasInput, total };
    });

    const completed = rows.filter((row) => row.hasInput);
    const totals = completed.map((row) => row.total);

    return {
      total: checkStudents.length,
      completed: completed.length,
      missing: checkStudents.length - completed.length,
      avg: totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : 0,
      max: totals.length ? Math.max(...totals) : 0,
      min: totals.length ? Math.min(...totals) : 0,
    };
  }, [checkStudents, activities, checkClass, scores]);

  const visibleCheckStudents = showMissingOnly
    ? checkStudents.filter((student) => !activities.some((activity) => hasStudentInput(activity, student, checkClass)))
    : checkStudents;


  const runAssessmentQuery = () => {
    if (!queryClass) {
      showMessage("학년-반을 먼저 선택하세요.");
      return;
    }
    setScoreClass(queryClass);
    setCheckClass(queryClass);
    setInputActivityId(queryArea);
    setCheckActivityId(queryArea);
    setSelectedStudents([]);
    setTab(queryArea === "all" ? "check" : "input");
  };

  return (
    <div className="page assessment-page">
      <h2>📝 수행평가</h2>

      <div className="assessment-main-tabs sticky-section-tabs">
        <button className={tab === "setting" ? "active" : ""} onClick={() => setTab("setting")}>평가설정</button>
        <button className={tab === "input" ? "active" : ""} onClick={() => setTab("input")}>점수입력</button>
        <button className={tab === "check" ? "active" : ""} onClick={() => setTab("check")}>점수확인</button>
      </div>

      {message && <div className="assessment-save-message">{message}</div>}

      <section className="card peon-query-bar assessment-query-bar" aria-label="수행평가 조회 조건">
        <select value={queryClass} onChange={(e) => setQueryClass(e.target.value)} aria-label="학년-반 선택">
          <option value="">학년-반</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={queryArea} onChange={(e) => setQueryArea(e.target.value)} aria-label="평가영역 선택">
          <option value="all">평가영역</option>
          {activities.map((activity) => <option key={activity.id} value={String(activity.id)}>{activity.name}</option>)}
        </select>
        <button type="button" className="save-btn peon-query-button" onClick={runAssessmentQuery}>조회</button>
      </section>

      {tab === "setting" && (
        <>
          <SharedFileBox
            title="📎 수행평가 기준/자료"
            description="수행평가 평가기준, 참고자료, PDF/HWP/HWPX/엑셀 파일을 여러 개 올려 PC·모바일·태블릿에서 함께 확인할 수 있습니다."
            category="assessment"
            year={year}
            semester={semester}
            localKey={`${storageKey}_shared_files`}
            accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
          />

          <section className={`card assessment-activity-card ${editingActivityId ? "editing" : ""}`}>
            <input
              placeholder="평가활동 예: 줄넘기"
              value={activityName}
              onChange={(e) => setActivityName(e.target.value)}
            />
            <input
              type="number"
              placeholder="총 배점 예: 20"
              value={activityScore}
              onChange={(e) => setActivityScore(e.target.value)}
            />
            <button className="save-btn" onClick={saveActivity}>
              {editingActivityId ? "활동 수정저장" : "활동 저장"}
            </button>
            {editingActivityId && (
              <button className="cancel-btn" onClick={cancelEditActivity}>
                수정취소
              </button>
            )}
          </section>

          <div className="assessment-tabs assessment-activity-tabs">
            {activities.map((activity, index) => (
              <div
                key={activity.id}
                className={`assessment-activity-tab-card ${String(selectedActivity?.id) === String(activity.id) ? "active" : ""}`}
              >
                <button
                  className="activity-tab-main"
                  onClick={() => setSelectedId(String(activity.id))}
                >
                  {activity.name} ({activity.score}점)
                </button>
                <div className="activity-tab-actions">
                  <button className="setting-btn" onClick={() => startEditActivity(activity)}>수정</button>
                  <button className="setting-btn" onClick={() => moveActivity(activity.id, -1)} disabled={index === 0}>↑</button>
                  <button className="setting-btn" onClick={() => moveActivity(activity.id, 1)} disabled={index === activities.length - 1}>↓</button>
                  <button className="delete-btn" onClick={() => deleteActivity(activity.id)}>삭제</button>
                </div>
              </div>
            ))}
          </div>

          {selectedActivity ? (
            <section className="card assessment-setting-card">
              <h2>{selectedActivity.name} ({selectedActivity.score}점)</h2>

              {editItemId && (
                <div className="edit-notice">수정 중입니다. 내용을 바꾼 뒤 <strong>평가내용 저장</strong>을 누르세요.</div>
              )}

              <div className="assessment-setting-grid">
                <input placeholder="평가내용 예: 2단 뛰기" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                <select value={itemType} onChange={(e) => {
                  const nextType = e.target.value;
                  setItemType(nextType);
                  setItemUnit(defaultUnit[nextType] || "");
                  setItemDirection(defaultDirection[nextType] || "high");
                  if (nextType === "checklist") {
                    const criteria = itemCriteria.length ? itemCriteria : defaultChecklistCriteria;
                    setItemCriteria(criteria);
                    setItemRules(makeChecklistRules(criteria.length, itemScore || selectedActivity?.score || 15));
                  }
                }}>
                  {inputTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <input type="number" placeholder="배점 예: 20" value={itemScore} onChange={(e) => setItemScore(e.target.value)} />
                <button
                  className="setting-btn"
                  onClick={() => normalizeItemType(itemType) === "checklist" ? setChecklistSettingsOpen(true) : setRuleModalOpen(true)}
                >
                  {normalizeItemType(itemType) === "checklist" ? "평가요소 설정" : "점수급간 설정"}
                </button>
                <button className="save-btn" onClick={saveItem}>{editItemId ? "수정저장" : "평가내용 저장"}</button>
                {editItemId && <button className="cancel-btn" onClick={resetItemForm}>취소</button>}
              </div>



              <div className="assessment-conversion-inline">
                <div className="conversion-left-group">
                  <label className="conversion-mode-option conversion-use-option">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedActivity.useConversion)}
                      onChange={() => {
                        updateActivityConversion({
                          useConversion: true,
                          conversionRules: (selectedActivity.conversionRules || []).length
                            ? selectedActivity.conversionRules
                            : makeConversionRules(selectedActivity, 7),
                        });
                      }}
                    />
                    <span>최종환산표 사용</span>
                  </label>

                  <button
                    type="button"
                    className="setting-btn conversion-open-btn"
                    disabled={!selectedActivity.useConversion}
                    onClick={() => setConversionModalOpen(true)}
                  >
                    최종환산표 입력
                  </button>
                </div>

                <div className="conversion-right-group">
                  <label className="conversion-mode-option conversion-raw-option">
                    <input
                      type="checkbox"
                      checked={!Boolean(selectedActivity.useConversion)}
                      onChange={() => updateActivityConversion({
                        useConversion: false,
                        conversionRules: selectedActivity.conversionRules,
                      })}
                    />
                    <span>합산점수를 그대로 사용</span>
                  </label>
                </div>
              </div>

              <table className="student-table assessment-setting-table">
                <thead>
                  <tr>
                    <th>평가내용</th>
                    <th>평가방법</th>
                    <th>배점</th>
                    <th>점수급간</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedActivity.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{inputTypes.find((type) => type.value === normalizeItemType(item.type))?.label || item.type}</td>
                      <td>{item.score}점</td>
                      <td><button className="setting-btn" onClick={() => setPreviewItem(item)}>{item.rules?.length || 0}개 보기</button></td>
                      <td>
                        <div className="assessment-row-actions">
                          <button className="setting-btn" onClick={() => editItem(item)}>수정</button>
                          <button className="delete-btn" onClick={() => deleteItem(item.id)}>삭제</button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {selectedActivity.items.length === 0 && (
                    <tr>
                      <td colSpan={5}>평가내용을 만들지 않아도 점수입력 탭에서 총점 직접입력이 가능합니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="assessment-bottom-actions">
                <button className="save-btn" onClick={saveCurrentActivity}>평가설정 저장</button>
                <button className="delete-btn" onClick={() => deleteActivity(selectedActivity.id)}>활동 삭제</button>
              </div>
            </section>
          ) : (
            <div className="assessment-guide-box">평가활동을 먼저 만드세요.</div>
          )}
        </>
      )}

      {tab === "input" && (
        <section className="card assessment-input-card">
          <div className="assessment-input-header assessment-input-header-clean">
            <div className="assessment-top-actions">
              <button className="save-btn" onClick={saveSelected}>저장({selectedStudents.length})</button>
              <button className="setting-btn" onClick={() => showMessage("수정할 학생을 체크한 뒤 점수를 바꾸면 됩니다.")}>수정({selectedStudents.length})</button>
              <button className="delete-btn" onClick={deleteSelected}>삭제({selectedStudents.length})</button>
            </div>
          </div>

          <div className="assessment-upload-box assessment-upload-box-fixed">
            <div className="assessment-upload-copy">
              <h3>📥 수행점수 파일 업로드</h3>
              <p>나이스에서 내려받은 수행평가 엑셀을 올리면 <strong>반/번호/이름</strong> 기준으로 학생을 자동 매칭합니다.</p>
              <p className="assessment-upload-guide">권장 열: 반, 번호, 이름, 평가점수/점수/총점 또는 평가내용명 · 현재 선택: {scoreClass} / {inputActivityId === "all" ? "전영역" : inputActivity?.name || "선택 영역"}</p>
            </div>
            <div className="assessment-upload-control">
              <input
                className="assessment-upload-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleAssessmentScoreUpload}
              />
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="assessment-guide-box">평가설정에서 평가활동을 먼저 만드세요.</div>
          ) : inputActivityId === "all" ? (
            <>
              <div className="assessment-guide-box compact">
                선택한 학생: {selectedStudents.length}명 · 전영역 입력/확인
              </div>

              <table className="student-table assessment-input-table assessment-all-input-table">
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
                    {activities.map((activity) => <th key={activity.id}>{activity.name}</th>)}
                    <th className="assessment-total-head">총점</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student) => {
                    const total = activities.reduce((sum, activity) => sum + getStudentActivityTotal(activity, student, scoreClass), 0);
                    return (
                      <tr key={student.id}>
                        <td><input type="checkbox" className="student-select-checkbox" checked={selectedStudents.includes(student.id)} onChange={() => toggleStudent(student.id)} /></td>
                        <td>{student.number}</td>
                        <td>{student.name}</td>
                        {activities.map((activity) => {
                          const directItem = { id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] };
                          const hasDetails = (activity.items || []).length > 0;
                          const totalScore = getStudentActivityTotal(activity, student, scoreClass);
                          return (
                            <td key={activity.id}>
                              {hasDetails ? (
                                <strong className="assessment-score-result">{hasStudentInput(activity, student, scoreClass) ? `${totalScore}점` : "-"}</strong>
                              ) : (
                                <input
                                  value={getStoredValue(activity.id, scoreClass, student.id, "directTotal")}
                                  onChange={(e) => updateScore(activity, student.id, directItem, e.target.value)}
                                  placeholder="점수"
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="assessment-total-cell"><strong>{total}점</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : !inputActivity ? (
            <div className="assessment-guide-box">평가설정에서 평가활동을 먼저 만드세요.</div>
          ) : (
            <>
              <div className="assessment-guide-box compact">
                선택한 학생: {selectedStudents.length}명 · 현재 활동: {inputActivity.name}
              </div>

              <table className="student-table assessment-input-table">
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
                    {currentInputItems.map((item) => <th key={item.id}>{item.name}</th>)}
                    <th>평가점수</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student) => {
                    const rawTotal = getStudentActivityRawTotal(inputActivity, student, scoreClass);
                    const total = getStudentActivityTotal(inputActivity, student, scoreClass);
                    const hasInput = hasStudentInput(inputActivity, student, scoreClass);

                    return (
                      <tr key={student.id}>
                        <td><input type="checkbox" className="student-select-checkbox" checked={selectedStudents.includes(student.id)} onChange={() => toggleStudent(student.id)} /></td>
                        <td>{student.number}</td>
                        <td>{student.name}</td>
                        {currentInputItems.map((item) => (
                          <td key={item.id}>{renderInputCell(student, item)}</td>
                        ))}
                        <td><strong className="assessment-score-result">{hasInput ? (inputActivity.useConversion ? `${rawTotal}점 → ${total}점` : `${total}점`) : "-"}</strong></td>
                        <td>
                          <div className="assessment-row-actions">
                            <button className="save-btn" onClick={() => { localStorage.setItem(scoreKey, JSON.stringify(scores)); showMessage(`${student.name} 점수를 저장했습니다.`); }}>저장</button>
                            <button className="setting-btn" onClick={() => toggleStudent(student.id)}>수정</button>
                            <button className="delete-btn" onClick={() => deleteOneScore(student.id)}>삭제</button>
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
        <section className="card assessment-check-card">
          <div className="assessment-input-header check-input-header">
            <label className="missing-only-check">
              <input type="checkbox" checked={showMissingOnly} onChange={(e) => setShowMissingOnly(e.target.checked)} />
              미입력만 보기
            </label>
          </div>

          <div className="score-summary-row score-summary-row-wide">
            <div>전체 <strong>{checkStats.total}명</strong></div>
            <div>입력 <strong>{checkStats.completed}명</strong></div>
            <div>미입력 <strong>{checkStats.missing}명</strong></div>
            <div>평균 <strong>{checkStats.avg}점</strong></div>
            <div>최고 <strong>{checkStats.max}점</strong></div>
            <div>최저 <strong>{checkStats.min}점</strong></div>
          </div>

          <div className="assessment-check-scroll-hint" aria-hidden="true">← 좌우로 밀어 점수 확인 →</div>
          <div className="assessment-check-table-wrap" role="region" aria-label="수행평가 점수확인표" tabIndex="0">
          <table className="student-table assessment-check-table">
            <thead>
              <tr>
                <th>번호</th>
                <th>이름</th>
                {checkTargetActivities.map((activity) => <th key={activity.id}>{activity.name}</th>)}
                <th className="assessment-total-head">총점</th>
              </tr>
            </thead>
            <tbody>
              {visibleCheckStudents.map((student) => {
                const total = checkTargetActivities.reduce((sum, activity) => sum + getStudentActivityTotal(activity, student, checkClass), 0);

                return (
                  <tr key={student.id}>
                    <td>{student.number}</td>
                    <td>{student.name}</td>
                    {checkTargetActivities.map((activity) => (
                      <td key={activity.id}>{getStudentActivityTotal(activity, student, checkClass)}점</td>
                    ))}
                    <td className="assessment-total-cell"><strong>{total}점</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {checklistSettingsOpen && (
        <div className="modal-bg">
          <div className="modal checklist-settings-modal peon-popup-modal">
            <button className="modal-close-x checklist-settings-close" type="button" onClick={() => setChecklistSettingsOpen(false)} aria-label="닫기">×</button>
            <div className="checklist-settings-title">
              <h2>평가요소 설정</h2>
              <p>평가요소를 입력하고 충족 개수별 점수를 설정하세요. 점수입력에서는 성공한 요소만 체크하면 자동으로 점수가 계산됩니다.</p>
            </div>

            <div className="checklist-settings-summary">
              <div><span>평가내용</span><strong>{itemName.trim() || "평가내용 미입력"}</strong></div>
              <div><span>배점</span><strong>{itemScore || selectedActivity?.score || 0}점</strong></div>
            </div>

            <section className="checklist-settings-section">
              <div className="checklist-settings-section-head">
                <h3>평가요소</h3>
                <button type="button" className="setting-btn" onClick={addCriterion}>평가요소 추가</button>
              </div>
              <div className="checklist-criteria-list checklist-criteria-modal-list">
                {itemCriteria.map((criterion, index) => (
                  <div className="checklist-criterion-row" key={criterion.id || index}>
                    <span>{index + 1}</span>
                    <input value={criterion.label} onChange={(e) => updateCriterion(index, e.target.value)} placeholder={`평가요소 ${index + 1}`} />
                    <button type="button" className="delete-btn" onClick={() => deleteCriterion(index)}>삭제</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="checklist-settings-section">
              <div className="checklist-settings-section-head">
                <h3>충족 개수별 점수</h3>
                <button type="button" className="setting-btn" onClick={syncChecklistRules}>자동설정</button>
              </div>
              <div className="checklist-score-editor">
                {(itemRules || []).map((rule, index) => (
                  <div className="checklist-score-editor-row" key={index}>
                    <label><input type="number" min="0" value={rule.min ?? ""} onChange={(e) => { updateRule(index, "min", e.target.value); updateRule(index, "max", e.target.value); }} /><span>개 충족</span></label>
                    <label><input type="number" value={rule.score ?? ""} onChange={(e) => updateRule(index, "score", e.target.value)} /><span>점</span></label>
                    <button type="button" className="delete-btn" onClick={() => deleteRule(index)}>삭제</button>
                  </div>
                ))}
              </div>
            </section>

            <div className="checklist-settings-actions">
              <button type="button" className="save-btn" onClick={() => { setChecklistSettingsOpen(false); showMessage("평가요소 설정을 저장했습니다. 평가내용 저장을 누르면 최종 반영됩니다."); }}>저장</button>
              <button type="button" className="setting-btn" onClick={() => { syncChecklistRules(); showMessage("평가요소 수에 맞춰 점수표를 수정했습니다."); }}>수정</button>
              <button type="button" className="delete-btn" onClick={() => {
                if (!window.confirm("평가요소와 충족 개수별 점수를 모두 삭제할까요?")) return;
                setItemCriteria([]);
                setItemRules([]);
                showMessage("평가요소 설정을 삭제했습니다.");
              }}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {ruleModalOpen && (
        <div className="modal-bg">
          <div className="modal assessment-rule-modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setRuleModalOpen(false)} aria-label="닫기">×</button>
            <div className="rule-modal-title"><img src="/parksam-icon.jpg" alt="" aria-hidden="true" /><h2>{normalizeItemType(itemType) === "checklist" ? "체크형 점수표 설정" : "점수급간 설정"}</h2></div>
            {normalizeItemType(itemType) === "checklist" && (
              <div className="checklist-rule-guide">
                평가요소 {itemCriteria.length}개 중 충족한 개수에 따라 점수가 자동 계산됩니다. 점수는 아래에서 직접 수정할 수 있습니다.
              </div>
            )}
            {isMeasuredType(normalizeItemType(itemType)) && (
              <div className="rule-measure-toolbar">
                <label>
                  <span>{normalizeItemType(itemType) === "time" ? "시간 단위" : normalizeItemType(itemType) === "distance" ? "거리 단위" : "횟수 단위"}</span>
                  <select value={itemUnit || defaultUnit[normalizeItemType(itemType)] || ""} onChange={(e) => setItemUnit(e.target.value)}>
                    {(unitOptions[normalizeItemType(itemType)] || []).map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </label>
                <label>
                  <span>판정 방향</span>
                  <select value={itemDirection} onChange={(e) => setItemDirection(e.target.value)}>
                    <option value="high">높을수록 우수</option>
                    <option value="low">낮을수록 우수</option>
                  </select>
                </label>
                <p>{normalizeItemType(itemType) === "time" ? "분·초 입력값은 내부적으로 초로 변환되어 정확하게 계산됩니다." : "선택한 단위가 급간 입력칸에 자동으로 적용됩니다."}</p>
              </div>
            )}
            <div className="rule-preset-row">
              {normalizeItemType(itemType) === "checklist" ? (
                <button className="save-btn" type="button" onClick={syncChecklistRules}>충족 개수 점수표 자동생성</button>
              ) : (
                <>
                  <button className="save-btn" onClick={makeFiveRules}>5단계 자동생성</button>
                  <button className="save-btn" onClick={makeSevenRules}>7단계 자동생성</button>
                  <button className="setting-btn" onClick={addRule}>급간 추가</button>
                </>
              )}
              <button className="rule-save-top-btn" onClick={() => { setRuleModalOpen(false); showMessage("점수급간을 저장했습니다. 평가내용 저장을 누르면 반영됩니다."); }}>저장</button>
            </div>

            <div className="rule-header-row">
              {normalizeItemType(itemType) === "checklist" ? (
                <>
                  <span>충족 개수</span>
                  <span>점수</span>
                </>
              ) : isMeasuredType(normalizeItemType(itemType)) ? (
                <>
                  <span>최소</span>
                  <span className="rule-header-separator" aria-hidden="true"></span>
                  <span>최대</span>
                  <span>점수</span>
                </>
              ) : (
                <>
                  <span>등급/기준</span>
                  <span>점수</span>
                </>
              )}
              <span aria-hidden="true"></span>
            </div>

            {itemRules.map((rule, index) => (
              <div className={`rule-row ${normalizeItemType(itemType) === "checklist" ? "checklist-rule" : isMeasuredType(normalizeItemType(itemType)) ? "number-rule" : "choice-rule"}`} key={index}>
                {normalizeItemType(itemType) === "checklist" ? (
                  <>
                    <label className="unit-input"><input type="number" min="0" value={rule.min ?? ""} onChange={(e) => { updateRule(index, "min", e.target.value); updateRule(index, "max", e.target.value); }} /><span>개</span></label>
                    <label className="unit-input score-input"><input type="number" value={rule.score ?? ""} onChange={(e) => updateRule(index, "score", e.target.value)} /><span>점</span></label>
                  </>
                ) : isMeasuredType(normalizeItemType(itemType)) ? (
                  <>
                    {normalizeItemType(itemType) === "time" && itemUnit === "분·초" ? (
                      <>
                        <div className="time-range-input">
                          <input type="number" min="0" aria-label="최소 분" value={secondsToParts(rule.min).minutes} onChange={(e) => updateRule(index, "min", partsToSeconds(e.target.value, secondsToParts(rule.min).seconds))} /><span>분</span>
                          <input type="number" min="0" max="59" aria-label="최소 초" value={secondsToParts(rule.min).seconds} onChange={(e) => updateRule(index, "min", partsToSeconds(secondsToParts(rule.min).minutes, e.target.value))} /><span>초</span>
                        </div>
                        <span className="range-separator" aria-hidden="true">-</span>
                        <div className="time-range-input">
                          <input type="number" min="0" aria-label="최대 분" value={secondsToParts(rule.max).minutes} onChange={(e) => updateRule(index, "max", partsToSeconds(e.target.value, secondsToParts(rule.max).seconds))} /><span>분</span>
                          <input type="number" min="0" max="59" aria-label="최대 초" value={secondsToParts(rule.max).seconds} onChange={(e) => updateRule(index, "max", partsToSeconds(secondsToParts(rule.max).minutes, e.target.value))} /><span>초</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="unit-input"><input placeholder="최소" value={rule.min ?? ""} onChange={(e) => updateRule(index, "min", e.target.value)} /><span>{itemUnit}</span></label>
                        <span className="range-separator" aria-hidden="true">-</span>
                        <label className="unit-input"><input placeholder="최대" value={rule.max ?? ""} onChange={(e) => updateRule(index, "max", e.target.value)} /><span>{itemUnit}</span></label>
                      </>
                    )}
                    <label className="unit-input score-input"><input placeholder="점수" value={rule.score ?? ""} onChange={(e) => updateRule(index, "score", e.target.value)} /><span>점</span></label>
                  </>
                ) : (
                  <>
                    <input placeholder="예: 우수" value={getRuleLabel(rule)} onChange={(e) => updateRule(index, "label", e.target.value)} />
                    <input placeholder="점수" value={rule.score ?? ""} onChange={(e) => updateRule(index, "score", e.target.value)} />
                  </>
                )}
                <button className="delete-btn" onClick={() => deleteRule(index)}>삭제</button>
              </div>
            ))}

            <div className="button-row rule-modal-bottom-actions">
              <button className="cancel-btn" onClick={() => setRuleModalOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {conversionModalOpen && selectedActivity && (
        <div className="modal-bg">
          <div className="modal assessment-conversion-modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setConversionModalOpen(false)} aria-label="닫기">×</button>
            <h2>최종환산표 입력</h2>
            <p className="conversion-modal-guide">최종점수가 먼저 보이도록 입력합니다. 예: <strong>[30점] 30 ~ 27</strong></p>
            <div className="conversion-preset-row">
              <button className="setting-btn" type="button" onClick={() => updateActivityConversion({ conversionRules: makeConversionRules(selectedActivity, 5) })}>5개 기본설정</button>
              <button className="save-btn" type="button" onClick={() => updateActivityConversion({ conversionRules: makeConversionRules(selectedActivity, 7) })}>7개 기본설정</button>
            </div>
            <div className="conversion-rule-list modal-list">
              {(selectedActivity.conversionRules || []).map((rule, index) => (
                <div className="conversion-rule-row" key={index}>
                  <label className="conversion-final-score"><input value={rule.score} onChange={(e) => updateConversionRule(index, "score", e.target.value)} /><strong>점</strong></label>
                  <input aria-label="합산 최고점" value={rule.max} onChange={(e) => updateConversionRule(index, "max", e.target.value)} />
                  <span>~</span>
                  <input aria-label="합산 최저점" value={rule.min} onChange={(e) => updateConversionRule(index, "min", e.target.value)} />
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="cancel-btn" onClick={() => setConversionModalOpen(false)}>닫기</button>
              <button className="save-btn" onClick={() => { setConversionModalOpen(false); showMessage("최종환산표를 저장했습니다."); }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {checklistModal && (
        <div className="modal-bg">
          <div className="modal checklist-evaluation-modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setChecklistModal(null)} aria-label="닫기">×</button>
            <h2>{checklistModal.student.name} · {checklistModal.item.name}</h2>
            <p className="checklist-evaluation-guide">성공한 평가요소를 체크하면 점수가 자동 계산됩니다.</p>
            <div className="checklist-evaluation-list">
              {(checklistModal.item.criteria || []).map((criterion, index) => {
                const checked = checklistModal.checked.includes(criterion.id);
                return (
                  <label key={criterion.id || index} className={checked ? "checked" : ""}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setChecklistModal((prev) => {
                          const nextChecked = e.target.checked
                            ? [...prev.checked, criterion.id]
                            : prev.checked.filter((id) => id !== criterion.id);
                          return { ...prev, checked: nextChecked };
                        });
                      }}
                    />
                    <span>{index + 1}. {criterion.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="checklist-evaluation-result">
              <span>충족 {checklistModal.checked.length}/{(checklistModal.item.criteria || []).length}개</span>
              <strong>{getItemScoreFromValue(checklistModal.item, { checked: checklistModal.checked })}점</strong>
            </div>
            <div className="button-row">
              <button className="cancel-btn" type="button" onClick={() => setChecklistModal(null)}>취소</button>
              <button className="save-btn" type="button" onClick={() => {
                updateScore(inputActivity, checklistModal.student.id, checklistModal.item, {
                  checked: checklistModal.checked,
                  score: getItemScoreFromValue(checklistModal.item, { checked: checklistModal.checked }),
                  criteria: (checklistModal.item.criteria || []).map((criterion) => ({
                    id: criterion.id,
                    label: criterion.label,
                    achieved: checklistModal.checked.includes(criterion.id),
                  })),
                });
                setChecklistModal(null);
                showMessage(`${checklistModal.student.name} 평가요소를 저장했습니다.`);
              }}>평가 저장</button>
            </div>
          </div>
        </div>
      )}

      {previewItem && (
        <div className="modal-bg">
          <div className="modal peon-popup-modal">
            <button className="modal-close-x" type="button" onClick={() => setPreviewItem(null)} aria-label="닫기">×</button>
            <h2>{previewItem.name} 점수급간</h2>
            <table className="student-table">
              <thead>
                <tr>
                  {isMeasuredType(normalizeItemType(previewItem.type)) ? (
                    <>
                      <th>최소</th>
                      <th>최대</th>
                      <th>점수</th>
                    </>
                  ) : (
                    <>
                      <th>등급/기준</th>
                      <th>점수</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {(previewItem.rules || []).map((rule, index) => (
                  <tr key={index}>
                    {isMeasuredType(normalizeItemType(previewItem.type)) ? (
                      <>
                        <td>{rule.min}</td>
                        <td>{rule.max}</td>
                        <td>{rule.score}점</td>
                      </>
                    ) : (
                      <>
                        <td>{getRuleLabel(rule)}</td>
                        <td>{getRuleScore(rule)}점</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="button-row">
              <button className="save-btn" onClick={() => setPreviewItem(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
