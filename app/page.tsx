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
import { LINE } from './theme'

export default function Home() {
  const [spot, setSpot] = useState<number | undefined>(undefined)

  return (
    <>
      <Landing onPickSpot={setSpot} />

      {/*
        One palette throughout. The rule is the only seam: above it you are
        being sold to, below it you are holding the API.
      */}
      <section id="console" style={{ borderTop: `1px solid ${LINE}` }}>
        <Demo selectedSpot={spot} />
      </section>
    </>
  )
}
