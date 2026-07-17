import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const defaultSelection = { x: 80, y: 80, w: 180, h: 240 };

const loadPdfJs = () => new Promise((resolve, reject) => {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    resolve(window.pdfjsLib);
    return;
  }
  const existing = document.querySelector("script[data-peon-pdfjs]");
  if (existing) {
    existing.addEventListener("load", () => resolve(window.pdfjsLib));
    existing.addEventListener("error", () => reject(new Error("PDF 모듈을 불러오지 못했습니다.")));
    return;
  }
  const script = document.createElement("script");
  script.dataset.peonPdfjs = "true";
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  script.onload = () => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    resolve(window.pdfjsLib);
  };
  script.onerror = () => reject(new Error("PDF 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."));
  document.body.appendChild(script);
});

const fileToArrayBuffer = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("PDF 파일을 읽지 못했습니다."));
  reader.readAsArrayBuffer(file);
});

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("파일을 보관용으로 읽지 못했습니다."));
  reader.readAsDataURL(file);
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function PhotoRegisterCenter() {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";
  const studentStorageKey = `peon_${year}_${semester}_students`;
  const photoPdfStorageKey = `peon_${year}_${semester}_photo_pdf_files`;

  const [students, setStudents] = useState(() => JSON.parse(localStorage.getItem(studentStorageKey) || "{}"));
  const [selectedClass, setSelectedClass] = useState("2-1");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [photos, setPhotos] = useState({});
  const [adjustments, setAdjustments] = useState({});
  const [message, setMessage] = useState("PDF를 불러온 뒤, 학생을 선택하고 사진 영역을 드래그해서 저장하세요.");
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfName, setPdfName] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [selection, setSelection] = useState(defaultSelection);
  const [selecting, setSelecting] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState({});
  const [previewUrl, setPreviewUrl] = useState("");
  const [savedPdfFiles, setSavedPdfFiles] = useState([]);

  const canvasRef = useRef(null);
  const viewportRef = useRef({ width: 1, height: 1, scale: 1 });

  const currentStudents = useMemo(() => [...(students[selectedClass] || [])].sort((a, b) => Number(a.number) - Number(b.number)), [students, selectedClass]);
  const selectedStudent = currentStudents.find((student) => student.id === selectedStudentId) || currentStudents[0] || null;

  useEffect(() => {
    if (!selectedStudentId && currentStudents[0]) setSelectedStudentId(currentStudents[0].id);
  }, [currentStudents, selectedStudentId]);

  useEffect(() => {
    const localPdfFiles = JSON.parse(localStorage.getItem(photoPdfStorageKey) || "[]");
    if (localPdfFiles.length) setSavedPdfFiles(localPdfFiles);

    const user = auth.currentUser;
    if (!user) return undefined;

    const rosterDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_students`);
    const unsubRoster = onSnapshot(rosterDoc, (snapshot) => {
      const cloudStudents = snapshot.data()?.students;
      if (cloudStudents) {
        localStorage.setItem(studentStorageKey, JSON.stringify(cloudStudents));
        setStudents(cloudStudents);
      }
    });

    const photoDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    const unsubPhoto = onSnapshot(photoDoc, (snapshot) => {
      const data = snapshot.data() || {};
      const nextPhotos = data.photos || {};
      const nextAdjustments = data.adjustments || {};
      setPhotos(nextPhotos);
      setAdjustments(nextAdjustments);
      Object.entries(nextPhotos).forEach(([id, url]) => localStorage.setItem(`student_photo_${id}`, url));
      Object.entries(nextAdjustments).forEach(([id, adjust]) => localStorage.setItem(`student_photo_adjust_${id}`, JSON.stringify(adjust)));
    });

    const photoPdfDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_photo_pdf_files`);
    const unsubPhotoPdf = onSnapshot(photoPdfDoc, (snapshot) => {
      const cloudFiles = snapshot.exists() ? snapshot.data()?.files || [] : [];
      const localFiles = JSON.parse(localStorage.getItem(photoPdfStorageKey) || "[]");
      const mergedFiles = mergePhotoPdfFiles(localFiles, cloudFiles);
      setSavedPdfFiles(mergedFiles);
      localStorage.setItem(photoPdfStorageKey, JSON.stringify(mergedFiles));
    });

    return () => {
      unsubRoster();
      unsubPhoto();
      unsubPhotoPdf();
    };
  }, [year, semester, studentStorageKey, photoPdfStorageKey]);

  const classStats = classes.map((cls) => {
    const list = students[cls] || [];
    const saved = list.filter((student) => photos[student.id] || localStorage.getItem(`student_photo_${student.id}`)).length;
    return { cls, total: list.length, saved };
  });

  const selectedClassFile = savedPdfFiles.find((file) => file.className === selectedClass);

  const formatFileSize = (size = 0) => {
    if (!size) return "";
    if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  };

  const mergePhotoPdfFiles = (localFiles = [], cloudFiles = []) => {
    const map = new Map();
    [...cloudFiles, ...localFiles].forEach((file) => {
      if (!file?.className || !file?.url) return;
      map.set(file.className, file);
    });
    return classes.map((cls) => map.get(cls)).filter(Boolean);
  };

  const loadArchivedPdfFile = async (file) => {
    if (!file?.url) {
      setMessage(`${selectedClass} 보관 PDF가 없습니다. 먼저 PDF를 불러와 주세요.`);
      return;
    }
    try {
      setMessage(`${file.className} 보관 PDF를 여는 중입니다...`);
      const pdfjsLib = await loadPdfJs();
      let loaded;
      if (file.url.startsWith("data:")) {
        const response = await fetch(file.url);
        const arrayBuffer = await response.arrayBuffer();
        loaded = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      } else if (file.path) {
        // Firebase Storage URL 직접 fetch 대신 SDK bytes 사용: 태블릿/모바일 CORS 오류 방지
        const bytes = await getBytes(ref(storage, file.path), 30 * 1024 * 1024);
        loaded = await pdfjsLib.getDocument({ data: bytes }).promise;
      } else {
        loaded = await pdfjsLib.getDocument({ url: file.url }).promise;
      }
      if (file.className && file.className !== selectedClass) {
        setSelectedClass(file.className);
        setSelectedStudentId((students[file.className] || [])[0]?.id || "");
      }
      setPdfDoc(loaded);
      setPdfName(file.name || `${file.className}_사진명렬표.pdf`);
      setPageNo(1);
      setPageCount(loaded.numPages);
      setSelection(defaultSelection);
      setPreviewUrl("");
      setMessage(`${file.className} 보관 PDF를 열었습니다. 학생을 선택하고 사진 영역을 드래그하세요.`);
    } catch (error) {
      console.error(error);
      setMessage(`${file.className || selectedClass} 보관 PDF를 앱에서 열지 못했습니다. 파일을 다시 불러오면 다시 보관됩니다.`);
    }
  };

  const savePdfFileList = async (nextFiles) => {
    const cleanFiles = nextFiles.map((file) => ({
      id: file.id,
      name: file.name,
      className: file.className,
      url: file.url,
      path: file.path,
      size: file.size || 0,
      storage: file.storage || (file.url?.startsWith("data:") ? "local" : "firebase"),
      uploadedAt: file.uploadedAt || new Date().toISOString(),
    }));
    setSavedPdfFiles(cleanFiles);
    try {
      localStorage.setItem(photoPdfStorageKey, JSON.stringify(cleanFiles));
    } catch (error) {
      console.warn("사진 PDF 로컬 보관 용량 초과", error);
      setMessage("PDF 용량이 커서 브라우저 보관에 실패했습니다. 더 작은 PDF로 다시 시도해 주세요.");
    }
    const user = auth.currentUser;
    const cloudFiles = cleanFiles.filter((file) => file.storage !== "local" && file.url && !file.url.startsWith("data:"));
    if (user && cloudFiles.length === cleanFiles.length) {
      const pdfDocRef = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_photo_pdf_files`);
      await setDoc(pdfDocRef, { files: cloudFiles, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
    }
  };

  const uploadPhotoPdfArchive = async (file) => {
    const safeName = file.name.replace(/[\\/#?%*:|"<>]/g, "_");
    let nextFile = null;
    const user = auth.currentUser;

    // 1순위: Firebase Storage 보관
    if (user) {
      try {
        const storagePath = `peonUsers/${user.uid}/photoPdfFiles/${year}_${semester}/${selectedClass}_${Date.now()}_${safeName}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file, { contentType: file.type || "application/pdf" });
        const url = await getDownloadURL(fileRef);
        nextFile = {
          id: `${selectedClass}_${Date.now()}`,
          className: selectedClass,
          name: file.name,
          url,
          path: storagePath,
          size: file.size || 0,
          storage: "firebase",
          uploadedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.warn("Storage 사진 PDF 보관 실패. 로컬 보관으로 전환합니다.", error);
      }
    }

    // 2순위: 로컬 보관. Firebase 권한/네트워크 문제가 있어도 목록과 보기는 유지됩니다.
    if (!nextFile) {
      const dataUrl = await fileToDataUrl(file);
      nextFile = {
        id: `${selectedClass}_${Date.now()}`,
        className: selectedClass,
        name: file.name,
        url: dataUrl,
        path: "",
        size: file.size || 0,
        storage: "local",
        uploadedAt: new Date().toISOString(),
      };
    }

    const otherFiles = savedPdfFiles.filter((item) => item.className !== selectedClass);
    await savePdfFileList([...otherFiles, nextFile]);
    return nextFile;
  };

  const openPdfFile = (file) => {
    loadArchivedPdfFile(file);
  };

  const downloadPdfFile = (file) => {
    if (!file?.url) return;
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.name || `${selectedClass}_사진명렬표.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const deletePdfFile = async (file) => {
    if (!file || !window.confirm(`${file.className} 사진 PDF 파일을 삭제할까요?\n\n${file.name}`)) return;
    try {
      if (file.path) await deleteObject(ref(storage, file.path));
    } catch (error) {
      console.warn("Storage PDF 삭제 실패, 목록에서는 제거합니다.", error);
    }
    await savePdfFileList(savedPdfFiles.filter((item) => item.id !== file.id && item.path !== file.path));
    if (file.className === selectedClass && pdfName === file.name) {
      setPdfName("");
      setPdfDoc(null);
      setPageNo(1);
      setPageCount(0);
    }
    setMessage(`${file.className} 사진 PDF 파일 목록을 삭제했습니다.`);
  };

  const renderPage = async (targetPdf = pdfDoc, targetPageNo = pageNo, nextZoom = zoom) => {
    if (!targetPdf || !canvasRef.current) return;
    setIsRendering(true);
    try {
      const page = await targetPdf.getPage(targetPageNo);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.min(980, Math.max(320, canvasRef.current.parentElement?.clientWidth || 760));
      const scale = (availableWidth / baseViewport.width) * nextZoom;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      viewportRef.current = { width: viewport.width, height: viewport.height, scale };
      await page.render({ canvasContext: ctx, viewport }).promise;
      const nextSelection = {
        x: Math.min(selection.x, canvas.width - 60),
        y: Math.min(selection.y, canvas.height - 80),
        w: Math.min(selection.w, canvas.width - Math.min(selection.x, canvas.width - 60)),
        h: Math.min(selection.h, canvas.height - Math.min(selection.y, canvas.height - 80)),
      };
      setSelection(nextSelection);
    } catch (error) {
      console.error(error);
      setMessage("PDF 페이지를 표시하는 중 오류가 발생했습니다. 다른 PDF이거나 파일이 손상되었을 수 있습니다.");
    } finally {
      setIsRendering(false);
    }
  };

  useEffect(() => {
    renderPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNo, pdfDoc, zoom]);

  const handlePdfUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("사진등록센터는 PDF 파일만 불러옵니다.");
      event.target.value = "";
      return;
    }

    setMessage("PDF를 불러오는 중입니다...");
    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await fileToArrayBuffer(file);
      const loaded = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(loaded);
      setPdfName(file.name);
      setPageNo(1);
      setPageCount(loaded.numPages);
      setSelection(defaultSelection);
      try {
        await uploadPhotoPdfArchive(file);
        setMessage(`${file.name}을 불러오고 ${selectedClass} 사진등록센터 파일로 보관했습니다. 학생을 선택하고 사진 영역을 드래그하세요.`);
      } catch (archiveError) {
        console.warn(archiveError);
        setMessage(`${file.name}은 불러왔지만 파일 보관에 실패했습니다. 로그인/Storage 권한을 확인해 주세요.`);
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "PDF를 불러오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    return {
      x: clamp((clientX - rect.left) * (canvas.width / rect.width), 0, canvas.width),
      y: clamp((clientY - rect.top) * (canvas.height / rect.height), 0, canvas.height),
    };
  };

  const startSelection = (event) => {
    if (!pdfDoc) return;
    event.preventDefault();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    const point = getCanvasPoint(event);
    setSelecting(point);
    setSelection({ x: point.x, y: point.y, w: 1, h: 1 });
  };

  const moveSelection = (event) => {
    if (!selecting || !pdfDoc) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    const x = Math.min(selecting.x, point.x);
    const y = Math.min(selecting.y, point.y);
    const w = Math.abs(point.x - selecting.x);
    const h = Math.abs(point.y - selecting.y);
    setSelection({ x, y, w, h });
  };

  const endSelection = (event) => {
    if (!selecting) return;
    event?.currentTarget?.releasePointerCapture?.(event.pointerId);
    setSelecting(null);
    if (selection.w < 20 || selection.h < 20) {
      setSelection(defaultSelection);
      setPreviewUrl("");
      return;
    }
    window.setTimeout(makeSelectionPreview, 0);
  };

  const makeSelectionPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDoc || selection.w < 30 || selection.h < 30) {
      setPreviewUrl("");
      return;
    }
    const out = document.createElement("canvas");
    out.width = 210;
    out.height = 280;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, out.width, out.height);
    const targetRatio = out.width / out.height;
    const sourceRatio = selection.w / selection.h;
    let sx = selection.x, sy = selection.y, sw = selection.w, sh = selection.h;
    if (sourceRatio > targetRatio) {
      sw = sh * targetRatio;
      sx = selection.x + (selection.w - sw) / 2;
    } else {
      sh = sw / targetRatio;
      sy = selection.y + (selection.h - sh) / 2;
    }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    setPreviewUrl(out.toDataURL("image/jpeg", 0.9));
  };

  const cropCurrentSelection = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedStudent) throw new Error("학생과 사진 영역을 먼저 선택하세요.");
    if (selection.w < 30 || selection.h < 30) throw new Error("사진 영역을 조금 더 크게 지정해 주세요.");

    const out = document.createElement("canvas");
    out.width = 420;
    out.height = 560;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, out.width, out.height);

    const targetRatio = out.width / out.height;
    const sourceRatio = selection.w / selection.h;
    let sx = selection.x, sy = selection.y, sw = selection.w, sh = selection.h;
    if (sourceRatio > targetRatio) {
      sw = sh * targetRatio;
      sx = selection.x + (selection.w - sw) / 2;
    } else {
      sh = sw / targetRatio;
      sy = selection.y + (selection.h - sh) / 2;
    }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
  };

  const saveForStudent = async () => {
    const user = auth.currentUser;
    if (!selectedStudent) {
      setMessage("저장할 학생을 선택해 주세요.");
      return;
    }
    try {
      setMessage(`${selectedClass} ${selectedStudent.number}번 ${selectedStudent.name} 사진 저장 중...`);
      const blob = await cropCurrentSelection();
      const safeName = `${selectedClass}_${selectedStudent.number}_${selectedStudent.name}.jpg`.replace(/[\\/:*?"<>|]/g, "_");
      let url = "";
      try {
        const storagePath = `peonUsers/${user.uid}/studentPhotos/${year}_${semester}/${selectedStudent.id}_${Date.now()}_${safeName}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
        url = await getDownloadURL(fileRef);
      } catch (storageError) {
        console.warn("Storage 학생사진 저장 실패. 로컬 사진으로 저장합니다.", storageError);
        url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("사진을 로컬에 저장하지 못했습니다."));
          reader.readAsDataURL(blob);
        });
      }
      const resetAdjust = { x: 0, y: 0, scale: 1 };
      const nextPhotos = { ...photos, [selectedStudent.id]: url };
      const nextAdjustments = { ...adjustments, [selectedStudent.id]: resetAdjust };
      setPhotos(nextPhotos);
      setAdjustments(nextAdjustments);
      localStorage.setItem(`student_photo_${selectedStudent.id}`, url);
      localStorage.setItem(`student_photo_adjust_${selectedStudent.id}`, JSON.stringify(resetAdjust));
      if (user) {
        const photoDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
        await setDoc(photoDoc, { photos: nextPhotos, adjustments: nextAdjustments, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
      }
      setMessage(`${selectedClass} ${selectedStudent.number}번 ${selectedStudent.name} 사진을 저장했습니다.`);
      moveToNextStudent();
    } catch (error) {
      console.error(error);
      setMessage(error.message || "사진 저장 중 오류가 발생했습니다.");
    }
  };

  const moveToNextStudent = () => {
    if (!selectedStudent) return;
    const index = currentStudents.findIndex((student) => student.id === selectedStudent.id);
    const next = currentStudents[index + 1];
    if (next) {
      setSelectedStudentId(next.id);
      return;
    }
    const classIndex = classes.indexOf(selectedClass);
    const nextClass = classes[classIndex + 1];
    if (nextClass && (students[nextClass] || []).length) {
      setSelectedClass(nextClass);
      setSelectedStudentId((students[nextClass] || [])[0]?.id || "");
      setMessage(`${selectedClass}을 완료했습니다. ${nextClass}로 이동했습니다.`);
    } else {
      setMessage("현재 학년 사진 등록 순서를 모두 확인했습니다.");
    }
  };

  const deleteSelectedPhoto = async () => {
    if (!selectedStudent || !window.confirm(`${selectedStudent.name} 학생 사진 연결을 삭제할까요?`)) return;
    const user = auth.currentUser;
    const nextPhotos = { ...photos };
    const nextAdjustments = { ...adjustments };
    delete nextPhotos[selectedStudent.id];
    delete nextAdjustments[selectedStudent.id];
    setPhotos(nextPhotos);
    setAdjustments(nextAdjustments);
    localStorage.removeItem(`student_photo_${selectedStudent.id}`);
    localStorage.removeItem(`student_photo_adjust_${selectedStudent.id}`);
    if (user) {
      const photoDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
      await setDoc(photoDoc, { photos: nextPhotos, adjustments: nextAdjustments, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
    }
    setMessage(`${selectedStudent.name} 사진을 삭제했습니다.`);
  };

  const deleteClassPhotos = async () => {
    if (!window.confirm(`${selectedClass} 사진 연결을 모두 삭제할까요?`)) return;
    const user = auth.currentUser;
    const nextPhotos = { ...photos };
    const nextAdjustments = { ...adjustments };
    (students[selectedClass] || []).forEach((student) => {
      delete nextPhotos[student.id];
      delete nextAdjustments[student.id];
      localStorage.removeItem(`student_photo_${student.id}`);
      localStorage.removeItem(`student_photo_adjust_${student.id}`);
    });
    setPhotos(nextPhotos);
    setAdjustments(nextAdjustments);
    if (user) {
      const photoDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
      await setDoc(photoDoc, { photos: nextPhotos, adjustments: nextAdjustments, year, semester, updatedAt: new Date().toISOString() }, { merge: true });
    }
    setMessage(`${selectedClass} 사진을 모두 삭제했습니다.`);
  };

  return (
    <div className="page photo-studio-page">
      <h2>📸 사진등록센터</h2>
      <section className="card photo-studio-card">
        <div className="photo-studio-header">
          <div>
            <h3>PDF에서 직접 자르고 저장하기</h3>
            <p>자동 매칭 대신 선생님이 PDF 위에서 사진 영역을 직접 지정합니다. 저장하면 학생카드에 바로 반영됩니다.</p>
          </div>
          <div className="photo-studio-actions">
            <label className="shared-file-upload-btn">PDF 불러오기<input type="file" accept=".pdf" onChange={handlePdfUpload} /></label>
            <button type="button" className="setting-btn" onClick={() => setZoom((prev) => Math.max(0.6, prev - 0.1))}>축소</button>
            <button type="button" className="setting-btn" onClick={() => setZoom((prev) => Math.min(2, prev + 0.1))}>확대</button>
          </div>
        </div>
        <div className="assessment-save-message">{message}</div>

        <div className="photo-pdf-file-box">
          <div className="photo-pdf-file-main">
            <span>보관된 사진 PDF</span>
            {selectedClassFile ? (
              <div>
                <strong>{selectedClassFile.name}</strong>
                <small>{selectedClassFile.uploadedAt ? `업로드: ${new Date(selectedClassFile.uploadedAt).toLocaleString("ko-KR")}` : "업로드 정보 없음"}{selectedClassFile.size ? ` · ${formatFileSize(selectedClassFile.size)}` : ""}</small>
              </div>
            ) : (
              <div><strong>{selectedClass} 사진 PDF 없음</strong><small>PDF 불러오기를 누르면 평가기준 파일처럼 보관됩니다.</small></div>
            )}
          </div>
          <div className="photo-pdf-file-actions">
            <button type="button" className="save-btn" onClick={() => openPdfFile(selectedClassFile)} disabled={!selectedClassFile}>저장 PDF 보기</button>
            <button type="button" className="setting-btn" onClick={() => downloadPdfFile(selectedClassFile)} disabled={!selectedClassFile}>다운로드</button>
            <button type="button" className="delete-btn" onClick={() => deletePdfFile(selectedClassFile)} disabled={!selectedClassFile}>삭제</button>
          </div>
        </div>

        <div className="photo-studio-class-select-row peon-sticky-toolbar">
          <label>
            <span>반 선택</span>
            <select value={selectedClass} onChange={(event) => {
              const nextClass = event.target.value;
              setSelectedClass(nextClass);
              setSelectedStudentId((students[nextClass] || [])[0]?.id || "");
            }}>
              {classStats.map((stat) => (
                <option key={stat.cls} value={stat.cls}>{stat.cls} · {stat.saved}/{stat.total}명 저장 · {savedPdfFiles.find((file) => file.className === stat.cls) ? "PDF 열림" : "PDF 없음"}</option>
              ))}
            </select>
          </label>
          <div className="photo-studio-class-mini-status">
            <strong>{selectedClass}</strong>
            <span>{classStats.find((stat) => stat.cls === selectedClass)?.saved || 0}/{classStats.find((stat) => stat.cls === selectedClass)?.total || 0}명 저장</span>
            <em>{selectedClassFile ? "PDF 보관됨" : "PDF 없음"}</em>
          </div>
        </div>

        <div className={`photo-studio-layout photo-studio-final-layout ${collapsed[selectedClass] ? "photo-list-collapsed" : ""}`}>
          <aside className="photo-studio-final-tools">
            <button type="button" className="setting-btn small">PDF 도구</button>
            <label className="save-btn">PDF불러오기<input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: "none" }} /></label>
            <button type="button" className="setting-btn" onClick={() => openPdfFile(selectedClassFile)} disabled={!selectedClassFile}>PDF열기</button>
            <button type="button" className="setting-btn" disabled={!pdfDoc || pageNo <= 1} onClick={() => setPageNo((prev) => Math.max(1, prev - 1))}>이전</button>
            <button type="button" className="setting-btn" disabled={!pdfDoc || pageNo >= pageCount} onClick={() => setPageNo((prev) => Math.min(pageCount, prev + 1))}>다음</button>
            <button type="button" className="setting-btn" onClick={() => setZoom((prev) => Math.min(2, prev + 0.1))}>확대</button>
            <button type="button" className="setting-btn" onClick={() => setZoom((prev) => Math.max(0.6, prev - 0.1))}>축소</button>
            <button type="button" className="setting-btn" onClick={() => setZoom(1)}>기본크기</button>
            <button type="button" className="delete-btn" onClick={() => deletePdfFile(selectedClassFile)} disabled={!selectedClassFile}>PDF삭제</button>
          </aside>

          <aside className="photo-studio-sidebar photo-studio-final-students photo-studio-fixed-student-panel">
            <div className="photo-studio-sidebar-title">
              <strong>{selectedClass} 학생목록</strong>
              <button type="button" className="setting-btn small" onClick={() => setCollapsed((prev) => ({ ...prev, [selectedClass]: !prev[selectedClass] }))}>{collapsed[selectedClass] ? "펼치기" : "접기"}</button>
            </div>
            {!collapsed[selectedClass] && (
              <div className="photo-student-list">
                {currentStudents.map((student) => {
                  const saved = Boolean(photos[student.id] || localStorage.getItem(`student_photo_${student.id}`));
                  return <button key={student.id} type="button" className={`${selectedStudent?.id === student.id ? "active" : ""} ${saved ? "saved" : ""}`} onClick={() => setSelectedStudentId(student.id)}>
                    <span>{saved ? "✅" : "○"}</span><b>{student.number}번</b><strong>{student.name}</strong>
                  </button>;
                })}
              </div>
            )}
          </aside>

          <section className="photo-pdf-workspace photo-studio-final-center photo-studio-pdf-only-center">
            <div className="photo-pdf-toolbar photo-pdf-toolbar-compact">
              <span>{pdfName || "PDF 없음"}</span>
              <b>{pageNo} / {pageCount || 0}</b>
            </div>

            <div className="photo-canvas-wrap">
              {!pdfDoc && <div className="photo-empty-pdf">PDF를 불러오면 이곳에 사진명렬표가 표시됩니다.</div>}
              {isRendering && <div className="photo-rendering">PDF 표시 중...</div>}
              <div className="photo-canvas-stage" onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={endSelection}>
                <canvas ref={canvasRef} />
                {pdfDoc && <div className="photo-crop-rect" style={{ left: `${selection.x / viewportRef.current.width * 100}%`, top: `${selection.y / viewportRef.current.height * 100}%`, width: `${selection.w / viewportRef.current.width * 100}%`, height: `${selection.h / viewportRef.current.height * 100}%` }} />}
              </div>
            </div>

            <div className="photo-save-bar">
              <button type="button" className="setting-btn" onClick={() => setSelection(defaultSelection)}>선택 초기화</button>
              <button type="button" className="setting-btn" onClick={moveToNextStudent} disabled={!selectedStudent}>다음 학생</button>
              <button type="button" className="primary-action-btn" onClick={saveForStudent} disabled={!pdfDoc || !selectedStudent}>현재 학생 사진 저장</button>
            </div>
            <p className="photo-studio-tip">사진 영역을 마우스로 드래그해 사각형을 만든 뒤 저장하세요. 저장 후 자동으로 다음 학생으로 이동합니다.</p>
          </section>

          <aside className="photo-studio-preview-panel photo-studio-final-preview photo-exchange-panel">
            <h3>사진 등록 · 교체</h3>
            <div className="photo-selected-student-line">
              <span>선택 학생</span>
              <b>{selectedStudent ? `${selectedStudent.number}번 ${selectedStudent.name}` : "학생 없음"}</b>
            </div>

            <div className="photo-preview-box current-photo-box">
              <span>현재 사진</span>
              {selectedStudent && (photos[selectedStudent.id] || localStorage.getItem(`student_photo_${selectedStudent.id}`))
                ? <img src={photos[selectedStudent.id] || localStorage.getItem(`student_photo_${selectedStudent.id}`)} alt="현재 학생카드 사진" />
                : <div className="photo-preview-empty">현재 등록된 사진이 없습니다.</div>}
            </div>

            <div className="photo-preview-box new-photo-box">
              <span>새 사진</span>
              {previewUrl ? <img src={previewUrl} alt="새 사진 미리보기" /> : <div className="photo-preview-empty">PDF에서 사진 영역을 드래그하세요.</div>}
            </div>

            <button type="button" className="primary-action-btn full photo-save-new-btn" onClick={saveForStudent} disabled={!pdfDoc || !selectedStudent}>💾 새 사진으로 저장하기</button>
            <button type="button" className="setting-btn full photo-reset-btn" onClick={() => { setSelection(defaultSelection); setPreviewUrl(""); }}>선택 초기화</button>
            <button type="button" className="delete-btn full photo-delete-current-btn" onClick={deleteSelectedPhoto} disabled={!selectedStudent}>현재 사진 삭제</button>
          </aside>
        </div>
      </section>
    </div>
  );
}
