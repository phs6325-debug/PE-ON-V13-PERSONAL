import * as XLSX from "xlsx";
import { readPdfRows } from "./pdfTableRows";

export const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
export const normalizeName = (value) => String(value ?? "").replace(/\s/g, "").trim().toLowerCase();
export const normalizeNumber = (value) =>
  String(value ?? "").replace(/\.0$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "") ||
  String(value ?? "").replace(/\.0$/, "").trim();

const usefulHeaderKeywords = [
  "번호", "출석번호", "학생성명", "학생명", "성명", "이름", "반", "반명", "학년반",
  "평가점수", "점수", "총점", "활동", "평가활동",
];

export const readAssessmentScoreRows = async (file) => {
  if (/\.pdf$/i.test(file.name)) {
    return readPdfRows(file, usefulHeaderKeywords);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const rows = [];

  const normalizeHeader = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();
  const isUsefulHeader = (value) => {
    const text = normalizeHeader(value);
    return usefulHeaderKeywords.some((keyword) => text.includes(normalizeHeader(keyword)));
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

export const getExcelCell = (row, candidates) => {
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

export const inferClassNameFromRow = (row, fallbackClass) => {
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

export const extractNeisClassAndNumber = (row, fallbackClass) => {
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

export const parseScoreNumber = (value) => {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return "";
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
};

export const findAnyScoreValue = (row) => {
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

export const findColumnValueForItem = (row, item) => {
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

/**
 * 엑셀/PDF 파일 목록을 읽어 평가활동(activities) · 학생(students)과 매칭한 뒤
 * 병합된 점수 객체를 돌려준다. Assessment.jsx의 점수입력 탭과
 * 관리 탭(SharedFileBox)에서 동일하게 재사용한다.
 *
 * @param {Object} params
 * @param {File[]} params.files
 * @param {Array} params.activities - [{id, name, score, items:[...]}]
 * @param {Object} params.students - { [className]: [{id, number, name}] }
 * @param {Object} params.existingScores - 기존 scores 객체 (병합 대상)
 * @param {string} [params.targetActivityId] - "all"이면 전체 활동에 매칭, 특정 id면 그 활동에만
 * @param {string} [params.fallbackClass] - 반을 못 찾았을 때 사용할 기본 반
 */
export const importAssessmentScores = async ({
  files,
  activities,
  students,
  existingScores,
  targetActivityId = "all",
  fallbackClass = "2-1",
}) => {
  const nextScores = { ...existingScores };
  let imported = 0;
  let skipped = 0;
  let rowCount = 0;

  const selectedTarget = activities.find((activity) => String(activity.id) === String(targetActivityId));
  const targetActivities = targetActivityId === "all" ? activities : (selectedTarget ? [selectedTarget] : activities);

  for (const file of files) {
    const rows = await readAssessmentScoreRows(file);
    rows.forEach((row) => {
      rowCount += 1;
      const neisInfo = extractNeisClassAndNumber(row, fallbackClass);
      const className = neisInfo.className || inferClassNameFromRow(row, fallbackClass);
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
        const items = (activity.items || []).length
          ? activity.items
          : [{ id: "directTotal", name: "평가점수", type: "direct", score: activity.score, rules: [] }];

        nextScores[activityId] = { ...(nextScores[activityId] || {}) };
        nextScores[activityId][className] = { ...(nextScores[activityId][className] || {}) };
        nextScores[activityId][className][student.id] = {
          ...(nextScores[activityId][className][student.id] || {}),
        };

        let activityImported = false;

        // NEIS 수행평가 PDF는 활동별 합계점수만 제공하므로 활동명에 따라 열을 자동 연결합니다.
        if (Array.isArray(row.__scoreValues) && row.__scoreValues.length) {
          const activityText = normalize(activity.name);
          let scoreIndex = targetActivities.indexOf(activity);
          if (activityText.includes("체력")) scoreIndex = 0;
          else if (activityText.includes("건강") || activityText.includes("사회적건강")) scoreIndex = 1;
          else if (activityText.includes("전략") || activityText.includes("스포츠")) scoreIndex = 2;

          const pdfValue = row.__scoreValues[scoreIndex];
          if (pdfValue !== undefined && pdfValue !== null && pdfValue !== "") {
            nextScores[activityId][className][student.id].directTotal = String(pdfValue);
            imported += 1;
            activityImported = true;
          }
        }

        if (!row.__pdfFallback) items.forEach((item) => {
          const value = findColumnValueForItem(row, item);
          if (value === "" || value === undefined || value === null) return;
          const scoreValue = parseScoreNumber(value);
          if (!scoreValue) return;
          nextScores[activityId][className][student.id][String(item.id)] = scoreValue;
          imported += 1;
          activityImported = true;
        });

        const directValue = row.__pdfFallback ? "" : (findColumnValueForItem(row, activity) || findAnyScoreValue(row));
        if (directValue !== "" && directValue !== undefined && directValue !== null) {
          const scoreValue = parseScoreNumber(directValue);
          if (scoreValue) {
            nextScores[activityId][className][student.id].directTotal = scoreValue;
            if (!activityImported) imported += 1;
            activityImported = true;
          }
        }
      });
    });
  }

  return { nextScores, imported, skipped, rowCount };
};
