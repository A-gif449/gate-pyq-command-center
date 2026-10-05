import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

initializeApp({ credential: applicationDefault() })

async function main() {
  let token
  let updated = 0
  do {
    const page = await getAuth().listUsers(1000, token)
    token = page.pageToken
    await Promise.all(page.users.map(async user => {
      const existing = user.customClaims || {}
      if (existing.role === 'authenticated') return
      await getAuth().setCustomUserClaims(user.uid, { ...existing, role: 'authenticated' })
      updated++
    }))
  } while (token)
  console.log(`Assigned role=authenticated to ${updated} Firebase user(s).`)
  console.log('Users must receive a newly issued ID token. Sign out/in or refresh the token after running this script.')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
