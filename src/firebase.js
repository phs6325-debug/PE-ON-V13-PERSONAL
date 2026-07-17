import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAvoiBfalcKWcScr-htNNFKKo9rn6iCAH8",
  authDomain: "pe-on-e6c7c.firebaseapp.com",
  projectId: "pe-on-e6c7c",
  storageBucket: "pe-on-e6c7c.firebasestorage.app",
  messagingSenderId: "424122751750",
  appId: "1:424122751750:web:889a3e9c0729da1ef19c87",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
