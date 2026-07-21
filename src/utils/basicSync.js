import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export const BASIC_SYNC_KEYS = [
  "peon_year",
  "peon_semester",
  "peon_grade",
  "peon_default_context",
  "peon_saved_context",
  "peon_progress_timetable",
];

const PENDING_KEY = "peon_basic_sync_pending";
const PENDING_AT_KEY = "peon_basic_sync_pending_at";
const PENDING_OFFLINE_KEY = "peon_basic_sync_pending_offline";
const LAST_SYNC_KEY = "peon_basic_sync_last_at";
let suppressTracking = false;
let patched = false;

const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;

export const isBasicSyncKey = (key) => BASIC_SYNC_KEYS.includes(String(key));

export const hasPendingBasicSync = () => localStorage.getItem(PENDING_KEY) === "1";
export const getPendingBasicSyncAt = () => localStorage.getItem(PENDING_AT_KEY) || "";
export const hasOfflinePendingBasicSync = () => localStorage.getItem(PENDING_OFFLINE_KEY) === "1";
export const getLastBasicSyncAt = () => localStorage.getItem(LAST_SYNC_KEY) || "";

export const markBasicSyncPending = () => {
  nativeSetItem.call(localStorage, PENDING_KEY, "1");
  nativeSetItem.call(localStorage, PENDING_AT_KEY, new Date().toISOString());
  if (!navigator.onLine) nativeSetItem.call(localStorage, PENDING_OFFLINE_KEY, "1");
  window.dispatchEvent(new CustomEvent("peon-basic-sync-state"));
};

export const clearBasicSyncPending = () => {
  nativeRemoveItem.call(localStorage, PENDING_KEY);
  nativeRemoveItem.call(localStorage, PENDING_AT_KEY);
  nativeRemoveItem.call(localStorage, PENDING_OFFLINE_KEY);
  nativeSetItem.call(localStorage, LAST_SYNC_KEY, new Date().toISOString());
  window.dispatchEvent(new CustomEvent("peon-basic-sync-state"));
};

export const installBasicSyncTracking = () => {
  if (patched) return;
  patched = true;

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && !suppressTracking && isBasicSyncKey(key)) {
      markBasicSyncPending();
      window.dispatchEvent(new CustomEvent("peon-basic-setting-changed", { detail: { key: String(key) } }));
    }
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    nativeRemoveItem.call(this, key);
    if (this === localStorage && !suppressTracking && isBasicSyncKey(key)) {
      markBasicSyncPending();
      window.dispatchEvent(new CustomEvent("peon-basic-setting-changed", { detail: { key: String(key) } }));
    }
  };
};

const getSyncDoc = (uid) => doc(db, "peonUsers", uid, "settings", "basicSync");

export const collectBasicSettings = () => {
  const data = {};
  BASIC_SYNC_KEYS.forEach((key) => {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  });
  return data;
};

export const applyBasicSettings = (data = {}) => {
  suppressTracking = true;
  try {
    BASIC_SYNC_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        nativeSetItem.call(localStorage, key, String(data[key]));
      }
    });
  } finally {
    suppressTracking = false;
  }
  window.dispatchEvent(new CustomEvent("peon-basic-sync-applied", { detail: { keys: Object.keys(data) } }));
};

export const uploadBasicSettings = async (user) => {
  if (!user?.uid) throw new Error("로그인 정보가 없습니다.");
  if (!navigator.onLine) throw new Error("오프라인 상태입니다.");
  const data = collectBasicSettings();
  await setDoc(getSyncDoc(user.uid), {
    data,
    ownerEmail: user.email || "",
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  clearBasicSyncPending();
  return data;
};

export const downloadBasicSettings = async (user) => {
  if (!user?.uid || !navigator.onLine) return null;
  const snapshot = await getDoc(getSyncDoc(user.uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data()?.data || null;
  if (!data || typeof data !== "object") return null;
  applyBasicSettings(data);
  nativeSetItem.call(localStorage, LAST_SYNC_KEY, new Date().toISOString());
  return data;
};

export const initializeBasicSync = async (user) => {
  if (!user?.uid || !navigator.onLine) return { status: "offline" };
  if (hasPendingBasicSync()) return { status: hasOfflinePendingBasicSync() ? "pending-offline" : "pending-online" };
  const remote = await downloadBasicSettings(user);
  if (remote) return { status: "downloaded", data: remote };
  await uploadBasicSettings(user);
  return { status: "uploaded" };
};
