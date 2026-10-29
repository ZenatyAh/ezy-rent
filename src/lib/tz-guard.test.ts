import { describe, expect, it } from 'vitest'

// `npm run test:tz` runs the whole suite under several TZ values. If TZ silently did not apply
// (for example it was set inline in a shell that drops it), the green result would prove nothing.
// This test fails in that case. Without TZ set it checks nothing.
describe('test process timezone', () => {
  it('is the timezone requested through the TZ environment variable', () => {
    const requested = process.env.TZ
    if (!requested) return
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(requested)
  })
})
