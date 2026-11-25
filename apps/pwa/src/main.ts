import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).pathname
    void navigator.serviceWorker.register(swUrl).catch(() => undefined)
  })
}

createApp(App).mount('#app')
