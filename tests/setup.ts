import '@testing-library/jest-dom/vitest'

/**
 * jsdom has no ResizeObserver, and the dashboard's two decorative previews
 * (GridPreview, NetworkBandPreview) both measure their own box with one. Without
 * this every test that renders the dashboard throws on mount rather than
 * testing anything.
 *
 * A stub, not a polyfill: it never fires. Both components paint once at their
 * initial measurement and only re-measure on resize, which jsdom cannot do.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})
