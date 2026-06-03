import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyC4eoX3_eSC7xh9T-xG5NBq3VsTS5xzZu8",
  authDomain: "versaosaude-prod.firebaseapp.com",
  projectId: "versaosaude-prod",
  storageBucket: "versaosaude-prod.appspot.com",
  messagingSenderId: "678026752216",
  appId: "1:678026752216:web:b9315425bdc405844e67ad",
  measurementId: "G-NBCLMJVLCC",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");
export const storage = getStorage(app);
