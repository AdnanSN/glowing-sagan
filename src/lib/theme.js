import { useState } from 'react'

// The theme lives on <html data-theme>, and the inline script in
// index.html sets it from storage before the first paint — that is
// what stops a dark page flashing white on load. The DOM is the source
// of truth, so every Layout mount (one per route) reads it fresh.
const STORAGE_KEY = 'nhn-theme'

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)

  // Only an explicit choice is stored, so someone who never touches the
  // toggle keeps whatever the default is, not a snapshot of it.
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    // Snap rather than fade: every surface carries its own --transition,
    // so a fade passes through half-themed states. Reading a computed
    // style forces the new colours in while transitions are off.
    root.classList.add('theme-switching')
    root.dataset.theme = next
    window.getComputedStyle(document.body).backgroundColor
    setTimeout(() => root.classList.remove('theme-switching'), 0)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage blocked (private window): the switch still holds for this visit.
    }
    setTheme(next)
  }

  return { theme, toggleTheme }
}
