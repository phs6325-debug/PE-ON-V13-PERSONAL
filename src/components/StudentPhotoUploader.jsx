import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const normalize = (value) => String(value ?? "").replace(/\s/g, "").toLowerCase();

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const dataUrlToFile = async (dataUrl, fileName) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/jpeg" });
};

const loadPdfJs = () => new Promise((resolve, reject) => {
  if (window.pdfjsLib) {
    resolve(window.pdfjsLib);
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  script.onload = () => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    resolve(window.pdfjsLib);
  };
  script.onerror = () => reject(new Error("PDF 처리 모듈을 불러오지 못했습니다."));
  document.body.appendChild(script);
});

const classFromFileName = (fileName) => {
  const compact = normalize(fileName).replace(/_/g, "-");
  const found = compact.match(/2-([1-5])/);
  return found ? `2-${found[1]}` : "";
};

const findStudentByFileName = (studentsByClass, fileName) => {
  const compact = normalize(fileName.replace(/\.[^.]+$/, ""));
  for (const cls of classes) {
    const list = studentsByClass[cls] || [];
    for (const student of list) {
      const number = String(student.number || "");
      const name = normalize(student.name || "");
      const classMatched = compact.includes(normalize(cls)) || compact.includes(normalize(cls.replace("-", "")));
      const numberMatched = compact.includes(`${normalize(cls)}${number}`) || compact.includes(`${normalize(cls.replace("-", ""))}${number}`) || compact.includes(`_${number}_`) || compact.includes(`-${number}-`) || compact.endsWith(number);
      const nameMatched = name && compact.includes(name);
      if ((classMatched && numberMatched) || (classMatched && nameMatched) || (numberMatched && nameMatched)) return { cls, student };
    }
  }
  return null;
};

const parsePdfEntries = (text, fallbackClass) => {
  const normalizedText = text.replace(/\s+/g, " ");
  const matches = [...normalizedText.matchAll(/2학년\s*([1-5])반\s*(\d{1,2})번\s*([가-힣]{2,5})/g)];
  return matches
    .map((m) => ({ classNo: m[1], number: Number(m[2]), name: m[3] }))
    .filter((entry) => (fallbackClass ? `2-${entry.classNo}` === fallbackClass : true))
    .sort((a, b) => Number(a.number) - Number(b.number));
};

const makePdfPhotoSlots = () => {
  const columns = 8;
  const xStart = 0.0805;
  const xGap = 0.10635;
  const photoWidth = 0.0845;
  const yStarts = [0.229, 0.459, 0.689];
  const photoHeight = 0.151;
  const slots = [];
  yStarts.forEach((y) => {
    for (let i = 0; i < columns; i += 1) slots.push({ x: xStart + i * xGap, y, w: photoWidth, h: photoHeight });
  });
  return slots;
};

const detectContentBounds = (sourceCanvas) => {
  const ctx = sourceCanvas.getContext("2d");
  const { width, height } = sourceCanvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const isWhite = r > 242 && g > 242 && b > 242;
      const isBlack = r < 35 && g < 35 && b < 35;
      if (!isWhite && !isBlack) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const padX = Math.round((maxX - minX) * 0.04);
  const padTop = Math.round((maxY - minY) * 0.02);
  const padBottom = Math.round((maxY - minY) * 0.01);
  return { x: Math.max(0, minX - padX), y: Math.max(0, minY - padTop), w: Math.min(width, maxX - minX + padX * 2), h: Math.min(height, maxY - minY + padTop + padBottom) };
};

const cropCanvasToDataUrl = (canvas, slot) => {
  const sourceX = Math.round(canvas.width * slot.x);
  const sourceY = Math.round(canvas.height * slot.y);
  const sourceW = Math.round(canvas.width * slot.w);
  const sourceH = Math.round(canvas.height * slot.h);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW;
  sourceCanvas.height = sourceH;
  sourceCanvas.getContext("2d").drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
  const bounds = detectContentBounds(sourceCanvas) || { x: 0, y: 0, w: sourceW, h: sourceH };
  const out = document.createElement("canvas");
  out.width = 420; out.height = 520;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, out.width, out.height);
  const targetRatio = out.width / out.height;
  const sourceRatio = bounds.w / bounds.h;
  let drawW = bounds.w, drawH = bounds.h, drawX = bounds.x, drawY = bounds.y;
  if (sourceRatio > targetRatio) { drawW = bounds.h * targetRatio; drawX = bounds.x + (bounds.w - drawW) / 2; }
  else { drawH = bounds.w / targetRatio; drawY = bounds.y + (bounds.h - drawH) / 2; }
  ctx.drawImage(sourceCanvas, drawX, drawY, drawW, drawH, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.92);
};

async function extractPdfCandidates(file, studentsByClass, setMessage) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const fallbackClass = classFromFileName(file.name);
  const slots = makePdfPhotoSlots();
  const rows = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    setMessage(`${file.name} ${pageNo}/${pdf.numPages}쪽 사진 후보 추출 중...`);
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const text = (await page.getTextContent()).items.map((item) => item.str).join(" ");
    const entries = parsePdfEntries(text, fallbackClass);
    entries.forEach((entry, index) => {
      const cls = `2-${entry.classNo}`;
      const student = (studentsByClass[cls] || []).find((item) => String(item.number) === String(entry.number));
      const slot = slots[index];
      if (!slot) return;
      rows.push({
        id: `${file.name}_${pageNo}_${entry.classNo}_${entry.number}_${index}`,
        source: file.name,
        pageNo,
        cls,
        number: entry.number,
        pdfName: entry.name,
        studentId: student?.id || "",
        studentName: student?.name || entry.name || "",
        dataUrl: cropCanvasToDataUrl(canvas, slot),
        candidateIndex: rows.filter((row) => row.cls === cls).length,
        adjust: { x: 0, y: 0, scale: 1.08 },
        saved: false,
        status: student ? "확인대기" : "명렬표 없음",
      });
    });
  }
  return rows;
}

export default function StudentPhotoUploader({ year, semester }) {
  const studentKey = `peon_${year}_${semester}_students`;
  const pdfKey = `peon_${year}_${semester}_photo_pdf_files`;
  const reviewKey = `peon_${year}_${semester}_photo_review_rows`;
  const [message, setMessage] = useState("");
  const [results, setResults] = useState([]);
  const [pdfFiles, setPdfFiles] = useState(() => JSON.parse(localStorage.getItem(pdfKey) || "[]"));
  const [reviewRows, setReviewRows] = useState(() => JSON.parse(localStorage.getItem(reviewKey) || "[]"));
  const [collapsed, setCollapsed] = useState({});
  const [photoMap, setPhotoMap] = useState({});
  const [adjustMap, setAdjustMap] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dragState, setDragState] = useState(null);

  const studentsByClass = JSON.parse(localStorage.getItem(studentKey) || "{}");

  useEffect(() => {
    localStorage.setItem(reviewKey, JSON.stringify(reviewRows));
  }, [reviewRows, reviewKey]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return undefined;
    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    const unsubscribe = onSnapshot(dataDoc, (snapshot) => {
      const data = snapshot.data() || {};
      const photos = data.photos || {};
      const adjustments = data.adjustments || {};
      setPhotoMap(photos);
      setAdjustMap(adjustments);
      Object.entries(photos).forEach(([studentId, url]) => localStorage.setItem(`student_photo_${studentId}`, url));
      Object.entries(adjustments).forEach(([studentId, adjust]) => localStorage.setItem(`student_photo_adjust_${studentId}`, JSON.stringify(adjust)));
    });
    return () => unsubscribe();
  }, [year, semester]);

  const classSummary = useMemo(() => classes.map((cls) => {
    const total = (studentsByClass[cls] || []).length;
    const rows = reviewRows.filter((row) => row.cls === cls);
    const saved = rows.filter((row) => row.saved || photoMap[row.studentId]).length;
    const need = Math.max(0, total - saved);
    return { cls, total, extracted: rows.length, saved, need };
  }), [reviewRows, photoMap, studentsByClass]);

  const savePhotoToStudent = async (row, customAdjust = row.adjust) => {
    const user = auth.currentUser;
    if (!user) throw new Error("로그인 정보를 확인해 주세요.");
    if (!row.studentId) throw new Error("명렬표 학생 정보가 없습니다.");
    const file = await dataUrlToFile(row.dataUrl, `${row.cls}_${row.number}_${row.studentName}.jpg`);
    const storagePath = `peonUsers/${user.uid}/studentPhotos/${year}_${semester}/${row.studentId}_${Date.now()}_${file.name}`;
    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    const nextPhotos = { ...photoMap, [row.studentId]: url };
    const nextAdjustments = { ...adjustMap, [row.studentId]: customAdjust || { x: 0, y: 0, scale: 1.08 } };
    setPhotoMap(nextPhotos); setAdjustMap(nextAdjustments);
    localStorage.setItem(`student_photo_${row.studentId}`, url);
    localStorage.setItem(`student_photo_adjust_${row.studentId}`, JSON.stringify(nextAdjustments[row.studentId]));
    await setDoc(dataDoc, { photos: nextPhotos, adjustments: nextAdjustments, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
    setReviewRows((prev) => prev.map((item) => item.id === row.id ? { ...item, saved: true, status: "저장완료", adjust: nextAdjustments[row.studentId] } : item));
    setMessage(`${row.cls} ${row.number}번 ${row.studentName} 사진을 저장했습니다.`);
  };

  const saveAllConfirmed = async () => {
    const targets = reviewRows.filter((row) => row.studentId && !row.saved && !photoMap[row.studentId]);
    if (targets.length === 0) { setMessage("새로 저장할 사진이 없습니다."); return; }
    if (!window.confirm(`${targets.length}명의 사진을 학생카드에 저장할까요?`)) return;
    setIsProcessing(true);
    try {
      for (const row of targets) await savePhotoToStudent(row, row.adjust);
      setMessage(`${targets.length}명 사진 저장을 완료했습니다.`);
    } finally { setIsProcessing(false); }
  };

  const deleteAllPhotos = async () => {
    if (!window.confirm("현재 학기 학생카드 사진 연결을 모두 삭제할까요? 저장소 파일 자체는 남을 수 있지만 화면 연결은 초기화됩니다.")) return;
    const user = auth.currentUser;
    if (!user) return;
    const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    await setDoc(dataDoc, { photos: {}, adjustments: {}, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
    setPhotoMap({}); setAdjustMap({});
    classes.forEach((cls) => (studentsByClass[cls] || []).forEach((student) => {
      localStorage.removeItem(`student_photo_${student.id}`);
      localStorage.removeItem(`student_photo_adjust_${student.id}`);
    }));
    setReviewRows((prev) => prev.map((row) => ({ ...row, saved: false, status: row.studentId ? "확인대기" : "명렬표 없음" })));
    setMessage("학생카드 사진 연결을 모두 삭제했습니다. PDF를 다시 확인 후 저장해 주세요.");
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setIsProcessing(true); setResults([]);
    const nextPdfs = [...pdfFiles];
    const nextRows = [];
    try {
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".pdf")) {
          const dataUrl = await fileToDataUrl(file);
          nextPdfs.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl, uploadedAt: new Date().toISOString() });
          const rows = await extractPdfCandidates(file, studentsByClass, setMessage);
          nextRows.push(...rows);
          setResults((prev) => [...prev, { name: file.name, status: "후보 추출 완료", detail: `${rows.length}개 사진 후보를 만들었습니다. 확인 후 저장하세요.` }]);
          continue;
        }
        if (!/\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
          setResults((prev) => [...prev, { name: file.name, status: "제외", detail: "JPG, PNG, WEBP, PDF만 지원합니다." }]);
          continue;
        }
        const matched = findStudentByFileName(studentsByClass, file.name);
        if (!matched) {
          setResults((prev) => [...prev, { name: file.name, status: "매칭 실패", detail: "파일명 예: 2-1_1_홍길동.jpg" }]);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        const row = { id: `${file.name}_${Date.now()}`, source: file.name, pageNo: 0, cls: matched.cls, number: Number(matched.student.number), pdfName: matched.student.name, studentId: matched.student.id, studentName: matched.student.name, dataUrl, adjust: { x: 0, y: 0, scale: 1.08 }, saved: false, status: "확인대기" };
        nextRows.push(row);
        setResults((prev) => [...prev, { name: file.name, status: "후보 추가", detail: `${matched.cls} ${matched.student.number}번 ${matched.student.name}` }]);
      }
      if (nextRows.length) setReviewRows((prev) => [...prev.filter((row) => !nextRows.some((n) => n.cls === row.cls && n.number === row.number)), ...nextRows].sort((a, b) => a.cls.localeCompare(b.cls) || Number(a.number) - Number(b.number)));
      setPdfFiles(nextPdfs); localStorage.setItem(pdfKey, JSON.stringify(nextPdfs));
      setMessage("사진 후보 추출 완료: 반별 상태를 확인하고 저장하세요.");
    } finally {
      setIsProcessing(false); event.target.value = "";
    }
  };

  const openEditor = (row) => setEditing({ ...row, adjust: row.adjust || adjustMap[row.studentId] || { x: 0, y: 0, scale: 1.08 } });
  const updateEditingAdjust = (patch) => setEditing((prev) => prev ? { ...prev, adjust: { ...prev.adjust, ...patch } } : prev);
  const startDrag = (event) => {
    if (!editing) return;
    event.preventDefault();
    setDragState({ x: event.clientX, y: event.clientY, baseX: editing.adjust?.x || 0, baseY: editing.adjust?.y || 0 });
  };
  const moveDrag = (event) => {
    if (!dragState || !editing) return;
    event.preventDefault();
    const x = Math.max(-160, Math.min(160, dragState.baseX + event.clientX - dragState.x));
    const y = Math.max(-160, Math.min(160, dragState.baseY + event.clientY - dragState.y));
    updateEditingAdjust({ x, y });
  };
  const endDrag = () => setDragState(null);
  const wheelZoom = (event) => {
    if (!editing) return;
    event.preventDefault();
    const next = Math.max(0.85, Math.min(1.8, Number(editing.adjust?.scale || 1.08) + (event.deltaY < 0 ? 0.04 : -0.04)));
    updateEditingAdjust({ scale: next });
  };

  const saveEditing = async () => {
    if (!editing) return;
    const adjusted = editing.adjust || { x: 0, y: 0, scale: 1.08 };
    setReviewRows((prev) => prev.map((row) => row.id === editing.id ? { ...row, adjust: adjusted } : row));
    await savePhotoToStudent({ ...editing, adjust: adjusted }, adjusted);
    setEditing(null);
  };

  const deletePdf = (id) => {
    const next = pdfFiles.filter((file) => file.id !== id);
    setPdfFiles(next); localStorage.setItem(pdfKey, JSON.stringify(next));
  };

  return (
    <section className="card student-photo-uploader photo-center-v8">
      <div className="photo-upload-header">
        <div>
          <h3>📸 학생사진 자동등록 센터</h3>
          <p>PDF 1개에서 해당 반 전체 사진 후보를 추출한 뒤, 선생님이 확인하고 저장하는 방식입니다.</p>
          <p>1반~5반 PDF를 한 번에 올리면 반별 상태가 모두 표시됩니다. 완료 후 접어서 숨길 수 있습니다.</p>
          <p className="photo-upload-guide">① PDF 업로드 → ② 반별 확인 → ③ 필요 시 드래그 조정 → ④ 저장</p>
        </div>
        <div className="photo-upload-actions">
          <label className={`shared-file-upload-btn ${isProcessing ? "disabled" : ""}`}>{isProcessing ? "처리 중..." : "사진/PDF 업로드"}<input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={handleFiles} disabled={isProcessing} /></label>
          <button type="button" className="setting-btn" onClick={saveAllConfirmed} disabled={isProcessing}>확인 사진 전체저장</button>
          <button type="button" className="delete-btn" onClick={deleteAllPhotos} disabled={isProcessing}>사진 전체삭제</button>
        </div>
      </div>
      {message && <div className="assessment-save-message">{message}</div>}
      {results.length > 0 && <div className="photo-upload-results">{results.map((r, i) => <div key={i} className={`photo-result-row ${r.status.includes("완료") ? "success" : ""}`}><strong>{r.status}</strong><span>{r.name}</span><em>{r.detail}</em></div>)}</div>}

      <div className="photo-status-board">
        <div className="photo-status-board-title"><strong>반별 사진 상태</strong><button type="button" className="setting-btn small" onClick={() => setCollapsed(Object.fromEntries(classes.map((cls) => [cls, true])))}>전체 접기</button><button type="button" className="setting-btn small" onClick={() => setCollapsed({})}>전체 펼치기</button></div>
        {classSummary.map((summary) => {
          const rows = reviewRows.filter((row) => row.cls === summary.cls).sort((a, b) => Number(a.number) - Number(b.number));
          return <div className="photo-class-status" key={summary.cls}>
            <button type="button" className="photo-class-summary" onClick={() => setCollapsed((prev) => ({ ...prev, [summary.cls]: !prev[summary.cls] }))}>
              <b>{summary.cls}</b><span>{summary.total}명 중 {summary.saved}명 저장</span><em>후보 {summary.extracted}개 · 확인 필요 {summary.need}명</em><strong>{collapsed[summary.cls] ? "펼치기" : "접기"}</strong>
            </button>
            {!collapsed[summary.cls] && rows.length > 0 && <div className="photo-review-grid">{rows.map((row) => <div className={`photo-review-card ${row.saved || photoMap[row.studentId] ? "saved" : ""}`} key={row.id}>
              <div className="photo-review-image"><img src={row.dataUrl} alt="" /></div>
              <div className="photo-review-info"><strong>{row.cls} {row.number}번</strong><b>{row.studentName}</b><span>PDF 이름: {row.pdfName || "-"}</span><em>{row.saved || photoMap[row.studentId] ? "저장완료" : row.status}</em></div>
              <div className="photo-review-actions"><button type="button" onClick={() => openEditor(row)}>편집</button><button type="button" className="save" onClick={() => savePhotoToStudent(row)}>저장</button></div>
            </div>)}</div>}
          </div>;
        })}
      </div>

      {pdfFiles.length > 0 && <div className="photo-pdf-list"><h4>보관된 학생사진 PDF</h4>{pdfFiles.map((file) => <div className="shared-file-row" key={file.id}><div className="shared-file-info"><strong>{file.name}</strong><span>PDF 보관 및 후보 추출 이력입니다.</span></div><div className="shared-file-actions"><button className="setting-btn" onClick={() => window.open(file.dataUrl, "_blank")}>열기</button><button className="delete-btn" onClick={() => deletePdf(file.id)}>삭제</button></div></div>)}</div>}

      {editing && <div className="photo-editor-backdrop" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="photo-editor-modal">
          <div className="photo-editor-header"><strong>{editing.cls} {editing.number}번 {editing.studentName}</strong><button type="button" onClick={() => setEditing(null)}>✕</button></div>
          <div className="photo-editor-stage" onPointerDown={startDrag} onWheel={wheelZoom}>
            <img src={editing.dataUrl} alt="" draggable="false" style={{ transform: `translate(${editing.adjust?.x || 0}px, ${editing.adjust?.y || 0}px) scale(${editing.adjust?.scale || 1.08})` }} />
            <div className="photo-center-guide horizontal" /><div className="photo-center-guide vertical" /><div className="photo-center-dot" />
          </div>
          <div className="photo-editor-controls"><button type="button" onClick={() => updateEditingAdjust({ scale: Math.max(0.85, (editing.adjust?.scale || 1.08) - 0.05) })}>축소</button><button type="button" onClick={() => updateEditingAdjust({ scale: Math.min(1.8, (editing.adjust?.scale || 1.08) + 0.05) })}>확대</button><button type="button" onClick={() => updateEditingAdjust({ x: 0, y: 0, scale: 1.08 })}>초기화</button><button type="button" className="save" onClick={saveEditing}>저장</button></div>
          <p>사진을 마우스나 손가락으로 끌어 얼굴을 가운데 십자선에 맞춘 뒤 저장하세요. 마우스 휠로 확대/축소할 수 있습니다.</p>
        </div>
      </div>}
    </section>
  );
}
