/**
 * WebGL/canvas material colors are fixed sRGB values. They cannot consume CSS
 * variables, and each value is chosen to keep geometry, selection, media, and
 * multi-user traces distinguishable against the immersive forest scene.
 */
export const ENGINE_PALETTE = {
  black: '#000000',
  boardEmission: '#444444',
  collaborator: ['#14705C', '#A34A28', '#7B5B12', '#246B8E', '#8C4165', '#39735A', '#6E5A9B', '#9B3E35'],
  cursor: '#22D3EE',
  darkText: '#111827',
  errorSurface: '#FEE2E2',
  floorEdge: '#CBD5E1',
  forestScene: '#123C33',
  groundLight: '#E5E7EB',
  guide: '#94A3B8',
  locked: '#666666',
  lockedHover: '#999999',
  modelWire: '#888888',
  owned: '#333333',
  paper: '#FFFFFF',
  paperHover: '#F8F8F8',
  paperSkeleton: '#F3F4F6',
  pdfSurface: '#E0E7FF',
  sceneNeutral: '#D7E2DD',
  selection: '#FFC800',
  snap: '#EC4899',
  wallMain: '#D8DEFF',
  wallOutline: '#4B5563',
  wallSideEdge: '#B3C4FF',
  wallTopEdge: '#A1B2FF',
  wallBottomEdge: '#E0E0DB',
  wallWhiteSideEdge: '#FAFAF9',
  wallWhiteTopEdge: '#F7F7F5',
  wallWhiteBottomEdge: '#F3F3F0',
} as const
