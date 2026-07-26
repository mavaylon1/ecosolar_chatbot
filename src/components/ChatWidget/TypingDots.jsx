import { SURFACE_MUTED, RADIUS_BUBBLE } from './theme.js'

// Self-contained: owns its own @keyframes so nothing rendering this needs to
// remember to supply the animation CSS separately.
export default function TypingDots() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
      <style>{`@keyframes bounce { 0%, 60%, 100% { opacity: 0.3 } 30% { opacity: 1 } }`}</style>
      <div style={{ background: SURFACE_MUTED, borderRadius: `${RADIUS_BUBBLE}px ${RADIUS_BUBBLE}px ${RADIUS_BUBBLE}px 6px`, padding: '10px 16px', display: 'flex', gap: 4 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#9aa0ad',
              display: 'inline-block',
              animation: `bounce 1.2s ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
