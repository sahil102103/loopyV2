import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

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

// Handle login form submission
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); // Prevent the form from submitting the default way

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
        // Authenticate with Firebase
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (user) {
            console.log("Authenticated user:", user.uid);

            // Fetch the user document from Firestore
            const userDocRef = doc(db, "users", user.uid); // Reference the user's document
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                console.log("User data found in Firestore:", userDoc.data());

                // Set the 'loggedIn' cookie
                setCookie("loggedIn", "true", 7);

                // Redirect to the main page
                console.log("Redirecting to index.html...");
                window.location.href = "index.html";
            } else {
                // No document exists for the authenticated user
                console.error("No user document found in Firestore.");
                displayError("No user profile found. Please contact support.");
            }
        } else {
            console.error("User is not authenticated");
            displayError("Authentication failed. Please try again.");
        }
    } catch (error) {
        console.error("Login error:", error.message);

        // Display appropriate error messages
        if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
            displayError("Invalid email or password. Please try again.");
        } else {
            displayError("An unexpected error occurred. Please try again later.");
        }
    }
});

// Function to set a cookie
function setCookie(name, value, daysToExpire) {
    const date = new Date();
    date.setTime(date.getTime() + daysToExpire * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${expires}; path=/; Secure; SameSite=Strict`;
}

// Function to display error messages
function displayError(message) {
    const errorElement = document.getElementById("loginError");
    errorElement.textContent = message;
    errorElement.style.display = "block";
}
