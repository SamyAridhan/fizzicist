import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

console.log('Main.jsx: Mounting app...');
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Main.jsx: Root element not found!');
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  console.log('Main.jsx: Render called.');
}