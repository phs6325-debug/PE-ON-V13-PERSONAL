import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

const manwolConfig = {
  apiKey: "AIzaSyDOBr1aw6F9QRFBZ_PhaQLvLx3yVHJnu_o",
  authDomain: "manwol-pe.firebaseapp.com",
  databaseURL: "https://manwol-pe-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "manwol-pe",
  storageBucket: "manwol-pe.firebasestorage.app",
  messagingSenderId: "667313325803",
  appId: "1:667313325803:web:ee8ae53bc1e31b4e2520ae",
};

const app = getApps().some((item) => item.name === "manwol-pe")
  ? getApp("manwol-pe")
  : initializeApp(manwolConfig, "manwol-pe");

export const manwolDb = getDatabase(app);
export const manwolAuth = getAuth(app);

export const ensureManwolLogin = async () => {
  try {
    if (manwolAuth.currentUser) return manwolAuth.currentUser;
    const result = await signInAnonymously(manwolAuth);
    return result.user;
  } catch (error) {
    console.warn("manwol-pe anonymous login failed", error);
    throw error;
  }
};
