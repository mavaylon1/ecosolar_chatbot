export const metadata = {
  title: 'EcoSolar USA — Chat',
  description: 'EcoSolar USA chatbot',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* Transparent background — this layout is shared by both the /embed
          route (meant to be iframed over a client's page) and the demo/info
          root page, so it should never impose an opaque background of its own. */}
      <body style={{ margin: 0, background: 'transparent', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
