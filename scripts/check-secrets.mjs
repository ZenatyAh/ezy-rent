// Instant-fail guard: the secret key must never reach the browser. After `npm run build` this looks in everything
// the browser can download (.next/static and public/) for the actual secret VALUES from .env.local, for the
// names of server-only variables, and for any variable that is both NEXT_PUBLIC_ and secret-looking.
//   npm run check:secrets
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SECRET_NAMES = ['SUPABASE_SECRET_KEY', 'GATEWAY_X_SIGNATURE_KEY', 'DATABASE_URL', 'DIRECT_URL']

try {
  process.loadEnvFile('.env.local')
} catch {
  console.error('.env.local not found: the values to look for come from there')
  process.exit(1)
}

function* files(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

const needles = []
for (const name of SECRET_NAMES) {
  needles.push({ label: `the name ${name}`, text: name })
  const value = process.env[name]
  if (value && value.length >= 8) needles.push({ label: `the value of ${name}`, text: value })
}
needles.push({ label: 'a secret key value (sb_secret_ followed by characters)', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ })
needles.push({ label: 'a service_role JWT', pattern: /"role"\s*:\s*"service_role"/ })

let scanned = 0
const hits = []
for (const dir of ['.next/static', 'public']) {
  for (const file of files(dir)) {
    scanned++
    const text = readFileSync(file, 'utf8')
    for (const needle of needles) {
      if (needle.text ? text.includes(needle.text) : needle.pattern.test(text)) hits.push(`${file}: ${needle.label}`)
    }
  }
}

const exposed = Object.keys(process.env).filter((name) => name.startsWith('NEXT_PUBLIC_') && /SECRET|SERVICE|PRIVATE/i.test(name))
for (const name of exposed) hits.push(`environment: ${name} is NEXT_PUBLIC_ and looks secret`)

if (scanned === 0) {
  console.error('Nothing to scan: run npm run build first')
  process.exit(1)
}
console.log(`Scanned ${scanned} files that the browser can download.`)
if (hits.length) {
  console.error('FOUND:\n' + hits.map((hit) => `  ${hit}`).join('\n'))
  process.exit(1)
}
console.log('OK: no secret value or server-only variable name is in anything the browser can download.')
