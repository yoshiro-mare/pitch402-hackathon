import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Pitch402',
  description: 'Agent-native paid playlist pitching on Base + x402 + Spotify.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '2rem',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  )
}
