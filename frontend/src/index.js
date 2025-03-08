// Import CSS
import './css/index.css';

// Example: Import an image
import featurePlay from './img/feature_play.gif';

// Example: Use the image in JavaScript
const imgElement = document.createElement('img');
imgElement.src = featurePlay;
document.body.appendChild(imgElement);

console.log('Webpack is running successfully!');
