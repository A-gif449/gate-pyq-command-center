import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendKey = Deno.env.get('RESEND_API_KEY')!
const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')!
const db = createClient(supabaseUrl, serviceKey)

function localDate(iso: string | Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
function addDays(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}
function streak(dates: Set<string>, today: string) {
  let cursor = today; let n = 0
  while (dates.has(cursor)) { n++; cursor = addDays(cursor, -1) }
  return n
}

Deno.serve(async () => {
  if (!resendKey || !fromEmail) return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY or RESEND_FROM_EMAIL' }), { status: 500 })
  const { data: prefs, error } = await db.from('notification_preferences').select('user_id,email,daily_email_enabled,daily_goal,timezone').eq('daily_email_enabled', true).not('email', 'is', null)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let sent = 0
  for (const pref of prefs ?? []) {
    const timezone = pref.timezone || 'Asia/Kolkata'
    const today = localDate(new Date(), timezone)
    const from = new Date(Date.now() - 15 * 86400000).toISOString()
    const { data: rows } = await db.from('question_progress').select('status,updated_at').eq('user_id', pref.user_id).gte('updated_at', from)
    const solvedDates = new Set<string>()
    let todaySolved = 0
    for (const row of rows ?? []) {
      if (row.status !== 'solved') continue
      const day = localDate(row.updated_at, timezone)
      solvedDates.add(day)
      if (day === today) todaySolved++
    }
    const currentStreak = streak(solvedDates, today)
    const goal = pref.daily_goal || 10
    const subject = todaySolved >= goal ? `🔥 ${currentStreak} day GATE PYQ streak` : `Keep your ${currentStreak} day GATE PYQ streak alive`
    const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px;color:#172033"><h2 style="margin:0 0 8px">${subject}</h2><p style="color:#5d6678">Your daily study pulse from GATE PYQ Command Center.</p><div style="display:flex;gap:12px;margin:24px 0"><div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px"><b style="font-size:28px">${todaySolved}</b><br><span style="color:#6b7280">solved today</span></div><div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px"><b style="font-size:28px">${currentStreak}</b><br><span style="color:#6b7280">day streak</span></div></div><p>${todaySolved >= goal ? 'Daily goal complete. Excellent consistency.' : `You are ${todaySolved}/${goal} toward today's goal. One more focused session keeps the chain moving.`}</p><p style="margin-top:28px;color:#6b7280;font-size:12px">Daily email time: 8:30 PM IST by default.</p></div>`
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: fromEmail, to: [pref.email], subject, html }) })
    if (response.ok) sent++
  }
  return new Response(JSON.stringify({ sent, checked: prefs?.length ?? 0 }), { headers: { 'Content-Type': 'application/json' } })
})
