import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const compact = (value) => clean(value).replace(/\s/g, "").toLowerCase();

const groupPageItems = (items) => {
  const lines = [];
  const yTolerance = 3;

  items
    .filter((item) => clean(item.str))
    .map((item) => ({
      text: clean(item.str),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Number(item.width || 0),
    }))
    .sort((a, b) => (Math.abs(b.y - a.y) > yTolerance ? b.y - a.y : a.x - b.x))
    .forEach((item) => {
      let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= yTolerance);
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    });

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let current = null;

      sorted.forEach((item) => {
        if (!current) {
          current = { text: item.text, endX: item.x + item.width };
          return;
        }

        const gap = item.x - current.endX;
        const gapThreshold = Math.max(10, Math.min(28, (item.text.length + current.text.length) * 0.8));
        if (gap > gapThreshold) {
          cells.push(current.text);
          current = { text: item.text, endX: item.x + item.width };
        } else {
          current.text = `${current.text} ${item.text}`.trim();
          current.endX = Math.max(current.endX, item.x + item.width);
        }
      });

      if (current) cells.push(current.text);
      return cells.map(clean).filter(Boolean);
    })
    .filter((row) => row.length);
};

export const readPdfRows = async (file, usefulHeaderWords = []) => {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const matrix = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageRows = groupPageItems(content.items || []);
    pageRows.forEach((row) => matrix.push({ row, pageNumber }));
  }

  if (!matrix.length) {
    throw new Error("PDF_TEXT_NOT_FOUND");
  }

  const keywords = usefulHeaderWords.map(compact).filter(Boolean);
  const headerIndex = matrix.findIndex(({ row }) => {
    const joined = compact(row.join(" "));
    return keywords.filter((keyword) => joined.includes(keyword)).length >= 2;
  });

  if (headerIndex < 0) {
    // NEIS 수행평가 일람표처럼 머리글이 여러 줄로 분리된 PDF를 위한 보조 파서입니다.
    const fallbackRows = [];
    matrix.forEach(({ row, pageNumber }) => {
      const text = clean(row.join(" "));
      const match = text.match(/^(\d+)\s*[\/\-]\s*(\d+)\s+(?:[1-3]\s+)?([가-힣A-Za-z]{2,20})\s+(.+)$/);
      if (!match) return;

      const scoreTokens = (match[4].match(/(?:전출|-?\d+(?:\.\d+)?)/g) || []);
      if (scoreTokens.length < 3 || scoreTokens.some((value) => value === "전출")) return;

      const numericScores = scoreTokens
        .map((value) => Number(String(value).replace(/,/g, "")))
        .filter((value) => Number.isFinite(value));
      if (numericScores.length < 3) return;

      fallbackRows.push({
        "반/번호": `${match[1]}/${match[2]}`,
        "성명": match[3],
        __scoreValues: numericScores.length >= 4 ? numericScores.slice(0, -1) : numericScores,
        __pageNumber: pageNumber,
        __fileName: file.name,
        __pdfFallback: true,
      });
    });

    if (fallbackRows.length) return fallbackRows;
    throw new Error("PDF_HEADER_NOT_FOUND");
  }

  const headers = matrix[headerIndex].row.map((header, index) => clean(header) || `열${index + 1}`);
  const rows = [];

  matrix.slice(headerIndex + 1).forEach(({ row, pageNumber }) => {
    if (!row.length) return;
    const joined = compact(row.join(" "));
    const headerMatches = keywords.filter((keyword) => joined.includes(keyword)).length;
    if (headerMatches >= 2) return;

    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    record.__pageNumber = pageNumber;
    record.__fileName = file.name;
    rows.push(record);
  });

  if (!rows.length) {
    throw new Error("PDF_ROWS_NOT_FOUND");
  }

  return rows;
};
