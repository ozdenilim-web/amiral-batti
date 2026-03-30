import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA-bIXTZWr_kLAQl6lXCkj2mSBbA_jEXGo",
  authDomain: "amiral-batti-eef5b.firebaseapp.com",
  databaseURL: "https://amiral-batti-eef5b-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "amiral-batti-eef5b",
  storageBucket: "amiral-batti-eef5b.firebasestorage.app",
  messagingSenderId: "785495369630",
  appId: "1:785495369630:web:62dcd9429444b285eb988f"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { db, auth, googleProvider, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, query, orderByChild, limitToLast, signInAnonymously, onAuthStateChanged, signInWithPopup, signOut };
