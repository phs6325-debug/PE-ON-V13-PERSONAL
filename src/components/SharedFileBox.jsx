import { useEffect, useMemo, useState } from "react";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, storage } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import * as XLSX from "xlsx";

const allowedExtensions = [".pdf", ".hwp", ".hwpx", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv"];

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const safeDocId = (value) =>
  String(value || "file")
    .replace(/[^\w가-힣-]/g, "_")
    .slice(0, 120);

const formatSize = (size = 0) => {
  if (!size) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

const getExtension = (fileName = "") => {
  const lower = String(fileName).toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex >= 0 ? lower.slice(dotIndex + 1) : "";
};

const canInlinePreview = (file) => {
  const extension = getExtension(file?.name);
  return ["pdf", "png", "jpg", "jpeg", "xlsx", "xls", "csv"].includes(extension);
};

const canSpreadsheetPreview = (file) => {
  const extension = getExtension(file?.name);
  return ["xlsx", "xls", "csv"].includes(extension);
};

const DB_NAME = "peon_file_archive_v2";
const DB_STORE = "files";

const openFileDb = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error("IndexedDB를 사용할 수 없습니다."));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("파일 보관함을 열지 못했습니다."));
});

const putLocalFile = async (id, file) => {
  const db = await openFileDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put({ id, blob: file, name: file.name, type: file.type || "", savedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("파일 보관 실패"));
  });
  db.close();
};

const getLocalFile = async (id) => {
  if (!id) return null;
  try {
    const db = await openFileDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
};

const removeLocalFile = async (id) => {
  if (!id) return;
  try {
    const db = await openFileDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 로컬 보관 삭제 실패는 앱 사용을 막지 않습니다.
  }
};

const resolveFileUrl = async (file) => {
  // 같은 기기에서 업로드한 원본은 IndexedDB에 있으므로 먼저 로컬 원본을 사용합니다.
  // Firebase Storage URL을 먼저 열면 일부 태블릿/모바일 브라우저에서 PDF fetch가 막힐 수 있습니다.
  const local = await getLocalFile(file?.localId);
  if (local?.blob) return URL.createObjectURL(local.blob);
  if (file?.url) return file.url;
  return "";
};


export default function SharedFileBox({
  title,
  description,
  category,
  year,
  semester,
  localKey,
  accept = ".pdf,.hwp,.hwpx,.png,.jpg,.jpeg,.xlsx,.xls,.csv",
  multiple = true,
  onLocalFilesSelected,
}) {
  const docId = useMemo(
    () => safeDocId(`${year}_${semester}_${category}`),
    [year, semester, category]
  );

  const localListKey = `${localKey || docId}_shared_files`;
  const [files, setFiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(localListKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const [previewRows, setPreviewRows] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [currentUser, setCurrentUser] = useState(auth.currentUser);

  const showMessage = (text) => {
    setMessage(text);
    window.clearTimeout(window.__peonSharedFileTimer);
    window.__peonSharedFileTimer = window.setTimeout(() => setMessage(""), 2200);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const user = currentUser;
    if (!user) {
      showMessage("로그인 후 파일 동기화가 가능합니다.");
      return undefined;
    }

    const fileDoc = doc(db, "peonUsers", user.uid, "records", `files_${docId}`);

    const unsubscribe = onSnapshot(
      fileDoc,
      (snapshot) => {
        const nextFiles = snapshot.exists() ? snapshot.data()?.files || [] : [];
        if (Array.isArray(nextFiles)) {
          setFiles(nextFiles);
          localStorage.setItem(localListKey, JSON.stringify(nextFiles));
        }
      },
      (error) => {
        console.error(error);
        showMessage("파일 목록 동기화 오류: Firestore 규칙/로그인을 확인하세요.");
      }
    );

    return () => unsubscribe();
  }, [currentUser, docId, localListKey]);

  const saveFiles = async (nextFiles) => {
    const cleanFiles = Array.isArray(nextFiles) ? nextFiles : [];
    setFiles(cleanFiles);
    localStorage.setItem(localListKey, JSON.stringify(cleanFiles));
    if (category === "photo") window.dispatchEvent(new CustomEvent("peon-shared-photo-files-updated"));

    const user = currentUser || auth.currentUser;
    if (!user) {
      showMessage("로그인 후 파일을 동기화할 수 있습니다.");
      return;
    }

    const fileDoc = doc(db, "peonUsers", user.uid, "records", `files_${docId}`);
    await setDoc(fileDoc, {
      files: cleanFiles,
      category,
      year,
      semester,
      ownerEmail: user.email || "",
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    try {
      if (typeof onLocalFilesSelected === "function") {
        await onLocalFilesSelected(selectedFiles);
      }

      showMessage("파일을 보관하는 중입니다.");
      const user = currentUser || auth.currentUser;
      const uploadedFiles = [];

      for (const file of selectedFiles) {
        const lowerName = file.name.toLowerCase();
        const allowed = allowedExtensions.some((extension) => lowerName.endsWith(extension));
        if (!allowed) {
          showMessage("PDF, HWP, HWPX, 이미지, 엑셀 파일만 올릴 수 있습니다.");
          continue;
        }

        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const localId = `${docId}_${id}`;
        await putLocalFile(localId, file);

        const baseMeta = {
          id,
          localId,
          name: file.name,
          type: file.type || "",
          size: file.size || 0,
          memo: "",
          uploadedAt: new Date().toISOString(),
        };

        if (!user) {
          uploadedFiles.push({ ...baseMeta, localOnly: true, storageStatus: "local" });
          continue;
        }

        try {
          const safeName = file.name.replace(/[\\/#?%*:|"<>]/g, "_");
          const filePath = `peonUsers/${user.uid}/sharedFiles/${category}/${year}_${semester}/${Date.now()}_${safeName}`;
          const fileRef = ref(storage, filePath);
          await uploadBytes(fileRef, file);
          const url = await getDownloadURL(fileRef);
          uploadedFiles.push({ ...baseMeta, url, path: filePath, storageStatus: "cloud" });
        } catch (uploadError) {
          console.error(uploadError);
          uploadedFiles.push({ ...baseMeta, localOnly: true, storageStatus: "local" });
        }
      }

      if (uploadedFiles.length > 0) {
        await saveFiles([...files, ...uploadedFiles]);
        const localCount = uploadedFiles.filter((file) => file.localOnly).length;
        showMessage(localCount ? `파일 ${uploadedFiles.length}개를 보관했습니다. ${localCount}개는 이 기기 로컬에 보관되었습니다.` : `파일 ${uploadedFiles.length}개를 업로드했습니다.`);
      }
    } catch (error) {
      console.error(error);
      showMessage("파일 보관 실패: 다시 시도하거나 파일 크기를 확인하세요.");
    }

    event.target.value = "";
  };

  const openFile = async (file) => {
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewRows(null);

    try {
      const previewUrl = await resolveFileUrl(file);
      if (!previewUrl) {
        setPreviewFile(null);
        setPreviewError("이 기기에 파일 원본이 없거나 파일 주소가 없습니다. 다시 업로드하세요.");
        showMessage("미리보기 원본을 찾지 못했습니다.");
        return;
      }

      setPreviewFile({ ...file, previewUrl });

      if (canSpreadsheetPreview(file)) {
        try {
          const response = await fetch(previewUrl);
          if (!response.ok && previewUrl.startsWith("http")) {
            throw new Error(`파일 응답 오류: ${response.status}`);
          }
          const buffer = await response.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }).slice(0, 80);
          setPreviewRows(rows);
          showMessage("엑셀 미리보기를 불러왔습니다.");
        } catch (error) {
          console.error(error);
          setPreviewError("엑셀 미리보기를 불러오지 못했습니다. 다운로드 또는 새 창으로 확인하세요.");
          showMessage("엑셀 미리보기를 불러오지 못했습니다.");
        }
      }
    } catch (error) {
      console.error(error);
      setPreviewFile(null);
      setPreviewError("미리보기를 불러오는 중 오류가 발생했습니다.");
      showMessage("미리보기 불러오기에 실패했습니다.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const openNewWindow = async (file) => {
    const url = await resolveFileUrl(file);
    if (!url) {
      showMessage("이 기기에 파일 원본이 없거나 파일 주소가 없습니다.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const downloadFile = async (file) => {
    const url = await resolveFileUrl(file);
    if (!url) {
      showMessage("다운로드할 파일 원본이 없습니다.");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || `PEON_${getTodayKey()}`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteFile = async (file) => {
    if (!file) return;
    const ok = window.confirm(`파일을 삭제할까요?\n\n${file.name}`);
    if (!ok) return;

    try {
      if (file.path) {
        await deleteObject(ref(storage, file.path));
      }
      await removeLocalFile(file.localId);

      await saveFiles(files.filter((item) => item.id !== file.id && item.path !== file.path));
      if (previewFile?.id === file.id || previewFile?.path === file.path) setPreviewFile(null);
      showMessage("파일을 삭제했습니다.");
    } catch (error) {
      console.error(error);
      await removeLocalFile(file.localId);
      await saveFiles(files.filter((item) => item.id !== file.id && item.path !== file.path));
      showMessage("목록에서는 삭제했습니다. Storage 권한을 확인하세요.");
    }
  };

  const previewExtension = getExtension(previewFile?.name);

  return (
    <section className="card shared-file-card">
      <div className="shared-file-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

        <label className="shared-file-upload-btn">
          파일 업로드
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleUpload}
          />
        </label>
      </div>

      <div className={`shared-sync-status ${currentUser ? "connected" : "disconnected"}`}>
        {currentUser ? `☁️ 파일 동기화 연결됨 · ${currentUser.email || "로그인됨"}` : "⚠️ 로그인 후 파일 동기화 가능"}
      </div>

      {message && <div className="assessment-save-message">{message}</div>}

      {files.length > 0 ? (
        <div className="shared-file-list">
          {files.map((file) => (
            <div className="shared-file-row" key={file.id || file.path || file.name}>
              <div className="shared-file-info">
                <strong>{file.name}</strong>
                <span>
                  {file.uploadedAt ? `업로드: ${new Date(file.uploadedAt).toLocaleString("ko-KR")}` : "업로드 정보 없음"}
                  {file.size ? ` · ${formatSize(file.size)}` : ""}
                  {file.localOnly ? " · 이 기기 보관" : " · 클라우드 보관"}
                </span>
              </div>

              <div className="shared-file-actions">
                <button type="button" className="save-btn" onClick={() => openFile(file)}>탭에서 보기</button>
                <button type="button" className="setting-btn" onClick={() => downloadFile(file)}>다운로드</button>
                <button type="button" className="delete-btn" onClick={() => deleteFile(file)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="assessment-guide-box compact">
          등록된 파일이 없습니다. PDF/HWP/HWPX/엑셀 파일을 업로드하세요.
        </div>
      )}

      {previewLoading && (
        <div className="assessment-save-message shared-preview-loading">미리보기를 불러오는 중입니다.</div>
      )}

      {previewError && (
        <div className="assessment-guide-box compact shared-preview-error">{previewError}</div>
      )}

      {previewFile && (
        <div className="shared-inline-preview">
          <div className="shared-inline-preview-header">
            <div>
              <strong>{previewFile.name}</strong>
              <span>{canInlinePreview(previewFile) ? "탭 안에서 미리보기 중" : "이 파일은 브라우저 미리보기가 제한될 수 있습니다."}</span>
            </div>
            <div className="shared-inline-preview-actions">
              <button type="button" className="setting-btn" onClick={() => openNewWindow(previewFile)}>새 창</button>
              <button type="button" className="setting-btn" onClick={() => downloadFile(previewFile)}>다운로드</button>
              <button type="button" className="delete-btn" onClick={() => setPreviewFile(null)}>닫기</button>
            </div>
          </div>

          {previewExtension === "pdf" ? (
            <iframe
              className="shared-file-frame"
              src={previewFile.previewUrl || previewFile.url}
              title={previewFile.name}
            />
          ) : ["png", "jpg", "jpeg"].includes(previewExtension) ? (
            <div className="shared-image-preview">
              <img src={previewFile.previewUrl || previewFile.url} alt={previewFile.name} />
            </div>
          ) : canSpreadsheetPreview(previewFile) ? (
            <div className="shared-sheet-preview">
              {previewRows?.length ? (
                <table>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {(row.length ? row : [""]).map((cell, cellIndex) => (
                          rowIndex === 0 ? (
                            <th key={cellIndex}>{cell}</th>
                          ) : (
                            <td key={cellIndex}>{cell}</td>
                          )
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="shared-file-no-preview">
                  <h4>엑셀 미리보기를 불러오는 중입니다.</h4>
                  <p>잠시 후에도 보이지 않으면 다운로드로 확인하세요.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="shared-file-no-preview">
              <h4>HWP/HWPX 파일은 브라우저 안에서 바로 열리지 않을 수 있습니다.</h4>
              <p>파일 확인은 다운로드 또는 새 창 열기를 사용하세요. PDF와 엑셀은 탭 안에서 미리보기 됩니다.</p>
              <div className="shared-file-no-preview-actions">
                <button type="button" className="save-btn" onClick={() => openNewWindow(previewFile)}>새 창으로 열기</button>
                <button type="button" className="setting-btn" onClick={() => downloadFile(previewFile)}>다운로드</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
