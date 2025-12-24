/// <reference types="vite/client" />

// Type declarations for @google/model-viewer custom element
declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string
        alt?: string
        'auto-rotate'?: boolean
        'camera-controls'?: boolean
        'shadow-intensity'?: string
        exposure?: string
        poster?: string
        loading?: 'auto' | 'lazy' | 'eager'
        reveal?: 'auto' | 'interaction' | 'manual'
        'environment-image'?: string
        'skybox-image'?: string
        ar?: boolean
        'ar-modes'?: string
      },
      HTMLElement
    >
  }
}

