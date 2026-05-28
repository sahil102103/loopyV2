// firebase-compat.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, query, where, doc, onSnapshot, deleteDoc, updateDoc, orderBy, serverTimestamp, startAfter, limit } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

// Firebase configuration — sourced from config.js (loaded as a regular script before this module)
const firebaseConfig = window.CONFIG.FIREBASE;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Track current user globally
window.currentUserId = null;
window.isAdmin = false;
window.isResearcher = false;

onAuthStateChanged(auth, async function(user) {
    window.currentUserId = user ? user.uid : null;
    window.isAdmin = false;
    window.isResearcher = false;

    if (user) {
        // Check admin status
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        window.isAdmin = adminSnap.exists();

        // Check researcher status
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) {
            window.isResearcher = userSnap.data().researcher === true;
        }

        if (window.isAdmin || window.isResearcher) {
            if (typeof window.unlockResearcherFeatures === 'function') {
                window.unlockResearcherFeatures();
            }
        }

        if (window.isAdmin) {
            if (typeof window.showAdminTab === 'function') {
                window.showAdminTab();
            }
        }
    }
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
    serverTimestamp,
    startAfter,
    limit
};

console.log("Firebase has been initialized and exposed globally via window.firebase.");
window.dispatchEvent(new CustomEvent('firebase-ready'));
