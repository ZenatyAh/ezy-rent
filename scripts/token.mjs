// Prints a Supabase access token for a seeded account, for curl:
//   T=$(node --env-file=.env.local scripts/token.mjs manager@northwind.test)
//   curl -H "Authorization: Bearer $T" http://localhost:3000/api/leases/<id>
const email = process.argv[2]
if (!email) {
  console.error('usage: node --env-file=.env.local scripts/token.mjs <email>')
  process.exit(1)
}

const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'Northwind#2026' }),
})
const json = await res.json()
if (!res.ok) {
  console.error(`Login failed (${res.status}): ${json.msg ?? json.error_description ?? JSON.stringify(json)}`)
  process.exit(1)
}
console.log(json.access_token)
