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
  /**
   * The full-screen model viewer: a white object on a faintly blue ground.
   *
   * The MODEL stays pure white, and that is still the point — this is a
   * product-shot setup, where the object is read from SHADING and its contact
   * shadow rather than from any colour difference against the backdrop. With
   * soft high-key light the top face lands near white, the sides fall to ~0.8,
   * and the shadow anchors it; that is more legible than contrast.
   *
   * The BACKDROP now carries a slight blue, by request. It is deliberately a
   * step lighter than the room's own sky (ROOM_SKY, #EDF1FB) so the viewer
   * still reads as a lit studio rather than as the room with the walls taken
   * out — and light enough that the white model is still separated by shading,
   * not by the field behind it. Two earlier attempts tried to separate model
   * from backdrop by VALUE (a grey model on a lavender field, then on a blue
   * one); that failed, and this is not that — the tint is on the ground only.
   * ROOM_SKY is the next step if this reads too faint.
   */
  viewerBackdrop: '#F2F5FC',
  viewerSurface: '#FFFFFF',
  /**
   * The contact shadow under the model. Cool and very light, so it reads as a
   * soft occlusion on white paper rather than as a grey smear.
   */
  viewerShadow: '#9AA3B2',
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
