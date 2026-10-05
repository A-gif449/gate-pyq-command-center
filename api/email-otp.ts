import { createHash, randomInt, randomBytes } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createClient } from '@supabase/supabase-js'

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

if (firebaseProjectId && firebaseClientEmail && firebasePrivateKey && !getApps().length) {
  initializeApp({ credential: cert({ projectId: firebaseProjectId, clientEmail: firebaseClientEmail, privateKey: firebasePrivateKey }) })
}

const adminAuth = getApps().length ? getAuth() : null
const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const OTP_TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const REQUEST_WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = 3

function normalizeEmail(value: unknown) { return String(value ?? '').trim().toLowerCase() }
function json(res: any, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').json(body)
}
function hashOtp(code: string, salt: string) { return createHash('sha256').update(`${salt}:${code}`).digest('hex') }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char] as string)) }

async function sendOtpEmail(email: string, code: string, purpose: 'login' | 'signup') {
  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!resendKey || !fromEmail) throw new Error('Email delivery is not configured on the server.')
  const subject = purpose === 'signup' ? 'Your GATE PYQ verification code' : 'Your GATE PYQ sign-in code'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#172033"><div style="font-size:12px;font-weight:800;letter-spacing:.18em;color:#b58a24">GATE PYQ COMMAND CENTER</div><h2 style="margin:18px 0 8px">${purpose === 'signup' ? 'Verify your email' : 'Sign in securely'}</h2><p style="color:#667085">Use this one-time code to continue. It expires in 5 minutes.</p><div style="margin:24px 0;padding:18px;border-radius:14px;background:#f4f6f9;border:1px solid #e5e7eb;text-align:center;font-size:34px;font-weight:900;letter-spacing:.28em">${code}</div><p style="font-size:12px;color:#667085">If you did not request this code, you can safely ignore this email.</p></div>`,
    }),
  })
  if (!response.ok) throw new Error('The verification email could not be sent. Please try again.')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' })
  if (!adminAuth || !db) return json(res, 503, { error: 'Email OTP is not configured on the server yet.' })

  const { action, purpose = 'login' } = req.body ?? {}
  const email = normalizeEmail(req.body?.email)
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' })
  if (purpose !== 'login' && purpose !== 'signup') return json(res, 400, { error: 'Invalid OTP purpose.' })

  if (action === 'request') {
    const since = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()
    const { count, error: countError } = await db.from('email_otp_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since)
    if (countError) return json(res, 500, { error: 'Could not start OTP verification.' })
    if ((count ?? 0) >= MAX_REQUESTS) return json(res, 429, { error: 'Too many OTP requests. Please wait a few minutes before requesting another code.' })

    let existing: any = null
    try { existing = await adminAuth.getUserByEmail(email) } catch (error: any) { if (error?.code !== 'auth/user-not-found') return json(res, 500, { error: 'Could not check the account.' }) }
    if (purpose === 'signup' && existing) return json(res, 409, { error: 'An account already exists with this email. Use Sign in instead.' })
    if (purpose === 'login' && !existing) return json(res, 404, { error: 'No account exists with this email. Create an account first.' })

    const code = String(randomInt(100000, 1000000))
    const salt = randomBytes(16).toString('hex')
    const now = new Date()
    const expires = new Date(now.getTime() + OTP_TTL_MS)
    await db.from('email_otp_codes').delete().eq('email', email).eq('purpose', purpose).eq('consumed', false)
    const { error: insertError } = await db.from('email_otp_codes').insert({ email, purpose, code_hash: hashOtp(code, salt), salt, expires_at: expires.toISOString(), attempts: 0, consumed: false })
    await db.from('email_otp_requests').insert({ email, purpose })
    if (insertError) return json(res, 500, { error: 'Could not create the verification code.' })
    try { await sendOtpEmail(email, code, purpose) } catch (error) {
      await db.from('email_otp_codes').delete().eq('email', email).eq('purpose', purpose).eq('consumed', false)
      return json(res, 502, { error: error instanceof Error ? error.message : 'The verification email could not be sent.' })
    }
    return json(res, 200, { ok: true, expiresInSeconds: OTP_TTL_MS / 1000 })
  }

  if (action === 'verify') {
    const code = String(req.body?.code ?? '').trim()
    if (!/^\d{6}$/.test(code)) return json(res, 400, { error: 'Enter the 6-digit code from your email.' })
    const { data: rows, error } = await db.from('email_otp_codes').select('id,email,purpose,code_hash,salt,expires_at,attempts,consumed').eq('email', email).eq('purpose', purpose).eq('consumed', false).order('created_at', { ascending: false }).limit(1)
    const row = rows?.[0]
    if (error || !row) return json(res, 400, { error: 'That code is invalid or has expired. Request a new code.' })
    if (new Date(row.expires_at).getTime() < Date.now()) return json(res, 400, { error: 'That code has expired. Request a new one.' })
    if (Number(row.attempts) >= MAX_ATTEMPTS) return json(res, 429, { error: 'Too many incorrect attempts. Request a new code.' })
    await db.from('email_otp_codes').update({ attempts: Number(row.attempts) + 1 }).eq('id', row.id)
    if (hashOtp(code, row.salt) !== row.code_hash) return json(res, 400, { error: 'Incorrect verification code.' })
    await db.from('email_otp_codes').update({ consumed: true, consumed_at: new Date().toISOString() }).eq('id', row.id)

    let firebaseUser: any = null
    let isNewUser = false
    try { firebaseUser = await adminAuth.getUserByEmail(email) } catch (error: any) {
      if (purpose !== 'signup' || error?.code !== 'auth/user-not-found') return json(res, 404, { error: 'Account not found. Please create an account first.' })
      const displayName = String(req.body?.name ?? '').trim().slice(0, 80) || email.split('@')[0]
      firebaseUser = await adminAuth.createUser({ email, emailVerified: true, displayName })
      isNewUser = true
    }
    const customToken = await adminAuth.createCustomToken(firebaseUser.uid, { role: 'authenticated' })
    return json(res, 200, { ok: true, customToken, isNewUser, displayName: firebaseUser.displayName || email.split('@')[0] })
  }

  return json(res, 400, { error: 'Invalid OTP action.' })
}
