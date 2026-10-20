/**
 * Service-worker registration surface for the UI layer.
 *
 * The PWA is configured with `registerType: 'prompt'` (see vite.config.ts), so a
 * new build never takes over the page on its own — the user is asked first. That
 * matters here because a silent reload in the middle of a mock test would throw
 * away unsaved answers.
 *
 * This module deliberately contains no UI. A component (owned by the components
 * workstream, not this one) should call `useRegisterSW` and render:
 *
 *   const { offlineReady: [offlineReady], needRefresh: [needRefresh], updateServiceWorker } =
 *     useRegisterSW()
 *
 *   - `offlineReady`  → first install finished; "NECPrep now works offline".
 *   - `needRefresh`   → a newer build is cached; show "Update available" +
 *                       a button calling `updateServiceWorker(true)`.
 *
 * Until such a component exists, `injectRegister: 'auto'` means Vite injects a
 * plain registration script, so offline support is already live — only the
 * update prompt is missing.
 */
export { useRegisterSW } from 'virtual:pwa-register/react'
export type { RegisterSWOptions } from 'virtual:pwa-register/react'
