import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { getBytes, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import { deleteStoredFile, getStoredFile, saveStoredFile } from "../utils/fileStore";

const classes = ["2-1", "2-2", "2-3", "2-4", "2-5"];
const DEFAULT_SELECTION = { x: 80, y: 80, w: 150, h: 200 };

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
  script.onerror = () => reject(new Error("PDF 처리 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."));
  document.body.appendChild(script);
});

const dataUrlToFile = async (dataUrl, fileName) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/jpeg" });
};

const makeSafeFileName = (value) => String(value || "student").replace(/[\\/:*?"<>|\s]+/g, "_");

const normalizeClassToken = (value = "") => String(value)
  .toLowerCase()
  .replace(/\s+/g, "")
  .replace(/[._]/g, "-")
  .replace(/[^0-9가-힣a-z-]/g, "");

const putPhotoPdfBlob = (key, blob) => saveStoredFile(key, blob, { type: "application/pdf", name: `${key}.pdf` });

const getPhotoPdfBlob = async (key) => {
  const record = await getStoredFile(key);
  return record?.blob || null;
};

const deletePhotoPdfBlob = (key) => deleteStoredFile(key);

const getSharedLocalFile = (key) => getStoredFile(key);

export default function PhotoStudio({ embedded = false, focusMode = false }) {
  const year = localStorage.getItem("peon_year") || "2026학년도";
  const semester = localStorage.getItem("peon_semester") || "1학기";
  const studentStorageKey = `peon_${year}_${semester}_students`;

  const canvasRef = useRef(null);
  const finalCenterRef = useRef(null);
  const pdfFileInputRef = useRef(null);
  const pdfDocsRef = useRef({});
  const renderTaskRef = useRef(null);
  const dragRef = useRef(null);
  const studentButtonRefs = useRef({});

  const [cls, setCls] = useState("2-1");
  const [students, setStudents] = useState(() => JSON.parse(localStorage.getItem(studentStorageKey) || "{}"));
  const [photoMap, setPhotoMap] = useState({});
  const pdfArchiveKey = `peon_${year}_${semester}_photo_pdf_archive`;
  const sharedPhotoFilesKey = `peon_${year}_${semester}_photo_shared_files_shared_files`;
  const [sharedPhotoFiles, setSharedPhotoFiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(sharedPhotoFilesKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [pdfStates, setPdfStates] = useState({});
  const [pdfArchive, setPdfArchive] = useState(() => {
    try { return JSON.parse(localStorage.getItem(pdfArchiveKey) || "{}"); } catch { return {}; }
  });
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pdfScale, setPdfScale] = useState(2.6);
  const [message, setMessage] = useState("반을 선택하고 PDF를 불러온 뒤, 학생 이름을 클릭하고 사진 영역을 드래그해 미리보기로 확인한 뒤 저장하세요.");
  const [selectedId, setSelectedId] = useState("");
  const [selection, setSelection] = useState(null);
  const [preview, setPreview] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isStudentListOpen, setIsStudentListOpen] = useState(true);
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const [pdfToolsOpen, setPdfToolsOpen] = useState(true);


  useEffect(() => {
    const updateStudentFixedMetrics = () => {
      const center = finalCenterRef.current;
      if (!center || typeof window === "undefined") return;

      const isTablet = window.matchMedia("(min-width: 768px) and (max-width: 1180px)").matches;
      if (!isTablet) {
        document.documentElement.style.removeProperty("--peon-photo-student-left");
        document.documentElement.style.removeProperty("--peon-photo-student-width");
        document.documentElement.style.removeProperty("--peon-photo-student-top");
        return;
      }

      const rect = center.getBoundingClientRect();
      const safeLeft = Math.max(8, rect.left);
      const safeWidth = Math.max(320, Math.min(rect.width, window.innerWidth - safeLeft - 292));
      document.documentElement.style.setProperty("--peon-photo-student-left", `${safeLeft}px`);
      document.documentElement.style.setProperty("--peon-photo-student-width", `${safeWidth}px`);
      document.documentElement.style.setProperty("--peon-photo-student-top", "112px");
    };

    updateStudentFixedMetrics();
    window.addEventListener("resize", updateStudentFixedMetrics);
    window.addEventListener("orientationchange", updateStudentFixedMetrics);
    window.addEventListener("scroll", updateStudentFixedMetrics, { passive: true });

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateStudentFixedMetrics) : null;
    if (observer && finalCenterRef.current) observer.observe(finalCenterRef.current);

    return () => {
      window.removeEventListener("resize", updateStudentFixedMetrics);
      window.removeEventListener("orientationchange", updateStudentFixedMetrics);
      window.removeEventListener("scroll", updateStudentFixedMetrics);
      observer?.disconnect();
    };
  }, [isStudentListOpen, cls, pdfToolsOpen]);

  const getPdfState = (className = cls) => pdfStates[className] || { name: "", page: 1, pages: 0, scale: 2.6 };
  const activePdfState = getPdfState(cls);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return undefined;

    const studentsDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_students`);
    const unsubscribeStudents = onSnapshot(studentsDoc, (snapshot) => {
      const cloudStudents = snapshot.data()?.students;
      if (cloudStudents) {
        localStorage.setItem(studentStorageKey, JSON.stringify(cloudStudents));
        setStudents(cloudStudents);
      }
    });

    const photosDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
    const unsubscribePhotos = onSnapshot(photosDoc, (snapshot) => {
      const data = snapshot.data() || {};
      const photos = data.photos || {};
      // 클라우드 문서가 비어 있거나 일부 학생만 있어도 이 브라우저에 남아 있는 사진을 지우지 않습니다.
      setPhotoMap((previous) => ({ ...previous, ...photos }));
      Object.entries(photos).forEach(([studentId, url]) => {
        if (url) localStorage.setItem(`student_photo_${studentId}`, url);
      });
    });

    return () => {
      unsubscribeStudents();
      unsubscribePhotos();
    };
  }, [year, semester, studentStorageKey]);

  const currentStudents = useMemo(() => {
    return [...(students[cls] || [])].sort((a, b) => Number(a.number) - Number(b.number));
  }, [students, cls]);

  const selectedStudent = useMemo(() => {
    return currentStudents.find((student) => student.id === selectedId) || currentStudents[0] || null;
  }, [currentStudents, selectedId]);

  useEffect(() => {
    if (!selectedId && currentStudents[0]) setSelectedId(currentStudents[0].id);
    if (selectedId && !currentStudents.some((student) => student.id === selectedId)) {
      setSelectedId(currentStudents[0]?.id || "");
    }
  }, [currentStudents, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    window.requestAnimationFrame(() => {
      studentButtonRefs.current[selectedId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [selectedId]);


  useEffect(() => {
    const meta = pdfArchive[cls];
    if (meta?.dbKey && !pdfDocsRef.current[cls]) {
      loadArchivedPdf(cls, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cls, pdfArchiveKey]);

  const savedCount = currentStudents.filter((student) => photoMap[student.id] || localStorage.getItem(`student_photo_${student.id}`)).length;
  const totalCount = currentStudents.length;

  useEffect(() => {
    const loadSharedPhotoFiles = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(sharedPhotoFilesKey) || "[]");
        setSharedPhotoFiles(Array.isArray(saved) ? saved : []);
      } catch {
        setSharedPhotoFiles([]);
      }
    };
    loadSharedPhotoFiles();
    const handleStorage = (event) => {
      if (!event.key || event.key === sharedPhotoFilesKey) loadSharedPhotoFiles();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("peon-shared-photo-files-updated", loadSharedPhotoFiles);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("peon-shared-photo-files-updated", loadSharedPhotoFiles);
    };
  }, [sharedPhotoFilesKey]);

  const getSharedPhotoFileForClass = (className = cls) => {
    const token = normalizeClassToken(className);
    const exact = sharedPhotoFiles.find((file) => {
      const name = normalizeClassToken(file?.name || "");
      return name.includes(token) || name.includes(token.replace("-", ""));
    });
    if (exact) return exact;
    if (sharedPhotoFiles.length === 1) return sharedPhotoFiles[0];
    return null;
  };

  const selectedSharedPhotoFile = getSharedPhotoFileForClass(cls);

  const savePdfArchiveMeta = (className, meta) => {
    const next = { ...pdfArchive, [className]: meta };
    setPdfArchive(next);
    localStorage.setItem(pdfArchiveKey, JSON.stringify(next));
  };

  const getArchiveMeta = (className = cls) => {
    try {
      const latest = JSON.parse(localStorage.getItem(pdfArchiveKey) || "{}");
      return latest[className] || pdfArchive[className] || null;
    } catch {
      return pdfArchive[className] || null;
    }
  };

  const removePdfArchiveMeta = async (className) => {
    const meta = pdfArchive[className];
    const next = { ...pdfArchive };
    delete next[className];
    setPdfArchive(next);
    localStorage.setItem(pdfArchiveKey, JSON.stringify(next));
    if (meta?.dbKey) {
      try { await deletePhotoPdfBlob(meta.dbKey); } catch (error) { console.warn(error); }
    }
  };

  const loadArchivedPdf = async (className = cls, silent = false) => {
    const meta = getArchiveMeta(className);
    const dbKey = meta?.dbKey || `${year}_${semester}_${className}_photo_pdf`;
    if (!dbKey) {
      if (!silent) setMessage(`${className}에 보관된 사진 PDF가 없습니다. PDF 불러오기로 먼저 저장하세요.`);
      return false;
    }
    setIsBusy(true);
    try {
      let blob = await getPhotoPdfBlob(dbKey);
      if (!blob && meta?.dbKey && meta.dbKey !== dbKey) blob = await getPhotoPdfBlob(meta.dbKey);
      if (!blob) throw new Error("보관된 PDF 원본을 찾지 못했습니다. 한 번만 다시 PDF 불러오기를 해 주세요.");
      const pdfjs = await loadPdfJs();
      const buffer = await blob.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      pdfDocsRef.current[className] = pdf;
      const nextState = {
        name: meta.name || `${className}_학생사진.pdf`,
        page: Math.min(meta.page || 1, pdf.numPages || 1),
        pages: pdf.numPages || meta.pages || 1,
        scale: meta.scale || 2.6,
        savedAt: meta?.savedAt || new Date().toISOString(),
        dbKey,
      };
      setPdfStates((prev) => ({ ...prev, [className]: nextState }));
      if (className === cls) {
        setPageNumber(nextState.page);
        setPageCount(nextState.pages);
        setPdfScale(nextState.scale);
        await renderPage(className, nextState.page, nextState.scale);
      }
      if (!silent) setMessage(`${className} 보관 PDF를 다시 열었습니다. 이전처럼 학생 사진을 자르고 저장할 수 있습니다.`);
      return true;
    } catch (error) {
      console.error(error);
      if (!silent) setMessage(`${className} 보관 PDF를 열지 못했습니다. 다시 PDF를 불러와 주세요.`);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const renderPage = async (className = cls, nextPageNumber = pageNumber, nextScale = pdfScale) => {
    const pdfDoc = pdfDocsRef.current[className];
    const canvas = canvasRef.current;
    if (!pdfDoc || !canvas) return;
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* noop */ }
    }
    const safePage = Math.max(1, Math.min(pdfDoc.numPages || 1, nextPageNumber));
    const page = await pdfDoc.getPage(safePage);
    const viewport = page.getViewport({ scale: nextScale });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const task = page.render({ canvasContext: context, viewport });
    renderTaskRef.current = task;
    await task.promise.catch((error) => {
      if (error?.name !== "RenderingCancelledException") throw error;
    });
    renderTaskRef.current = null;
    setSelection(null);
    setPreview("");
    setPageNumber(safePage);
    setPageCount(pdfDoc.numPages || 1);
    setPdfScale(nextScale);
    setPdfStates((prev) => ({
      ...prev,
      [className]: { ...(prev[className] || {}), page: safePage, pages: pdfDoc.numPages || 1, scale: nextScale },
    }));
    setMessage(`${className} PDF ${safePage}쪽을 표시했습니다. 학생 이름을 선택한 뒤 사진 영역을 드래그하세요.`);
  };

  const switchClass = async (className) => {
    setCls(className);
    setSelectedId("");
    setSelection(null);
    setPreview("");
    const state = getPdfState(className);
    setPageNumber(state.page || 1);
    setPageCount(state.pages || 0);
    setPdfScale(state.scale || 2.6);
    if (pdfDocsRef.current[className]) {
      setIsBusy(true);
      try {
        await renderPage(className, state.page || 1, state.scale || 2.6);
      } finally {
        setIsBusy(false);
      }
    } else {
      const opened = await loadArchivedPdf(className, true);
      if (!opened) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        setMessage(`${className} PDF가 아직 없습니다. 이 반 사진명렬표 PDF를 불러오세요. 다른 반 PDF와 저장 사진은 유지됩니다.`);
      }
    }
  };

  const openManagedPhotoPdf = async (className = cls) => {
    const fileMeta = getSharedPhotoFileForClass(className);
    if (!fileMeta) {
      setMessage(`${className} 관리탭 사진 PDF가 없습니다. 관리탭 ④ 사진 PDF 파일에 먼저 업로드해 주세요.`);
      return false;
    }
    setIsBusy(true);
    setMessage(`${className} 관리탭 사진 PDF를 불러오는 중입니다.`);
    try {
      const pdfjs = await loadPdfJs();
      let blob = null;
      let buffer = null;

      if (fileMeta.localId) {
        const local = await getSharedLocalFile(fileMeta.localId);
        if (local?.blob) {
          blob = local.blob;
          buffer = await local.blob.arrayBuffer();
        }
      }

      if (!buffer && fileMeta.path) {
        // Firebase Storage URL을 직접 fetch하면 CORS/모바일 브라우저 정책으로 실패할 수 있어 SDK로 원본 bytes를 받습니다.
        const bytes = await getBytes(ref(storage, fileMeta.path), 30 * 1024 * 1024);
        buffer = bytes;
        blob = new Blob([bytes], { type: fileMeta.type || "application/pdf" });
      }

      if (!buffer && fileMeta.url) {
        try {
          const response = await fetch(fileMeta.url);
          if (!response.ok) throw new Error("관리탭에 보관된 PDF를 가져오지 못했습니다.");
          blob = await response.blob();
          buffer = await blob.arrayBuffer();
        } catch (fetchError) {
          console.warn("사진 PDF URL fetch 실패", fetchError);
          throw new Error("관리탭 PDF 주소를 직접 열지 못했습니다. 같은 기기에서 업로드한 원본 또는 Firebase Storage 경로로 다시 불러오세요.");
        }
      }

      if (!buffer) throw new Error("관리탭에 보관된 PDF 원본이 없습니다. 같은 기기에서 다시 업로드하거나 다운로드 후 다시 올려 주세요.");

      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      pdfDocsRef.current[className] = pdf;
      const dbKey = `${year}_${semester}_${className}_photo_pdf`;
      if (blob) {
        try { await putPhotoPdfBlob(dbKey, blob); } catch (archiveError) { console.warn("사진 PDF IndexedDB 보관 실패", archiveError); }
      }
      const state = {
        name: fileMeta.name || `${className}_사진명렬표.pdf`,
        page: 1,
        pages: pdf.numPages || 1,
        scale: pdfScale || 2.6,
        dbKey,
        savedAt: new Date().toISOString(),
        size: fileMeta.size || blob?.size || 0,
        source: "management",
      };
      setPdfStates((prev) => ({ ...prev, [className]: state }));
      savePdfArchiveMeta(className, state);
      if (className !== cls) setCls(className);
      setPageNumber(1);
      setPageCount(pdf.numPages || 1);
      await renderPage(className, 1, state.scale);
      setMessage(`${className} 관리탭 사진 PDF를 열었습니다. 학생을 선택하고 사진 영역을 자른 뒤 저장하세요.`);
      return true;
    } catch (error) {
      console.error(error);
      setMessage(error?.message || `${className} 관리탭 사진 PDF를 열지 못했습니다. 관리탭에서 PDF를 다시 업로드해 주세요.`);
      return false;
    } finally {
      setIsBusy(false);
    }
  };


  const handlePdfOpenClick = () => {
    if (isBusy) return;
    // 브라우저 보안 정책상 파일 선택창은 사용자 클릭 직후 바로 열어야 합니다.
    // 기존 PDF가 있거나 관리탭 PDF가 있어도, 이 버튼은 항상 내 PC의 PDF 선택창을 엽니다.
    pdfFileInputRef.current?.click();
  };

  const handleStoredPdfOpenClick = async () => {
    if (isBusy) return;
    const existing = pdfDocsRef.current[cls];
    if (existing) {
      await renderPage(cls, pageNumber || 1, pdfScale || 2.6);
      setMessage(`${cls} 저장 PDF 작업 화면을 다시 표시했습니다.`);
      return;
    }

    // 저장PDF열기는 우선 사진등록센터에서 직접 저장한 PDF를 먼저 엽니다.
    // 그다음 관리 탭 ④ 사진 파일을 보조 경로로 확인합니다.
    const openedArchive = await loadArchivedPdf(cls, false);
    if (openedArchive) return;

    if (selectedSharedPhotoFile) {
      const openedManaged = await openManagedPhotoPdf(cls);
      if (openedManaged) return;
    }

    setMessage(`${cls} 저장 PDF가 없습니다. PDF 불러오기에서 이 반 사진명렬표 PDF를 한 번 선택해 주세요.`);
  };

  const handlePdfFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("PDF 파일만 불러올 수 있습니다.");
      return;
    }
    setIsBusy(true);
    setMessage(`${cls} PDF를 불러오는 중입니다.`);
    try {
      const pdfjs = await loadPdfJs();
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      pdfDocsRef.current[cls] = pdf;
      const dbKey = `${year}_${semester}_${cls}_photo_pdf`;
      let archived = false;
      try {
        await putPhotoPdfBlob(dbKey, file);
        archived = true;
      } catch (archiveError) {
        console.warn("사진 PDF IndexedDB 보관 실패", archiveError);
      }
      const state = { name: file.name, page: 1, pages: pdf.numPages || 1, scale: pdfScale || 2.6, dbKey, savedAt: new Date().toISOString(), size: file.size || 0 };
      setPdfStates((prev) => ({ ...prev, [cls]: state }));
      if (archived) savePdfArchiveMeta(cls, state);
      setPageNumber(1);
      setPageCount(pdf.numPages || 1);
      await renderPage(cls, 1, state.scale);
      setMessage(archived
        ? `${cls} · ${file.name}을 불러오고 저장PDF열기로 다시 열 수 있게 보관했습니다.`
        : `${cls} · ${file.name}을 불러왔습니다. 단, 브라우저 보관 공간 문제로 저장PDF열기에는 보관되지 않았습니다.`);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "PDF를 불러오지 못했습니다.");
    } finally {
      setIsBusy(false);
    }
  };

  const rerenderWithScale = async (nextScale) => {
    if (!pdfDocsRef.current[cls]) return;
    setIsBusy(true);
    try {
      await renderPage(cls, pageNumber, nextScale);
      setMessage(`PDF 표시 크기를 ${Math.round(nextScale * 100)}%로 조정했습니다. PDF 영역은 스크롤해서 움직일 수 있습니다.`);
    } finally {
      setIsBusy(false);
    }
  };

  const changeZoom = (delta) => {
    const nextScale = Math.max(1.2, Math.min(5.2, Number((pdfScale + delta).toFixed(2))));
    if (nextScale !== pdfScale) rerenderWithScale(nextScale);
  };

  const setPage = async (next) => {
    if (!pdfDocsRef.current[cls]) return;
    const safePage = Math.max(1, Math.min(pageCount, next));
    setIsBusy(true);
    try {
      await renderPage(cls, safePage, pdfScale);
    } finally {
      setIsBusy(false);
    }
  };

  const getCanvasPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
    };
  };

  const startSelect = (event) => {
    if (!pdfDocsRef.current[cls] || isBusy) return;
    event.preventDefault?.();
    const point = getCanvasPoint(event);
    dragRef.current = { startX: point.x, startY: point.y };
    setSelection({ x: point.x, y: point.y, w: 1, h: 1 });
    setPreview("");
  };

  const moveSelect = (event) => {
    if (!dragRef.current) return;
    event.preventDefault?.();
    const point = getCanvasPoint(event);
    const x = Math.min(dragRef.current.startX, point.x);
    const y = Math.min(dragRef.current.startY, point.y);
    const w = Math.abs(point.x - dragRef.current.startX);
    const h = Math.abs(point.y - dragRef.current.startY);
    setSelection({ x, y, w, h });
  };

  const endSelect = (event) => {
    if (!dragRef.current) return;
    event?.preventDefault?.();
    dragRef.current = null;
    setSelection((prev) => {
      if (!prev || prev.w < 8 || prev.h < 8) {
        setMessage("사진 영역이 너무 작습니다. 얼굴과 어깨가 들어가도록 다시 드래그하세요.");
        return null;
      }
      setMessage("선택 완료. 오른쪽 미리보기와 학생 이름이 맞는지 확인한 뒤 저장하세요.");
      return prev;
    });
  };

  const cropCurrentSelection = () => {
    const source = canvasRef.current;
    if (!source || !selection) return "";
    const rect = source.getBoundingClientRect();
    const ratioX = source.width / rect.width;
    const ratioY = source.height / rect.height;
    const sx = Math.max(0, Math.floor(selection.x * ratioX));
    const sy = Math.max(0, Math.floor(selection.y * ratioY));
    const sw = Math.max(1, Math.floor(selection.w * ratioX));
    const sh = Math.max(1, Math.floor(selection.h * ratioY));

    const targetRatio = 3 / 4;
    let cropW = sw;
    let cropH = sh;
    let cropX = sx;
    let cropY = sy;
    const currentRatio = cropW / cropH;
    if (currentRatio > targetRatio) {
      const nextW = Math.floor(cropH * targetRatio);
      cropX += Math.floor((cropW - nextW) / 2);
      cropW = nextW;
    } else if (currentRatio < targetRatio) {
      const nextH = Math.floor(cropW / targetRatio);
      cropY += Math.floor((cropH - nextH) / 2);
      cropH = nextH;
    }

    cropX = Math.max(0, Math.min(source.width - cropW, cropX));
    cropY = Math.max(0, Math.min(source.height - cropH, cropY));

    const output = document.createElement("canvas");
    output.width = 480;
    output.height = 640;
    const context = output.getContext("2d");
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, output.width, output.height);
    return output.toDataURL("image/jpeg", 0.9);
  };

  useEffect(() => {
    if (!selection) {
      setPreview("");
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        setPreview(cropCurrentSelection());
      } catch (error) {
        console.error(error);
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selection]);

  const saveCroppedPhoto = async () => {
    if (!selectedStudent) {
      setMessage("학생 명단이 없습니다. 먼저 명렬표를 등록해 주세요.");
      return;
    }
    if (!selection) {
      setMessage("먼저 PDF에서 사진 영역을 드래그해 선택하세요.");
      return;
    }
    const dataUrl = cropCurrentSelection();
    if (!dataUrl) return;
    const user = auth.currentUser;
    setIsBusy(true);
    try {
      const safeName = makeSafeFileName(`${selectedStudent.className}_${selectedStudent.number}_${selectedStudent.name}`);
      const file = await dataUrlToFile(dataUrl, `${safeName}.jpg`);
      let downloadUrl = dataUrl;
      if (user) {
        try {
          const storagePath = `peonUsers/${user.uid}/studentPhotos/${year}_${semester}/${selectedStudent.id}_${Date.now()}_${file.name}`;
          const fileRef = ref(storage, storagePath);
          await uploadBytes(fileRef, file);
          downloadUrl = await getDownloadURL(fileRef);
        } catch (storageError) {
          console.warn("Storage 학생사진 저장 실패. 로컬 사진으로 저장합니다.", storageError);
          downloadUrl = dataUrl;
        }
      }
      const adjust = { x: 0, y: 0, scale: 1 };
      localStorage.setItem(`student_photo_${selectedStudent.id}`, downloadUrl);
      localStorage.setItem(`student_photo_adjust_${selectedStudent.id}`, JSON.stringify(adjust));
      if (user) {
        const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
        // 중첩 map을 한 학생 값만으로 저장해 다른 학생 사진이 사라지는 일을 막습니다.
        const currentSnapshot = await getDoc(dataDoc);
        const currentData = currentSnapshot.data() || {};
        await setDoc(dataDoc, {
          ...currentData,
          photos: { ...(currentData.photos || {}), [selectedStudent.id]: downloadUrl },
          adjustments: { ...(currentData.adjustments || {}), [selectedStudent.id]: adjust },
          year,
          semester,
          updatedAt: new Date().toISOString(),
        });
      }
      setPhotoMap((prev) => ({ ...prev, [selectedStudent.id]: downloadUrl }));
      window.dispatchEvent(new CustomEvent("peon-student-photo-updated", {
        detail: { studentId: selectedStudent.id, url: downloadUrl, adjust },
      }));
      const currentIndex = currentStudents.findIndex((student) => student.id === selectedStudent.id);
      const nextStudent = currentStudents[currentIndex + 1];
      if (nextStudent) {
        setSelectedId(nextStudent.id);
        setMessage(`${selectedStudent.number}번 ${selectedStudent.name} 저장 완료. 다음 학생 ${nextStudent.number}번 ${nextStudent.name}으로 이동했습니다. PDF와 선택한 반 상태는 유지됩니다.`);
      } else {
        setMessage(`${cls} 사진 등록이 끝났습니다. 다른 반 탭을 눌러 이어서 작업하세요. 완료한 반 사진은 유지됩니다.`);
      }
      setSelection(null);
      setPreview("");
    } catch (error) {
      console.error(error);
      setMessage("사진 저장 중 오류가 났습니다. Firebase Storage 권한 또는 인터넷 연결을 확인해 주세요.");
    } finally {
      setIsBusy(false);
    }
  };

  const deleteSelectedPhoto = async () => {
    if (!selectedStudent) return;
    if (!window.confirm(`${selectedStudent.number}번 ${selectedStudent.name} 학생 사진 연결을 삭제할까요?`)) return;
    const user = auth.currentUser;
    const nextPhotos = { ...photoMap };
    delete nextPhotos[selectedStudent.id];
    localStorage.removeItem(`student_photo_${selectedStudent.id}`);
    localStorage.removeItem(`student_photo_adjust_${selectedStudent.id}`);
    if (user) {
      const dataDoc = doc(db, "peonUsers", user.uid, "records", `${year}_${semester}_student_photos`);
      await setDoc(dataDoc, { photos: nextPhotos, updatedAt: new Date().toISOString(), year, semester }, { merge: true });
    }
    setPhotoMap(nextPhotos);
    setMessage("선택 학생 사진을 삭제했습니다.");
  };

  const clearClassPdf = () => {
    if (!window.confirm(`${cls} PDF 작업 화면만 비울까요? 저장된 학생 사진은 삭제되지 않습니다.`)) return;
    delete pdfDocsRef.current[cls];
    setPdfStates((prev) => {
      const next = { ...prev };
      delete next[cls];
      return next;
    });
    setSelection(null);
    setPreview("");
    setPageNumber(1);
    setPageCount(0);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMessage(`${cls} PDF 작업 화면을 비웠습니다. 저장된 학생카드 사진은 유지됩니다.`);
  };

  const clearSelection = () => {
    setSelection(null);
    setPreview("");
  };

  const makeSelectionFromDefault = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.min(170, rect.width * 0.22);
    const h = Math.min(226, rect.height * 0.28);
    setSelection({
      x: Math.max(0, Math.min(rect.width - w, rect.width * 0.12)),
      y: Math.max(0, Math.min(rect.height - h, rect.height * 0.12)),
      w,
      h,
    });
  };

  return (
    <div className={`page photo-studio-page ${focusMode ? "photo-studio-focus-inner" : ""}`}>
      <div className="photo-studio-title">
        <div>
          <h2>📸 사진등록센터</h2>
          <p>PDF를 직접 보면서 학생 이름을 선택하고, 사진 영역을 자른 뒤 옆 미리보기에서 확인 후 저장합니다.</p>
        </div>
        <span className="peon-version-badge">PE-ON v9.0 Photo Studio</span>
      </div>

      <section className="card photo-studio-v2-toolbar">
        <div className="photo-studio-v2-class-row">
          <label>
            <span>반 선택</span>
            <select value={cls} onChange={(e) => switchClass(e.target.value)}>
              {classes.map((className) => (
                <option key={className} value={className}>{className}</option>
              ))}
            </select>
          </label>
          <div className="photo-studio-v2-status">
            {savedCount}/{totalCount}명 · {pdfDocsRef.current[cls] ? `${pageNumber}/${pageCount}쪽` : pdfArchive[cls] ? "PDF 저장됨" : selectedSharedPhotoFile ? "PDF 대기" : "PDF 없음"}
          </div>
          <button
            type="button"
            className="save-btn photo-studio-v3-open-pdf"
            onClick={handlePdfOpenClick}
            disabled={isBusy}
            title="내 PC에서 사진명렬표 PDF를 선택합니다."
          >
            PDF 불러오기
          </button>
          <button
            type="button"
            className="setting-btn"
            onClick={handleStoredPdfOpenClick}
            disabled={isBusy || (!pdfDocsRef.current[cls] && !selectedSharedPhotoFile && !getArchiveMeta(cls))}
            title="이미 저장된 사진명렬표 PDF를 다시 엽니다."
          >
            저장PDF열기
          </button>
          <input
            ref={pdfFileInputRef}
            className="photo-studio-v3-hidden-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handlePdfFile}
            disabled={isBusy}
          />
          <button type="button" className="setting-btn" onClick={() => setPage(pageNumber - 1)} disabled={!pdfDocsRef.current[cls] || pageNumber <= 1 || isBusy}>이전</button>
          <button type="button" className="setting-btn" onClick={() => setPage(pageNumber + 1)} disabled={!pdfDocsRef.current[cls] || pageNumber >= pageCount || isBusy}>다음</button>
          <button type="button" className="setting-btn" onClick={() => changeZoom(0.25)} disabled={!pdfDocsRef.current[cls] || isBusy}>확대</button>
          <button type="button" className="setting-btn" onClick={() => changeZoom(-0.25)} disabled={!pdfDocsRef.current[cls] || isBusy}>축소</button>
          <button type="button" className="setting-btn" onClick={() => rerenderWithScale(2.6)} disabled={!pdfDocsRef.current[cls] || isBusy}>기본</button>
          <button type="button" className="setting-btn" onClick={clearClassPdf} disabled={!pdfDocsRef.current[cls]}>화면비우기</button>
        </div>
      </section>

      <div className="photo-studio-v2-layout">
        <aside className={`card photo-studio-v2-students ${!isStudentListOpen ? "collapsed" : ""}`}>
          <button type="button" className="photo-studio-v2-fold" onClick={() => setIsStudentListOpen((prev) => !prev)}>
            {isStudentListOpen ? `학생명단 · ${savedCount}/${totalCount}명 접기` : "학생명단 펼치기"}
          </button>
          {isStudentListOpen && (
            <div className="photo-studio-v2-student-list">
              {currentStudents.map((student) => {
                const saved = Boolean(photoMap[student.id] || localStorage.getItem(`student_photo_${student.id}`));
                return (
                  <button
                    type="button"
                    key={student.id}
                    ref={(node) => { if (node) studentButtonRefs.current[student.id] = node; }}
                    className={`${selectedStudent?.id === student.id ? "active" : ""} ${saved ? "saved" : ""}`}
                    onClick={() => setSelectedId(student.id)}
                    title="이 학생에게 사진을 저장합니다."
                  >
                    <span>{saved ? "✅" : "□"}</span>
                    <strong>{student.number}번</strong>
                    <b>{student.name}</b>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="card photo-studio-v2-pdf" ref={finalCenterRef}>
          <div className="photo-studio-v2-pdf-head">
            <strong>PDF 미리보기</strong>
            <span>{pdfDocsRef.current[cls] ? `${pageNumber} / ${pageCount}` : "PDF를 불러오세요"}</span>
          </div>
          <div className="photo-studio-v2-pdf-body">
            <div
              className="photo-studio-canvas-wrap photo-studio-v2-canvas-wrap"
              onPointerDown={startSelect}
              onPointerMove={moveSelect}
              onPointerUp={endSelect}
              onPointerCancel={endSelect}
            >
              <canvas ref={canvasRef} />
              {!pdfDocsRef.current[cls] && <div className="photo-studio-empty">{cls} 사진명렬표 PDF를 불러오면 이곳에 크게 표시됩니다.</div>}
              {selection && (
                <div
                  className="photo-studio-selection"
                  style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
                >
                  <span />
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="card photo-studio-v2-preview">
          <h3>사진 등록 · 교체</h3>
          <div className="photo-studio-v2-selected">
            <span>선택 학생</span>
            <strong>{selectedStudent ? `${cls} ${selectedStudent.number}번 ${selectedStudent.name}` : "학생을 선택하세요"}</strong>
          </div>
          <div className="photo-studio-v2-small-actions">
            <button type="button" className="setting-btn" onClick={makeSelectionFromDefault} disabled={!pdfDocsRef.current[cls]}>선택틀</button>
            <button type="button" className="setting-btn" onClick={clearSelection} disabled={!selection}>선택취소</button>
          </div>
          <div className="photo-studio-v2-photo-pair">
            <div className="photo-studio-v2-photo-box-wrap">
              <div className="photo-studio-preview-label">현재사진</div>
              <div className="photo-studio-preview-box photo-studio-v2-photo-box">
                {selectedStudent && (photoMap[selectedStudent.id] || localStorage.getItem(`student_photo_${selectedStudent.id}`))
                  ? <img src={photoMap[selectedStudent.id] || localStorage.getItem(`student_photo_${selectedStudent.id}`)} alt="현재 학생카드 사진" />
                  : <span>기존 사진 없음</span>}
              </div>
            </div>
            <div className="photo-studio-v2-photo-box-wrap">
              <div className="photo-studio-preview-label">새사진</div>
              <div className="photo-studio-preview-box photo-studio-v2-photo-box">
                {preview ? <img src={preview} alt="미리보기" /> : <span>PDF에서 사진 영역을 드래그하세요</span>}
              </div>
            </div>
          </div>
          <button type="button" className="google-login-btn photo-studio-v2-save" onClick={saveCroppedPhoto} disabled={!selection || !selectedStudent || isBusy}>💾 새 사진으로 저장하기</button>
        </aside>
      </div>
    </div>
  );
}
