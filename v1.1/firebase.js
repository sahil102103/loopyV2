// firebase-compat.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, where, doc, onSnapshot, deleteDoc, updateDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAMo1LOHvEl5ediXHkgdAgCaxSaPh9Tv7s",
    authDomain: "loopy-5fee3.firebaseapp.com",
    projectId: "loopy-5fee3",
    storageBucket: "loopy-5fee3.firebasestorage.app",
    messagingSenderId: "816351082835",
    appId: "1:816351082835:web:94f9df73f5ed7375a6c9a6",
    measurementId: "G-KGJ631M1F4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Track current user globally
window.currentUserId = null;
onAuthStateChanged(auth, function(user) {
    window.currentUserId = user ? user.uid : null;
});

// Expose Firebase functionality globally
window.firebase = {
    app,
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    collection,
    addDoc,
    getDocs,
    getDoc,
    query,
    where,
    doc,
    onSnapshot,
    deleteDoc,
    updateDoc,
    orderBy,
    serverTimestamp
};

console.log("Firebase has been initialized and exposed globally via window.firebase.");
