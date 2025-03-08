// const path = require('path');
// const HtmlWebpackPlugin = require('html-webpack-plugin');
// const Dotenv = require('dotenv-webpack');
// const dotenv = require('dotenv');

// dotenv.config();

// module.exports = {
//   // Entry point for Webpack to bundle
//   entry: './src/index.js',

//   // Output the bundled file
//   output: {
//     path: path.resolve(__dirname, 'dist'),
//     filename: 'bundle.js',
//     clean: true, // Clean the output folder on every build
//   },

//   // Module rules for loaders
//   module: {
//     rules: [
//       {
//         test: /\.css$/, // Process CSS files
//         use: ['style-loader', 'css-loader'],
//       },
//       {
//         test: /\.(png|jpg|jpeg|gif|svg)$/i, // Process image files
//         type: 'asset/resource',
//       },
//       {
//         test: /\.html$/, // Process HTML files
//         use: ['html-loader'],
//       },
//     ],
//   },

//   // Plugins for additional processing
//   plugins: [
//     new HtmlWebpackPlugin({
//       template: './public/index.html', // Path to your main HTML template
//       filename: 'index.html',
//     }),
//     new Dotenv(), // Load environment variables
//   ],

//   // Development mode
//   mode: 'development',

//   // Dev server configuration
//   devServer: {
//     static: {
//       directory: path.join(__dirname, 'dist'),
//     },
//     port: 3000,
//     open: true,
//     hot: true,
//   },
// };
