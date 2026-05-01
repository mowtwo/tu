// tu-xing (图形) — Tu UI component library.
//
// Source-only package: consumers import each `.tu` component directly
// via the `@tu-lang/vite` plugin. Re-exports listed here are TS-side
// type stubs for editor hover; the real implementations live in
// `./components/*.tu`.

export const VERSION = '0.1.0-alpha.0'

export { default as Button } from './components/Button.tu'
export { default as Input } from './components/Input.tu'
export { default as Card } from './components/Card.tu'
export { default as Badge } from './components/Badge.tu'
export { default as Switch } from './components/Switch.tu'
export { default as Dialog } from './components/Dialog.tu'
export { default as Tabs } from './components/Tabs.tu'
