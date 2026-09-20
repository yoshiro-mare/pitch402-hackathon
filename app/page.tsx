'use client'

/**
 * One URL, two halves. The landing sells the idea; the console below it is the
 * working demo that actually takes a payment.
 *
 * They share a selection: picking a spot in the landing's grid fills it into
 * the buy form, so "take spot 07" and the thing that charges for spot 07 are
 * the same click rather than two pages that happen to agree.
 */

import { useState } from 'react'
import Landing from './Landing'
import Demo from './Demo'

export default function Home() {
  const [spot, setSpot] = useState<number | undefined>(undefined)

  return (
    <>
      <Landing onPickSpot={setSpot} />

      {/*
        The console keeps the light palette it was built in. The band below is
        a deliberate seam: above it you are being sold to, below it you are
        holding the API.
      */}
      <section id="console" style={{ background: '#FFFFFF', borderTop: '1px solid #23211E' }}>
        <Demo selectedSpot={spot} />
      </section>
    </>
  )
}
