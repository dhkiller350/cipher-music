// Smee webhook proxy — forwards events from smee.io to the local dev server.
// Run with: npm run smee
// Requires the Next.js dev server to be running on port 3000 first.

const SmeeClient = require('smee-client')

// Custom logger: suppress noisy ECONNREFUSED errors that occur when the
// dev server is not yet running. All other messages are passed through.
const logger = {
  ...console,
  error(...args) {
    const msg = args[0]
    if (msg instanceof Error && msg.cause?.code === 'ECONNREFUSED') return
    if (typeof msg === 'string' && msg.includes('ECONNREFUSED')) return
    console.error(...args)
  },
}

const smee = new SmeeClient({
  source: 'https://smee.io/BiqP2GHZAebl29HA',
  target: 'http://localhost:3000/events',
  logger,
})

const events = smee.start()

// Stop forwarding events when the process is terminated (Ctrl+C)
process.once('SIGINT', () => events.close())
process.once('SIGTERM', () => events.close())
