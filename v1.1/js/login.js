document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();

    // Get the input values
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Validate email domain
    if (email.endsWith('@northeastern.edu') && password === 'loopyRocks') {
        // Store login status in localStorage or sessionStorage
        localStorage.setItem('loggedIn', 'true');
        // Redirect to the main page
        window.location.href = 'index.html'; // Redirect to main content
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
});

// Check login status on page load
window.onload = function() {
    if (localStorage.getItem('loggedIn') === 'true') {
        window.location.href = 'index.html'; // Redirect if already logged in
    }
};
