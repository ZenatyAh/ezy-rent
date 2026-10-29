// Runs the unit tests once per timezone. TZ is set on the child process environment, which works
// on Windows, macOS and Linux (an inline `TZ=... cmd` is dropped by Git Bash on Windows).
import { spawnSync } from 'node:child_process'

const zones = ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']
const vitest = 'node_modules/vitest/vitest.mjs'

let failed = false
for (const tz of zones) {
  console.log(`\n=== TZ=${tz}`)
  const result = spawnSync(process.execPath, [vitest, 'run'], {
    stdio: 'inherit',
    env: { ...process.env, TZ: tz },
  })
  if (result.status !== 0) failed = true
}

console.log(failed ? '\nFAILED in at least one timezone' : '\nOK in all timezones')
process.exit(failed ? 1 : 0)
