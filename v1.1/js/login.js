document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();

    // Get the input values
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Validate email domain
    if (email.endsWith('@northeastern.edu') && password === 'loopyRocks') {
        // Set the 'loggedIn' cookie to 'true' with a 7-day expiration
        setCookie('loggedIn', 'true', 7);
        // Redirect to the main page
        window.location.href = 'index.html'; // Redirect to main content
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
});

// Function to set a cookie
function setCookie(name, value, daysToExpire) {
    const date = new Date();
    date.setTime(date.getTime() + daysToExpire * 24 * 60 * 60 * 1000);
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${expires}; path=/`;
}
