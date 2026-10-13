/// <reference types="vite/client" />

export default import.meta.glob<string>('./presets/*.{yaml,yml}', {
  query: '?raw',
  import: 'default',
  eager: true,
})
