// Shared visual constants for the widget — kept in one place so Bubble.jsx,
// TypingDots.jsx, and ChatWidget.jsx never drift out of sync with each other.
// iOS-inspired palette: mostly white, navy for anything that needs emphasis
// (header, the user's own messages, buttons), white text sits on navy, dark
// navy text sits on white/light-gray.
// Matched against a reference screenshot of a "LIVE CHAT" button — a
// brighter, more saturated royal blue than the original muted navy. Nudge
// these if it's not quite right; exact pixel-sampling wasn't available.
export const NAVY = '#1a56db'
export const NAVY_DARK = '#123fa8'
export const SURFACE = '#ffffff'
export const SURFACE_MUTED = '#f0f1f5'
export const TEXT_ON_SURFACE = '#1c2230'
export const BORDER = '#e4e6ec'

// iOS-style rounding — generous radii throughout, not the smaller 12-14px
// used previously.
export const RADIUS_PANEL = 24
export const RADIUS_BUBBLE = 20
export const RADIUS_PILL = 999
