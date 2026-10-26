// Upload a stand logo with real progress (fetch has no upload progress), for the
// order page and the admin editor. The server re-encodes it and hands back the
// bucket path that the order line keeps; the URL is only for showing it.
import { API_BASE } from '../api'

export function uploadLogo(file: File, onProgress: (pct: number) => void): Promise<{ path: string; url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/qr-stand/logo`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let body: { path?: string; url?: string; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.path && body.url) resolve({ path: body.path, url: body.url })
      else reject(new Error(body.error || 'The logo did not upload. Please try again.'))
    }
    xhr.onerror = () => reject(new Error('The logo did not upload. Check your connection and try again.'))
    const form = new FormData()
    form.append('logo', file)
    xhr.send(form)
  })
}

export const LOGO_TYPES = /^image\/(png|jpe?g|webp)$/i
