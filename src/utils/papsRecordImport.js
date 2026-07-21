import * as XLSX from "xlsx";
import { readPdfRows } from "./pdfTableRows";

const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();

const usefulHeaderKeywords = [
  "학생성명", "학생명", "성명", "이름", "번호", "출석번호", "반", "반명",
  "악력", "제자리멀리뛰기", "앉아윗몸", "셔틀런", "왕복오래달리기",
  "신장", "키", "체중", "몸무게",
];

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

const getFirstValue = (row, candidates) => {
  for (const candidate of candidates) {
    const value = getCell(row, [candidate]);
    if (value !== "" && value !== undefined && value !== null) return value;
  }
  return "";
};

const inferClassFromRowOrFile = (row, fileName, fallbackClass) => {
  const fullClass = getCell(row, ["학급", "반", "반명", "학년반", "className"]);
  const grade = getCell(row, ["학년", "grade"]);
  const ban = getCell(row, ["반명", "반", "class", "className"]);
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

const normalizeGender = (value) => {
  const text = String(value ?? "").trim();
  const compact = text.replace(/\s/g, "").toLowerCase();
  if (compact === "2" || compact === "2.0" || compact.includes("여") || compact.includes("female") || compact === "f") return "여";
  return "남";
};

const putTryValues = (record, values) => {
  values.forEach((value, index) => {
    if (value !== "" && value !== undefined && value !== null) {
      record[`try${index + 1}`] = String(value);
    }
  });
};

export const readPapsWorkbookRows = async (file) => {
  if (/\.pdf$/i.test(file.name)) {
    return readPdfRows(file, usefulHeaderKeywords);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const rows = [];

  const isUsefulHeader = (value) => {
    const text = normalize(value);
    return usefulHeaderKeywords.some((keyword) => text.includes(normalize(keyword)));
  };
  const usefulCount = (row) => (row || []).filter(isUsefulHeader).length;

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    if (!matrix.length) return;

    let headerIndex = matrix.findIndex((row) => usefulCount(row) >= 2);
    if (headerIndex < 0) headerIndex = 0;

    let topRow = matrix[headerIndex] || [];
    const subRow = matrix[headerIndex + 1] || [];
    let dataStartIndex = headerIndex + 1;

    // NEIS "학급별 건강체력평가"처럼 헤더가 대분류(1행)+세부항목(2행)으로 나뉜 경우,
    // 세부항목 행에 실제 측정 항목명(악력/제자리멀리뛰기 등)이 있으므로 두 줄을 합쳐서 사용한다.
    if (usefulCount(subRow) > usefulCount(topRow)) {
      const filledTop = [];
      let last = "";
      topRow.forEach((cell, index) => {
        const text = String(cell ?? "").trim();
        if (text) last = text;
        filledTop[index] = last;
      });
      topRow = subRow.map((cell, index) => {
        const sub = String(cell ?? "").trim();
        const top = filledTop[index] || "";
        return [top, sub].filter(Boolean).join(" ");
      });
      dataStartIndex = headerIndex + 2;
    }

    const headers = topRow.map((header, index) => {
      const text = String(header || "").trim();
      return text || `열${index + 1}`;
    });

    matrix.slice(dataStartIndex).forEach((line) => {
      if (!line || line.every((cell) => String(cell ?? "").trim() === "")) return;
      // 인쇄용 표는 페이지마다 제목/헤더 줄이 반복될 수 있으므로 그런 줄은 데이터로 넣지 않는다.
      if (usefulCount(line) >= 2) return;
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

/**
 * PAPS 측정 파일(엑셀/PDF)을 읽어 명단(students)과 측정기록(scores)을 갱신한다.
 * Paps.jsx 탭과 관리 탭(Settings.jsx)에서 동일하게 재사용한다.
 *
 * @param {Object} params
 * @param {File[]} params.files
 * @param {Object} params.students - { [className]: [{id, number, name, gender, health}] }
 * @param {Object} params.existingScores - 기존 paps scores 객체
 * @param {string} [params.fallbackClass]
 */
export const importPapsRecords = async ({ files, students, existingScores, fallbackClass = "2-1" }) => {
  const nextStudents = { ...students };
  const nextScores = { ...existingScores };
  let importedStudents = 0;
  let importedRecords = 0;

  const ensureItem = (itemId, className, studentId) => {
    nextScores[itemId] = { ...(nextScores[itemId] || {}) };
    nextScores[itemId][className] = { ...(nextScores[itemId][className] || {}) };
    nextScores[itemId][className][studentId] = { ...(nextScores[itemId][className][studentId] || {}) };
    return nextScores[itemId][className][studentId];
  };

  for (const file of files) {
    const rows = await readPapsWorkbookRows(file);
    rows.forEach((row) => {
      const name = String(getCell(row, ["학생성명", "학생명", "성명", "이름", "name"])).trim();
      if (!name) return;

      const className = inferClassFromRowOrFile(row, file.name, fallbackClass);
      const number = String(getCell(row, ["번호", "출석번호", "학번", "number"])).replace(/\.0$/, "").trim();
      const gender = normalizeGender(getCell(row, ["성별", "남녀", "gender"]));
      const health = String(getCell(row, ["유의사항", "건강상유의사항", "건강상 유의사항", "참고사항", "health"])).trim();

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
      const bmiDirect = height === "" && weight === "" ? getFirstValue(row, ["BMI", "BMI(kg/㎡)", "bmi"]) : "";

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

      if (height !== "" || weight !== "" || bmiDirect !== "") {
        const bmiRecord = ensureItem("bmi", className, student.id);
        if (height !== "") bmiRecord.height = String(height);
        if (weight !== "") bmiRecord.weight = String(weight);
        if (bmiDirect !== "") bmiRecord.bmiDirect = String(bmiDirect).replace(/[^0-9.]/g, "");
        importedRecords += 1;
      }
    });
  }

  return { nextStudents, nextScores, importedStudents, importedRecords };
};
