import { NAVY, SURFACE_MUTED, TEXT_ON_SURFACE, RADIUS_BUBBLE } from './theme.js'

export default function Bubble({ role, text }) {
  const isUser = role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
      <div
        style={{
          maxWidth: '80%',
          background: isUser ? NAVY : SURFACE_MUTED,
          color: isUser ? '#fff' : TEXT_ON_SURFACE,
          borderRadius: isUser
            ? `${RADIUS_BUBBLE}px ${RADIUS_BUBBLE}px 6px ${RADIUS_BUBBLE}px`
            : `${RADIUS_BUBBLE}px ${RADIUS_BUBBLE}px ${RADIUS_BUBBLE}px 6px`,
          padding: '10px 16px',
          fontSize: 18,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  )
}
