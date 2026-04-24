import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

console.log('Main.jsx (root): Mounting app...');
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Main.jsx (root): Root element not found!');
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  console.log('Main.jsx (root): Render called.');
}
