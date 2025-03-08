import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

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

// Handle signup form submission
document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const userName = document.getElementById("username").value;
    const firstName = document.getElementById("firstname").value;
    const lastName = document.getElementById("lastname").value;

    try {
        // Create the user with email and password
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        console.log("User created:", user.uid);

        // Add the user's profile to Firestore
        const userDocRef = doc(db, "users", user.uid); // Use UID as the document ID
        await setDoc(userDocRef, {
            firstName: firstName,
            lastName: lastName,
            userName: userName,
            email: email,
            createdAt: new Date()
        });

        alert("Signup successful!");
        window.location.href = "login.html"; // Redirect to login page
    } catch (error) {
        console.error("Error signing up:", error.message);
        alert("Error signing up: " + error.message);
    }
});
