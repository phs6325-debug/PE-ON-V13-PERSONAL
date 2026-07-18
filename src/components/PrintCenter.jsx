import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

const classes = ["전체", "2-1", "2-2", "2-3", "2-4", "2-5"];
const today = () => new Date().toISOString().slice(0, 10);
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
};
const info = () => ({
  year: localStorage.getItem("peon_year") || "2026학년도",
  semester: localStorage.getItem("peon_semester") || "1학기",
});
const sheetName = (name) => String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
const rowsOrBlank = (rows) => rows?.length ? rows : [{ 안내: "출력할 자료가 없습니다." }];
const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const byteLength = (text) => new Blob([String(text || "")]).size;

function downloadXlsx(sheets, fileName) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sheet) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsOrBlank(sheet.rows)), sheetName(sheet.name)));
  XLSX.writeFile(wb, fileName);
}

function tableHtml(sheet) {
  const rows = rowsOrBlank(sheet.rows);
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  return `
    <h2>${esc(sheet.name)}</h2>
    <table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r?.[h])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function printPdf(sheets, title) {
  const html = `<!doctype html><html><head><meta charset="UTF-8" />
    <title>${esc(title)}</title>
    <style>
      body{font-family:"Noto Sans KR",Arial,sans-serif;padding:20px;color:#111827}
      h1{text-align:center} h2{font-size:18px;margin:24px 0 10px}
      table{width:100%;border-collapse:collapse;margin-bottom:24px}
      th,td{border:1px solid #999;padding:7px;text-align:center;font-size:12px;vertical-align:top}
      td:last-child{text-align:left;line-height:1.55;word-break:keep-all}
      th{background:#eff6ff;font-weight:800}
      @media print{body{padding:8mm}}
    </style></head><body>
    <h1>${esc(title)}</h1>
    <div style="text-align:right;font-size:12px;color:#555">출력일: ${today()}</div>
    ${sheets.map(tableHtml).join("")}
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) { alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요."); return; }
  popup.document.open(); popup.document.write(html); popup.document.close();
}

function printRecordBookPdf(rows, title) {
  const html = `<!doctype html><html><head><meta charset="UTF-8" />
    <title>${esc(title)}</title>
    <style>
      @page{size:A4;margin:12mm}
      body{font-family:"Noto Sans KR",Arial,sans-serif;color:#111827;margin:0}
      h1{text-align:center;font-size:21px;margin:0 0 12px}
      .meta{text-align:right;font-size:11px;color:#64748b;margin-bottom:10px}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      th,td{border:1px solid #999;padding:6px 7px;font-size:11.5px;vertical-align:top}
      th{background:#eff6ff;text-align:center;font-weight:800}
      .num{width:46px;text-align:center}.name{width:74px;text-align:center}.class{width:58px;text-align:center}
      .text{line-height:1.55;word-break:keep-all;text-align:left}
      .empty{color:#9ca3af;text-align:center}
    </style></head><body>
    <h1>${esc(title)}</h1>
    <div class="meta">출력일: ${today()} · 총 ${rows.length}명</div>
    <table>
      <thead><tr><th class="class">학급</th><th class="num">번호</th><th class="name">이름</th><th>교과세특</th></tr></thead>
      <tbody>${rows.map((r)=>`<tr><td class="class">${esc(r.학급)}</td><td class="num">${esc(r.번호)}</td><td class="name">${esc(r.이름)}</td><td class="text ${r.교과세특 ? "" : "empty"}">${esc(r.교과세특 || "미작성")}</td></tr>`).join("")}</tbody>
    </table>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`;
  const popup = window.open("", "_blank");
  if (!popup) { alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요."); return; }
  popup.document.open(); popup.document.write(html); popup.document.close();
}

function scoreByRule(item, value) {
  if (value === "" || value === null || value === undefined) return 0;
  if (item.type === "직접점수입력") return Number(value) || 0;
  if (["횟수","시간","거리"].includes(item.type)) {
    const num = Number(value);
    for (const rule of item.rules || []) {
      const min = rule.min === "" ? -Infinity : Number(rule.min);
      const max = rule.max === "" ? Infinity : Number(rule.max);
      if (num >= min && num <= max) return Number(rule.score || 0);
    }
  }
  if (["자세평가","참여도"].includes(item.type)) {
    const rule = (item.rules || []).find((r) => String(r.condition) === String(value));
    return Number(rule?.score || 0);
  }
  return 0;
}

function papsRecord(scores, className, studentId, itemId) {
  return scores?.[className]?.[studentId]?.[itemId]
    || scores?.[String(itemId)]?.[className]?.[studentId]
    || scores?.[className]?.[itemId]?.[studentId]
    || {};
}

function papsBest(record, item) {
  if (record.best !== undefined) return record.best;
  if (record.bestRecord !== undefined) return record.bestRecord;
  const values = [];
  for (let i = 1; i <= Number(item.attempts || 0); i++) {
    const v = record[`attempt${i}`] ?? record[`try${i}`] ?? record[`${i}차`] ?? record[i] ?? "";
    if (v !== "") values.push(Number(v));
  }
  if (!values.length) return "";
  return item.best ? Math.max(...values) : values[0];
}

export default function PrintCenter() {
  const { year, semester } = info();
  const [kind, setKind] = useState("progress");
  const [selectedClass, setSelectedClass] = useState("전체");
  const [queryKind, setQueryKind] = useState("");
  const [queryClass, setQueryClass] = useState("");
  const [assessmentTargets, setAssessmentTargets] = useState(["all"]);
  const [papsTargets, setPapsTargets] = useState(["all"]);
  const [recordFilter, setRecordFilter] = useState("all");

  const students = useMemo(() => load(`peon_${year}_${semester}_students`, {}), [year, semester]);
  const progress = useMemo(() => load("peon_progress", {}), []);
  const activities = useMemo(() => load(`peon_${year}_${semester}_assessment`, []), [year, semester]);
  const assessmentScores = useMemo(() => load(`peon_${year}_${semester}_assessment_scores`, {}), [year, semester]);
  const papsItems = useMemo(() => load(`peon_${year}_${semester}_paps_items`, []), [year, semester]);
  const papsScores = useMemo(() => load(`peon_${year}_${semester}_paps_scores`, {}), [year, semester]);
  const studentRecords = useMemo(() => load(`peon_${year}_${semester}_student_records`, {}), [year, semester]);

  const visibleClasses = selectedClass === "전체" ? ["2-1","2-2","2-3","2-4","2-5"] : [selectedClass];

  const toggle = (id, setter) => setter((prev) => {
    if (id === "all") return ["all"];
    const list = prev.filter((v) => v !== "all");
    return list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  });

  const makeRoster = () => visibleClasses.map((c) => ({
    name: `${c} 명렬표`,
    rows: (students[c] || []).map((s) => ({ 학급:c, 번호:s.number, 이름:s.name, 성별:s.gender, 유의사항:s.health || "" })),
  }));

  const makeProgress = () => visibleClasses.map((c) => ({
    name: `${c} 진도`,
    rows: (progress[c] || []).map((r) => ({ 학급:c, 날짜:r.date, 수업내용:r.content, 특이사항:r.note || "" })),
  }));

  const makeAssessment = () => {
    const targets = assessmentTargets.includes("all") ? activities : activities.filter((a) => assessmentTargets.includes(String(a.id)));
    const sheets = [];
    visibleClasses.forEach((c) => targets.forEach((activity) => {
      sheets.push({
        name: `${c}_${activity.name || "활동"}`,
        rows: (students[c] || []).map((s) => {
          const row = { 학급:c, 번호:s.number, 이름:s.name };
          let total = 0;
          (activity.items || []).forEach((item) => {
            const value = assessmentScores[String(activity.id)]?.[c]?.[s.id]?.[item.id] ?? "";
            const score = scoreByRule(item, value);
            row[item.name] = value;
            row[`${item.name}점수`] = score;
            total += score;
          });
          row.총점 = total;
          return row;
        })
      });
    }));
    return sheets.length ? sheets : [{ name:"수행평가", rows:[] }];
  };

  const makePaps = () => {
    const targets = papsTargets.includes("all") ? papsItems : papsItems.filter((i) => papsTargets.includes(String(i.id)));
    const sheets = [];
    visibleClasses.forEach((c) => targets.forEach((item) => {
      sheets.push({
        name: `${c}_${item.name || "PAPS"}`,
        rows: (students[c] || []).map((s) => {
          const record = papsRecord(papsScores, c, s.id, item.id);
          const row = { 학급:c, 번호:s.number, 이름:s.name, 성별:s.gender, 종목:item.name };
          for (let i=1; i<=Number(item.attempts || 0); i++) {
            row[`${i}차`] = record[`attempt${i}`] ?? record[`try${i}`] ?? record[`${i}차`] ?? record[i] ?? "";
          }
          row.최고기록 = papsBest(record, item);
          row.등급 = record.grade ?? record.level ?? record.resultGrade ?? "";
          return row;
        })
      });
    }));
    return sheets.length ? sheets : [{ name:"PAPS", rows:[] }];
  };

  const makeRecordRows = () => visibleClasses.flatMap((c) =>
    (students[c] || []).map((s) => {
      const text = studentRecords?.[c]?.[s.id] || "";
      return {
        학급: c,
        번호: s.number,
        이름: s.name,
        작성여부: text ? "생성" : "미작성",
        바이트: text ? byteLength(text) : 0,
        교과세특: text,
      };
    })
  ).filter((row) => {
    if (recordFilter === "done") return Boolean(row.교과세특);
    if (recordFilter === "missing") return !row.교과세특;
    return true;
  });

  const makeRecords = () => [{ name: `${selectedClass} 교과세특`, rows: makeRecordRows() }];

  const makeSheets = () => {
    if (kind === "roster") return makeRoster();
    if (kind === "progress") return makeProgress();
    if (kind === "assessment") return makeAssessment();
    if (kind === "paps") return makePaps();
    if (kind === "records") return makeRecords();
    return [];
  };

  const titles = { roster:"명렬표", progress:"진도", assessment:"수행평가", paps:"PAPS", records:"교과세특" };
  const fileTitle = `${year}_${semester}_${selectedClass}_${titles[kind]}`;


  const runPrintQuery = () => {
    if (!queryClass || !queryKind) {
      window.alert("학년-반과 영역을 모두 선택하세요.");
      return;
    }
    setSelectedClass(queryClass);
    setKind(queryKind);
  };

  return (
    <div className="page print-center-page">
      <h2>🖨️ 출력센터</h2>
      <section className="card print-control-card">
        <div className="peon-query-bar print-query-bar" aria-label="출력 조회 조건">
          <select value={queryClass} onChange={(e) => setQueryClass(e.target.value)} aria-label="학년-반 선택">
            <option value="">학년-반</option>
            {classes.filter((c) => c !== "전체").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={queryKind} onChange={(e) => setQueryKind(e.target.value)} aria-label="영역 선택">
            <option value="">영역선택</option>
            <option value="progress">진도</option>
            <option value="assessment">수행평가</option>
            <option value="paps">PAPS</option>
            <option value="roster">명렬표</option>
            <option value="records">교과세특</option>
          </select>
          <button type="button" className="save-btn peon-query-button" onClick={runPrintQuery}>조회</button>
        </div>

        {kind === "assessment" && (
          <div className="print-check-panel">
            <strong>수행평가 영역 선택</strong>
            <label><input type="checkbox" checked={assessmentTargets.includes("all")} onChange={() => toggle("all", setAssessmentTargets)} />전체 영역</label>
            {activities.map((a) => (
              <label key={a.id}><input type="checkbox" checked={!assessmentTargets.includes("all") && assessmentTargets.includes(String(a.id))} onChange={() => toggle(String(a.id), setAssessmentTargets)} />{a.name} ({a.score}점)</label>
            ))}
          </div>
        )}

        {kind === "paps" && (
          <div className="print-check-panel">
            <strong>PAPS 종목 선택</strong>
            <label><input type="checkbox" checked={papsTargets.includes("all")} onChange={() => toggle("all", setPapsTargets)} />전체 종목</label>
            {papsItems.map((i) => (
              <label key={i.id}><input type="checkbox" checked={!papsTargets.includes("all") && papsTargets.includes(String(i.id))} onChange={() => toggle(String(i.id), setPapsTargets)} />{i.name}</label>
            ))}
          </div>
        )}

        {kind === "records" && (
          <div className="print-check-panel record-print-panel">
            <strong>교과세특 출력 범위</strong>
            <label><input type="radio" name="recordFilter" checked={recordFilter === "all"} onChange={() => setRecordFilter("all")} />전체 학생</label>
            <label><input type="radio" name="recordFilter" checked={recordFilter === "done"} onChange={() => setRecordFilter("done")} />세특 생성된 학생만</label>
            <label><input type="radio" name="recordFilter" checked={recordFilter === "missing"} onChange={() => setRecordFilter("missing")} />미생성 학생만</label>
          </div>
        )}

        <div className="print-action-row">
          <button className="save-btn" onClick={() => downloadXlsx(makeSheets(), `${today()}_${fileTitle}.xlsx`)}>엑셀 다운로드</button>
          <button className="setting-btn" onClick={() => printPdf(makeSheets(), fileTitle)}>PDF 저장/인쇄</button>
          {kind === "records" && <button className="save-btn" onClick={() => printRecordBookPdf(makeRecordRows(), `${fileTitle}_생활기록부_제출용`)}>생활기록부 제출용 PDF</button>}
        </div>
      </section>

      <section className="card print-preview-card">
        <h3>사용 방법</h3>
        <p>출력 종류와 학급을 선택한 뒤 엑셀 다운로드 또는 PDF 저장/인쇄를 누르세요. 수행평가와 PAPS는 전체 또는 영역/종목별 선택 출력이 가능합니다. 교과세특은 전체/생성/미생성 학생별로 출력할 수 있고, 생활기록부 제출용 PDF는 세특 입력용으로 간결하게 정리됩니다.</p>
      </section>
    </div>
  );
}
