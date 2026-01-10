import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  arrayUnion,
  Timestamp,
  writeBatch,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL, // ✅ Removed redundant `storage` declaration
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-storage.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
  authDomain: "banknkonde.firebaseapp.com",
  projectId: "banknkonde",
  storageBucket: "banknkonde.appspot.com",
  messagingSenderId: "698749180404",
  appId: "1:698749180404:web:7e8483cae4abd7555101a1",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);  // ✅ This is the only `storage` definition

// Export Firebase services and commonly used functions
export {
  app,
  db,
  auth,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  storage, // ✅ Now correctly exporting the storage instance
  arrayUnion,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  ref,
  uploadBytes,
  getDownloadURL,
  Timestamp,
  writeBatch,
  arrayRemove,
};
