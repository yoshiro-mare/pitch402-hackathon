import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Archivo, JetBrains_Mono } from 'next/font/google'

/**
 * The two faces the landing page was designed in. Loaded through next/font so
 * they are self-hosted and no request leaves for Google at render time.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Pitch402 — agentic playlist pitching',
  description: 'Agent-native paid playlist pitching on Base + x402 + Spotify.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      {/*
        No padding here. The landing runs full-bleed to the edge of the window
        and sets its own gutter; the demo console below it is padded by the
        section that wraps it.
      */}
      <body
        style={{
          margin: 0,
          padding: 0,
          background: '#0B0B0A',
          color: '#F1EFE9',
          fontFamily: 'var(--font-sans), Helvetica, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  )
}
