export default function Home() {
  return (
    <main style={{ maxWidth: '42rem' }}>
      <h1>Pitch402</h1>
      <p>
        Agent-native paid playlist pitching on Base + x402 + Spotify. A curator opens a 100-spot
        playlist; an artist or agent buys a numbered spot with USDC.
      </p>
      <p>
        The API is the product. UI comes later in the build order.
      </p>
      <ul>
        <li>
          <a href="/api/v1/playlists">/api/v1/playlists</a>
        </li>
        <li>
          <a href="/api/v1/playlists/demo">/api/v1/playlists/demo</a>
        </li>
        <li>
          <a href="/api/v1/playlists/demo/quote?next=1">/api/v1/playlists/demo/quote?next=1</a>
        </li>
        <li>
          <a href="/api/v1/playlists/demo/quote?spot=1">/api/v1/playlists/demo/quote?spot=1</a>
        </li>
        <li>
          <a href="/.well-known/agent.json">/.well-known/agent.json</a>
        </li>
        <li>
          <a href="/llms.txt">/llms.txt</a>
        </li>
      </ul>
    </main>
  )
}
