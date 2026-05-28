window.CONFIG = {
    // Backend API URL — auto-detects dev vs production
    API_URL: (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
        ? 'http://127.0.0.1:5000'
        : 'https://loopy-v2.vercel.app', // TODO: replace with your production backend URL if different

    FIREBASE: {
        apiKey: "AIzaSyAMo1LOHvEl5ediXHkgdAgCaxSaPh9Tv7s",
        authDomain: "loopy-5fee3.firebaseapp.com",
        projectId: "loopy-5fee3",
        storageBucket: "loopy-5fee3.firebasestorage.app",
        messagingSenderId: "816351082835",
        appId: "1:816351082835:web:94f9df73f5ed7375a6c9a6",
        measurementId: "G-KGJ631M1F4"
    }
};
