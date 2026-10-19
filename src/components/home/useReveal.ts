import { useCallback, useRef } from 'react'

/**
 * Adds `is-visible` to a `.home-reveal` section the first time it scrolls into
 * view. A callback ref, so a section that mounts late (after its products load)
 * still gets watched.
 */
export function useReveal<T extends HTMLElement>() {
  const observer = useRef<IntersectionObserver | null>(null)
  return useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add('is-visible')
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )
    io.observe(el)
    observer.current = io
  }, [])
}
