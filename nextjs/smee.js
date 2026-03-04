// Smee webhook proxy — forwards events from smee.io to the local dev server.
// Run with: npm run smee
// Requires the Next.js dev server to be running on port 3000 first.

const SmeeClient = require('smee-client')

const smee = new SmeeClient({
  source: 'https://smee.io/BiqP2GHZAebl29HA',
  target: 'http://localhost:3000/events',
  logger: console
})

const events = smee.start()

// Stop forwarding events when the process is terminated (Ctrl+C)
process.once('SIGINT', () => events.close())
process.once('SIGTERM', () => events.close())
