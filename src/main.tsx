import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { motion, AnimatePresence } from 'motion/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, subDays } from 'date-fns'
import { useDebouncedCallback } from 'use-debounce'
import { Toaster, toast } from 'sonner'
import { Command } from 'cmdk'
import { Drawer } from 'vaul'
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown, CircleHelp, Clock3, ExternalLink,
  Filter, Flame, Heart, Info, KeyRound, LogIn, LogOut, Menu, RotateCcw, Search, Settings2, ShieldCheck,
  Sparkles, ThumbsDown, ThumbsUp, X, Zap, Chrome, UserRound, PanelLeftClose, PanelLeftOpen, RefreshCw,
  TrendingUp, Target, BrainCircuit, CircleDot, Trophy, SlidersHorizontal, CalendarDays, Moon, Sun,
  Command as CommandIcon, Home, UserCog, Medal, Bookmark, ListChecks, ChevronRight, Upload, CheckCircle2,
  Database, Wifi, WifiOff, LayoutDashboard, Award, Gauge, Clock4, CircleGauge, Eye, MousePointer2, Save, Share2,
  Mail, LockKeyhole, Palette, BellRing, HelpCircle, ArrowUpRight, MessageCircle, MoreHorizontal, Link2, BookmarkCheck, Send, Trash2, UserCircle2, Copy, CheckCheck, PartyPopper, Maximize2, Minimize2, BadgeCheck, Pencil
} from 'lucide-react'
import questionsData from './data/questions.json'
import './index.css'
import { firebaseAuth } from './lib/firebase'
import { supabase } from './lib/supabase'
import { warmPages, renderCrop } from './lib/pdf'
import type { Question, Reaction, Status } from './types'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import { Progress } from './components/ui/progress'
import { Select } from './components/ui/select'
import { Separator } from './components/ui/separator'
import {
  browserLocalPersistence, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged,
  setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithCustomToken, sendPasswordResetEmail,
  getAdditionalUserInfo, signOut as firebaseSignOut, updateProfile, sendEmailVerification, type User
} from 'firebase/auth'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } } })
const questions = questionsData.questions as Question[]
const volumeLabels: Record<string, string> = { v1: 'Volume 1', v2: 'Volume 2', v3: 'Volume 3' }
const subjects = [...new Set(questions.map(q => q.subject))].sort()
const allTopics = [...new Set(questions.map(q => q.topic))].sort()
const topicsBySubject = new Map<string, string[]>()
for (const q of questions) {
  const arr = topicsBySubject.get(q.subject) ?? []
  if (!arr.includes(q.topic)) arr.push(q.topic)
  topicsBySubject.set(q.subject, arr.sort())
}

// Precompute lightweight indexes once at module load. The question list is static,
// so rendering/searching should not rebuild these structures on every React render.
const questionsByTopic = new Map<string, Question[]>()
const questionsBySubject = new Map<string, Question[]>()
const questionSearchText = new Map<string, string>()
for (const q of questions) {
  const topicRows = questionsByTopic.get(q.topic) ?? []
  topicRows.push(q)
  questionsByTopic.set(q.topic, topicRows)

  const subjectRows = questionsBySubject.get(q.subject) ?? []
  subjectRows.push(q)
  questionsBySubject.set(q.subject, subjectRows)

  questionSearchText.set(
    q.id,
    [q.id, q.displayId, q.subject, q.topic, q.source, q.tags].filter(Boolean).join(' ').toLowerCase()
  )
}

const statusMeta: Record<Status, { label: string; icon: React.ReactNode; cls: string }> = {
  unsolved: { label: 'Not attempted', icon: <CircleHelp size={15} />, cls: 'text-muted-foreground' },
  solved: { label: 'Solved', icon: <span className="question-status-solved"><Check size={12} strokeWidth={3} /></span>, cls: 'text-emerald-500' },
  wrong: { label: 'Wrong', icon: <X size={15} />, cls: 'text-rose-500' },
  redo: { label: 'Redo', icon: <RotateCcw size={15} />, cls: 'text-amber-500' },
  important: { label: 'Important', icon: <Sparkles size={15} />, cls: 'text-violet-500' }
}

function safeStatusMeta(status: Status | string | undefined) { return statusMeta[status as Status] ?? statusMeta.unsolved }

type View = 'home' | 'library' | 'dashboard' | 'leaderboard' | 'profile' | 'notifications' | 'settings'
type Notification = { id: string; title: string; body: string; created_at: string; read_at: string | null; type?: string }
const OTP_API = `${String(import.meta.env.VITE_EMAIL_OTP_API_URL || '').replace(/\/$/, '') || ''}/api/email-otp`
let notificationAudioContext: AudioContext | null = null
let notificationAudioUnlockBound = false

function getNotificationAudioContext() {
  if (notificationAudioContext) return notificationAudioContext
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return null
    notificationAudioContext = new AudioContextCtor()
    return notificationAudioContext
  } catch { return null }
}

function unlockNotificationAudio() {
  const ctx = getNotificationAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {})
}

function bindNotificationAudioUnlock() {
  if (notificationAudioUnlockBound || typeof window === 'undefined') return
  notificationAudioUnlockBound = true
  const unlock = () => unlockNotificationAudio()
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
  window.addEventListener('touchstart', unlock, { passive: true })
}

bindNotificationAudioUnlock()

function softNotificationChime() {
  try {
    const ctx = getNotificationAudioContext()
    if (!ctx) return
    const play = () => {
      const now = ctx.currentTime
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.028, now + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.13)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.25)
    }
    if (ctx.state === 'suspended') void ctx.resume().then(play).catch(() => {})
    else play()
  } catch { /* browser audio is optional */ }
}
type UserStats = { solved: number; wrong: number; redo: number; important: number; attempted: number; accuracy: number; completion: number; streak: number }

type ProfileForm = { displayName: string; bio: string }
const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters').max(60, 'Keep your name under 60 characters'),
  bio: z.string().trim().max(280, 'Keep your bio under 280 characters'),
})

type CachedState = { progress: Record<string, Status>; progressDates: Record<string, string>; reactions: Record<string, Reaction>; counts: Record<string, { like: number; dislike: number }>; savedAt: string }

function cacheKey(uid: string) { return `gate-pyq-cloud-cache:${uid}` }
function readCache(uid: string): CachedState | null {
  try { const raw = localStorage.getItem(cacheKey(uid)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeCache(uid: string, state: CachedState) {
  try { localStorage.setItem(cacheKey(uid), JSON.stringify(state)) } catch { /* storage is only a cache */ }
}
function notificationCacheKey(uid: string) { return `gate-pyq-notifications:${uid}` }
function readLocalNotifications(uid: string): Notification[] {
  try { const raw = localStorage.getItem(notificationCacheKey(uid)); return raw ? JSON.parse(raw) : [] } catch { return [] }
}
function writeLocalNotifications(uid: string, rows: Notification[]) {
  try { localStorage.setItem(notificationCacheKey(uid), JSON.stringify(rows.slice(0, 50))) } catch {}
}

function readLocalGoal(uid: string): { type: string; value: number; updatedAt?: string } | null {
  try {
    const raw = localStorage.getItem(`gate-pyq-goal:${uid}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.type !== 'string' || !Number.isFinite(Number(parsed.value))) return null
    return { type: parsed.type, value: Number(parsed.value), updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined }
  } catch { return null }
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>('home')
  const [sidebar, setSidebar] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('All subjects')
  const [topic, setTopic] = useState('All topics')
  const [volume, setVolume] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? '')
  const [progress, setProgress] = useState<Record<string, Status>>({})
  const [reactions, setReactions] = useState<Record<string, Reaction>>({})
  const [counts, setCounts] = useState<Record<string, { like: number; dislike: number }>>({})
  const [progressDates, setProgressDates] = useState<Record<string, string>>({})
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [dailyEmailEnabled, setDailyEmailEnabled] = useState(true)
  const [loadingUserData, setLoadingUserData] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup')
  const [commandOpen, setCommandOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('gate-pyq-theme') === 'dark')
  const [profilePhoto, setProfilePhoto] = useState(() => localStorage.getItem('gate-pyq-profile-photo') || '')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedQuestionOpen, setSelectedQuestionOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [confidence, setConfidence] = useState<Record<string, 'guess' | 'unsure' | 'confident'>>({})
  const [goal, setGoal] = useState<{ type: string; value: number }>({ type: 'AIR < 1000', value: 1000 })
  const [shareOpen, setShareOpen] = useState(false)
  const [qotdOpen, setQotdOpen] = useState(false)
  const [celebration, setCelebration] = useState<{title:string;body:string;icon:React.ReactNode}|null>(null)
  const [welcome, setWelcome] = useState<{title:string;body:string;icon:React.ReactNode}|null>(null)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => localStorage.getItem('gate-pyq-notification-sound') !== 'off')
  const welcomeHandledUid = useRef<string | null>(null)
  const notificationSoundEnabledRef = useRef(notificationSoundEnabled)
  const announcedNotificationIds = useRef(new Set<string>())

  useEffect(() => { if (!celebration) return; const timer = window.setTimeout(() => setCelebration(null), 2600); return () => window.clearTimeout(timer) }, [celebration])
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('gate-pyq-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => { if (user) localStorage.setItem(`gate-pyq-confidence:${user.uid}`, JSON.stringify(confidence)) }, [user, confidence])
  useEffect(() => {
    if (!user) { setConfidence({}); setGoal({ type: 'AIR < 1000', value: 1000 }); return }
    try {
      const c = localStorage.getItem(`gate-pyq-confidence:${user.uid}`)
      if (c) setConfidence(JSON.parse(c))
      const localGoal = readLocalGoal(user.uid)
      if (localGoal) setGoal({ type: localGoal.type, value: localGoal.value })
    } catch {}
  }, [user])
  useEffect(() => {
    if (!firebaseAuth) return
    setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {})
    return onAuthStateChanged(firebaseAuth, next => { if (!next) welcomeHandledUid.current = null; setUser(next) })
  }, [])
  useEffect(() => { notificationSoundEnabledRef.current = notificationSoundEnabled; localStorage.setItem('gate-pyq-notification-sound', notificationSoundEnabled ? 'on' : 'off') }, [notificationSoundEnabled])
  useEffect(() => {
    if (!user || welcomeHandledUid.current === user.uid) return
    welcomeHandledUid.current = user.uid
    const explicit = sessionStorage.getItem(`gate-pyq-welcome:${user.uid}`)
    sessionStorage.removeItem(`gate-pyq-welcome:${user.uid}`)
    const seenKey = `gate-pyq-seen:${user.uid}`
    const returning = localStorage.getItem(seenKey) === '1'
    localStorage.setItem(seenKey, '1')
    const name = user.displayName || user.email?.split('@')[0] || 'GATE Learner'
    const createdAt = user.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : 0
    const freshlyCreated = createdAt > 0 && Date.now() - createdAt < 10 * 60 * 1000
    setWelcome(explicit === 'new' || freshlyCreated ? { title: `Welcome, ${name}`, body: 'Your GATE PYQ journey starts here.', icon: <PartyPopper size={18}/> } : { title: `Welcome back, ${name}`, body: returning ? 'Ready to continue where you left off?' : 'Your study cloud is ready.', icon: <Sparkles size={18}/> })
    const timer = window.setTimeout(() => setWelcome(null), 3200)
    return () => window.clearTimeout(timer)
  }, [user])
  useEffect(() => {
    const sharedQuestion = new URLSearchParams(window.location.search).get('question')
    if (sharedQuestion && questions.some(q => q.id === sharedQuestion)) setSelectedId(sharedQuestion)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(true) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadUserData = useCallback(async (uid: string) => {
    if (!supabase) return
    const cached = readCache(uid)
    if (cached) { setProgress(cached.progress); setProgressDates(cached.progressDates); setReactions(cached.reactions); setCounts(cached.counts) }
    setLoadingUserData(true)
    try {
      const [p, r, n, prefs, confidenceRows, goalRow] = await Promise.all([
        supabase.from('question_progress').select('question_id,status,updated_at').eq('user_id', uid),
        supabase.from('question_reactions').select('question_id,reaction').eq('user_id', uid),
        supabase.from('notifications').select('id,title,body,created_at,read_at,type').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
        supabase.from('notification_preferences').select('daily_email_enabled').eq('user_id', uid).maybeSingle(),
        supabase.from('question_confidence').select('question_id,confidence').eq('user_id', uid),
        supabase.from('study_goals').select('goal_type,goal_value,updated_at').eq('user_id', uid).maybeSingle()
      ])
      if (p.error || r.error) throw new Error('Your account data could not be synced. Please try again in a moment.')
      const nextProgress: Record<string, Status> = {}; const dates: Record<string, string> = {}
      for (const row of p.data ?? []) { nextProgress[row.question_id] = row.status as Status; if (row.updated_at) dates[row.question_id] = row.updated_at }
      const nextReactions: Record<string, Reaction> = {}
      for (const row of r.data ?? []) nextReactions[row.question_id] = row.reaction as Reaction
      const nextCounts = readCache(uid)?.counts ?? counts
      setProgress(nextProgress); setProgressDates(dates); setReactions(nextReactions); setCounts(nextCounts)
      const cloudNotifications = !n.error ? (n.data ?? []) as Notification[] : []
      const localNotifications = readLocalNotifications(uid)
      const mergedNotifications = [...cloudNotifications, ...localNotifications].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).filter((item,index,self)=>self.findIndex(x=>x.id===item.id || (x.title===item.title && x.body===item.body))===index).slice(0,50)
      setNotifications(mergedNotifications)
      writeLocalNotifications(uid, mergedNotifications)
      if (!prefs.error && prefs.data) setDailyEmailEnabled(Boolean(prefs.data.daily_email_enabled))
      // A one-time account welcome notification confirms the notification channel is alive.
      const welcomeKey = `welcome-${uid}`
      const hasWelcome = mergedNotifications.some(item => item.type === 'welcome')
      if (!hasWelcome) {
        const welcomeTitle = 'Welcome back to your GATE workspace'
        const welcomeBody = 'Your study history is ready. Solve a few PYQs and I will surface weak topics, revision needs and streak nudges.'
        const { data: welcomeRow } = await supabase.from('notifications').insert({ user_id: uid, type:'welcome', title:welcomeTitle, body:welcomeBody, dedupe_key:welcomeKey }).select('id,title,body,created_at,read_at,type').single()
        const welcomeNotification: Notification = welcomeRow as Notification || { id:crypto.randomUUID(), title:welcomeTitle, body:welcomeBody, created_at:new Date().toISOString(), read_at:null, type:'welcome' }
        setNotifications(prev => { const next=[welcomeNotification,...prev].filter((item,index,self)=>self.findIndex(x=>x.id===item.id || (x.title===item.title && x.body===item.body))===index).slice(0,50); writeLocalNotifications(uid,next); return next })
        announceNotificationSound(welcomeNotification.id)
        toast(welcomeTitle,{description:welcomeBody,icon:<BellRing size={16}/>})
      }
      let nextConfidence: Record<string, 'guess'|'unsure'|'confident'> = {}
      if (!confidenceRows.error) {
        for (const row of confidenceRows.data ?? []) nextConfidence[row.question_id] = row.confidence as 'guess'|'unsure'|'confident'
        setConfidence(nextConfidence)
      }
      // Notifications must not depend on the optional confidence table.
      // Progress alone is enough to detect weak topics and revision backlog.
      void createSmartNotifications(nextProgress, nextConfidence, uid, dates)
      const localGoal = readLocalGoal(uid)
      if (!goalRow.error && goalRow.data) {
        const serverTime = goalRow.data.updated_at ? new Date(goalRow.data.updated_at).getTime() : 0
        const localTime = localGoal?.updatedAt ? new Date(localGoal.updatedAt).getTime() : 0
        if (localGoal && (!localGoal.updatedAt || localTime > serverTime)) {
          const updatedAt = localGoal.updatedAt || new Date().toISOString()
          localStorage.setItem(`gate-pyq-goal:${uid}`, JSON.stringify({ ...localGoal, updatedAt }))
          setGoal({ type: localGoal.type, value: localGoal.value })
          void supabase.from('study_goals').upsert({ user_id: uid, goal_type: localGoal.type, goal_value: localGoal.value, updated_at: updatedAt }, { onConflict: 'user_id' })
        } else {
          setGoal({ type: goalRow.data.goal_type, value: Number(goalRow.data.goal_value) })
        }
      } else if (localGoal) {
        const updatedAt = localGoal.updatedAt || new Date().toISOString()
        localStorage.setItem(`gate-pyq-goal:${uid}`, JSON.stringify({ ...localGoal, updatedAt }))
        setGoal({ type: localGoal.type, value: localGoal.value })
        void supabase.from('study_goals').upsert({ user_id: uid, goal_type: localGoal.type, goal_value: localGoal.value, updated_at: updatedAt }, { onConflict: 'user_id' })
      }
      writeCache(uid, { progress: nextProgress, progressDates: dates, reactions: nextReactions, counts: nextCounts, savedAt: new Date().toISOString() })
      setNotice('')
    } catch (error) {
      setNotice('Account sync is temporarily unavailable. Your recent study state is still available.')
    } finally { setLoadingUserData(false) }
  }, [])

  useEffect(() => {
    if (!user) { setProgress({}); setProgressDates({}); setReactions({}); setCounts({}); setNotifications([]); return }
    loadUserData(user.uid)
    if (supabase) {
      supabase.from('profiles').upsert({ id: user.uid, display_name: user.displayName || user.email?.split('@')[0] || 'GATE learner', avatar_url: user.photoURL || null, verified: user.emailVerified }, { onConflict: 'id' }).then(() => {})
      supabase.from('notification_preferences').upsert({ user_id: user.uid, email: user.email, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, { onConflict: 'user_id' }).then(() => {})
    }
  }, [user, loadUserData])
  useEffect(() => {
    if (!user || !supabase) return
    const client = supabase
    const channel = client.channel(`notifications-${user.uid}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.uid}` }, payload => {
      const incoming = payload.new as Notification
      setNotifications(prev => { const next=prev.some(n => n.id===incoming.id)?prev:[incoming,...prev].slice(0,50); writeLocalNotifications(user.uid,next); return next })
      announceNotificationSound(incoming.id)
      toast(incoming.title, { description: incoming.body, icon: <BellRing size={16}/> })
    }).subscribe()
    return () => { client.removeChannel(channel) }
  }, [user, notificationSoundEnabled])
  const [search, setSearch] = useState('')
  const updateSearch = useDebouncedCallback((value: string) => { setSearch(value) }, 120)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return questions.filter(item => {
      const hay = questionSearchText.get(item.id) ?? ''
      const tokens=q.split(/\s+/).filter(Boolean); return (!tokens.length || tokens.every(token => hay.includes(token))) && (subject === 'All subjects' || item.subject === subject) && (volume === 'all' || item.volume === volume) && (topic === 'All topics' || item.topic === topic) && (statusFilter === 'all' || (progress[item.id] ?? 'unsolved') === statusFilter)
    })
  }, [search, subject, volume, topic, statusFilter, progress])
  const selected = questions.find(q => q.id === selectedId) ?? filtered[0] ?? questions[0]
  const selectedIndex = filtered.findIndex(q => q.id === selected?.id)
  useEffect(() => {
    if (!selected || !supabase) return
    let cancelled = false
    supabase.from('question_reaction_counts').select('likes,dislikes').eq('question_id', selected.id).maybeSingle().then(({ data, error }) => {
      if (!cancelled && !error && data) setCounts(prev => ({ ...prev, [selected.id]: { like: Number(data.likes ?? 0), dislike: Number(data.dislikes ?? 0) } }))
    })
    return () => { cancelled = true }
  }, [selected?.id])

  const qotd = useMemo(() => { const day=Number(format(new Date(),'yyyyMMdd')); return questions[day % questions.length] }, [])
  const revisionQueue = useMemo(() => {
    const now = Date.now()
    return questions.map(q => {
      const st = progress[q.id]
      const updated = progressDates[q.id] ? new Date(progressDates[q.id]).getTime() : 0
      const age = updated ? (now - updated) / 86400000 : 0
      const confidenceValue = confidence[q.id]
      let priority = 0
      if (st === 'wrong') priority += 100
      if (st === 'redo') priority += 90
      if (st === 'important') priority += 75
      if (confidenceValue === 'guess') priority += 35
      if (confidenceValue === 'unsure') priority += 20
      if (st === 'solved' && age >= 3) priority += Math.min(60, 20 + Math.floor(age))
      return { q, priority, age, confidenceValue }
    }).filter(x => {
      const st = progress[x.q.id]
      return st === 'wrong' || st === 'redo' || st === 'important' ||
        (st === 'solved' && x.age >= 3) ||
        (st === 'solved' && (x.confidenceValue === 'guess' || x.confidenceValue === 'unsure') && x.age >= 1)
    }).sort((a,b) => b.priority - a.priority || b.age - a.age).slice(0, 24).map(x => x.q)
  }, [progress, progressDates, confidence])
  const performanceStats = useMemo(() => {
    const topics = new Map<string, { name:string; total:number; solved:number; wrong:number; attempted:number; uncertain:number }>()
    const subjects = new Map<string, { name:string; total:number; solved:number; wrong:number; attempted:number }>()
    for (const q of questions) {
      let t = topics.get(q.topic); if (!t) { t = { name:q.topic, total:0, solved:0, wrong:0, attempted:0, uncertain:0 }; topics.set(q.topic,t) }
      t.total++
      let sub = subjects.get(q.subject); if (!sub) { sub = { name:q.subject, total:0, solved:0, wrong:0, attempted:0 }; subjects.set(q.subject,sub) }
      sub.total++
      const st = progress[q.id]
      if (st && st !== 'unsolved') { t.attempted++; sub.attempted++ }
      if (st === 'solved') { t.solved++; sub.solved++ }
      if (st === 'wrong') { t.wrong++; sub.wrong++ }
      const cv = confidence[q.id]
      if (cv === 'guess' || cv === 'unsure') t.uncertain++
    }
    const topicStats = [...topics.values()].map(x => ({ ...x, accuracy: x.solved+x.wrong ? Math.round(x.solved/(x.solved+x.wrong)*100) : 0 })).filter(x=>x.attempted>0).sort((a,b)=>a.accuracy-b.accuracy||b.attempted-a.attempted).slice(0,12)
    const subjectStats = [...subjects.values()].map(x => ({ ...x, accuracy: x.solved+x.wrong ? Math.round(x.solved/(x.solved+x.wrong)*100) : 0 })).sort((a,b)=>b.attempted-a.attempted||a.name.localeCompare(b.name))
    return { topicStats, subjectStats }
  }, [progress, confidence])
  const topicStats = performanceStats.topicStats
  const subjectStats = performanceStats.subjectStats
  const progressCounts = useMemo(() => {
    const counts: Record<Status, number> = { unsolved: 0, solved: 0, wrong: 0, redo: 0, important: 0 }
    for (const status of Object.values(progress)) {
      if (status in counts) counts[status as Status]++
    }
    return counts
  }, [progress])

  const stats = useMemo<UserStats>(() => {
    const values = Object.values(progress)
    const solved = values.filter(v => v === 'solved').length
    const wrong = values.filter(v => v === 'wrong').length
    const redo = values.filter(v => v === 'redo').length
    const important = values.filter(v => v === 'important').length
    const attempted = values.filter(v => v !== 'unsolved').length
    const base = solved + wrong
    const keys = new Set(Object.values(progressDates).map(d => format(new Date(d), 'yyyy-MM-dd')))
    let cursor = new Date(); let streak = 0
    if (!keys.has(format(cursor, 'yyyy-MM-dd'))) cursor = subDays(cursor, 1)
    while (keys.has(format(cursor, 'yyyy-MM-dd'))) { streak++; cursor = subDays(cursor, 1) }
    return { solved, wrong, redo, important, attempted, accuracy: base ? Math.round(solved / base * 100) : 0, completion: Math.round(attempted / Math.max(1, questions.length) * 100), streak }
  }, [progress, progressDates])

  const achievements = useMemo(() => {
    const solved = stats.solved
    const list = [
      { id:'first', label:'First 10 PYQs', icon:<BookOpen size={15}/>, unlocked:solved >= 10 },
      { id:'hundred', label:'100 PYQs', icon:<Medal size={15}/>, unlocked:solved >= 100 },
      { id:'fivehundred', label:'500 PYQs', icon:<Trophy size={15}/>, unlocked:solved >= 500 },
      { id:'streak7', label:'7-day streak', icon:<Flame size={15}/>, unlocked:stats.streak >= 7 },
      { id:'streak30', label:'30-day streak', icon:<Flame size={15}/>, unlocked:stats.streak >= 30 },
      { id:'accuracy90', label:'90% accuracy', icon:<Target size={15}/>, unlocked:stats.accuracy >= 90 && stats.attempted >= 20 },
      { id:'coverage25', label:'25% coverage', icon:<Gauge size={15}/>, unlocked:stats.completion >= 25 },
    ]
    return list
  }, [stats])
  const solvedToday = useMemo(() => { const today=format(new Date(),'yyyy-MM-dd'); let n=0; for(const [id,st] of Object.entries(progress)) if(st==='solved' && progressDates[id] && format(new Date(progressDates[id]),'yyyy-MM-dd')===today) n++; return n }, [progress, progressDates])
  const unread = notifications.filter(n => !n.read_at).length

  const nextWarmKey = selectedIndex >= 0 && filtered[selectedIndex + 1] ? `${filtered[selectedIndex + 1].id}:${filtered[selectedIndex + 1].segments.map(s=>`${s.pdf??'v2'}-${s.page}`).join(',')}` : ''
  useEffect(() => { if (!nextWarmKey) return; const nextQuestion = filtered[selectedIndex + 1]; if (nextQuestion) warmPages(nextQuestion.segments).catch(() => {}) }, [nextWarmKey])
  useEffect(() => {
    if (!user || !supabase || !Object.keys(progressDates).length) return
    const client = supabase
    const key = `daily-${format(new Date(), 'yyyy-MM-dd')}`
    client.from('notifications').select('id').eq('user_id', user.uid).eq('dedupe_key', key).maybeSingle().then(({ data }) => {
      if (!data) {
        const title = stats.streak ? `🔥 ${stats.streak} day streak is alive` : 'Your study streak is waiting'
        const body = `${solvedToday}/10 questions solved today. Keep the next rep small and consistent.`
        client.from('notifications').insert({ user_id: user.uid, type: 'daily', title, body, dedupe_key: key }).select('id,title,body,created_at,read_at,type').single().then(({data:row}) => {
          pushNotification(row as Notification || {id:crypto.randomUUID(),title,body,created_at:new Date().toISOString(),read_at:null,type:'daily'})
        })
      }
    })
  }, [user, progressDates, solvedToday, stats.streak])

  function navigate(next: View) {
    if ((next === 'library' || next === 'dashboard') && !user) {
      setAuthMode('login')
      setAuthOpen(true)
      setMobileOpen(false)
      setNotificationOpen(false)
      toast(next === 'dashboard' ? 'Sign in to open your personal dashboard.' : 'Sign in to start solving GATE PYQs.')
      return
    }
    setView(next); setMobileOpen(false); setNotificationOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function move(delta: number) { if (!filtered.length) return; const next = Math.max(0, Math.min(filtered.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta)); setSelectedId(filtered[next].id) }

  async function persistCache(nextProgress = progress, nextDates = progressDates, nextReactions = reactions, nextCounts = counts) {
    if (user) writeCache(user.uid, { progress: nextProgress, progressDates: nextDates, reactions: nextReactions, counts: nextCounts, savedAt: new Date().toISOString() })
  }
  function showSolveCelebration(nextProgress: Record<string, Status>, nextDates: Record<string, string>) {
    const solvedCount = Object.values(nextProgress).filter(v => v === 'solved').length
    const keys = new Set(Object.values(nextDates).map(d => format(new Date(d), 'yyyy-MM-dd')))
    let cursor = new Date(); let streak = 0
    if (!keys.has(format(cursor, 'yyyy-MM-dd'))) cursor = subDays(cursor, 1)
    while (keys.has(format(cursor, 'yyyy-MM-dd'))) { streak++; cursor = subDays(cursor, 1) }
    const solveMilestones = new Set([1, 10, 25, 50, 100, 250, 500, 1000])
    const streakMilestones = new Set([1, 3, 7, 14, 30, 60, 100])
    const milestone = solveMilestones.has(solvedCount)
    const streakHit = streakMilestones.has(streak)
    const item = milestone
      ? { title: `${solvedCount} ${solvedCount === 1 ? 'Question' : 'Questions'} Solved`, body: 'Keep the solving rhythm going.', icon: <CheckCircle2 size={18} /> }
      : streakHit
        ? { title: `${streak} Day Streak`, body: 'Your consistency is building momentum.', icon: <Flame size={18} /> }
        : { title: 'Question Solved', body: `${solvedCount} ${solvedCount === 1 ? 'question' : 'questions'} solved so far.`, icon: <PartyPopper size={18} /> }
    setCelebration(item)
  }

  function announceNotificationSound(notificationId: string) {
    if (announcedNotificationIds.current.has(notificationId)) return
    announcedNotificationIds.current.add(notificationId)
    if (notificationSoundEnabledRef.current) softNotificationChime()
  }

  function pushNotification(notification: Notification, playSound = true) {
    setNotifications(prev => {
      const next = [notification, ...prev].filter((item,index,self)=>self.findIndex(x=>x.id===item.id || (x.title===item.title && x.body===item.body))===index).slice(0,50)
      if (user) writeLocalNotifications(user.uid, next)
      return next
    })
    if (playSound) announceNotificationSound(notification.id)
    toast(notification.title, { description: notification.body, icon: <BellRing size={16}/> })
  }

  async function createSmartNotifications(nextProgress: Record<string, Status>, nextConfidence: Record<string, 'guess'|'unsure'|'confident'>, targetUid = user?.uid, nextDates = progressDates) {
    if (!targetUid) return
    const now = Date.now()
    const topicCandidates = allTopics.map(topic => {
      const rows = questionsByTopic.get(topic) ?? []
      const attemptedRows = rows.filter(q => { const st = nextProgress[q.id]; return st && st !== 'unsolved' })
      const solved = attemptedRows.filter(q => nextProgress[q.id] === 'solved').length
      const wrong = attemptedRows.filter(q => nextProgress[q.id] === 'wrong').length
      const uncertain = attemptedRows.filter(q => nextConfidence[q.id] === 'guess' || nextConfidence[q.id] === 'unsure').length
      const accuracy = solved + wrong ? Math.round(solved / (solved + wrong) * 100) : 0
      return { topic, attempted: attemptedRows.length, solved, wrong, uncertain, accuracy }
    }).filter(x => x.attempted >= 5 && (x.accuracy < 60 || x.wrong >= 3 || (x.uncertain >= 3 && x.accuracy < 75)))
      .sort((a,b) => a.accuracy - b.accuracy || b.wrong - a.wrong || b.attempted - a.attempted).slice(0, 3)

    const notificationsToCreate: Array<{type:string;title:string;body:string;dedupeKey:string}> = []
    for (const item of topicCandidates) {
      const safe = item.topic.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)
      const week = format(new Date(),'yyyy-ww')
      notificationsToCreate.push({
        type:'weak_topic',
        title:`Weak topic: ${item.topic}`,
        body:`Your ${item.topic} performance is ${item.accuracy}% across ${item.attempted} attempts. Revise the core concepts and practice a few more PYQs before proceeding.`,
        dedupeKey:`weak-topic-${safe}-${week}`
      })
    }

    const wrongOrRedo = Object.values(nextProgress).filter(v => v === 'wrong' || v === 'redo').length
    const importantCount = Object.values(nextProgress).filter(v => v === 'important').length
    const agingSolved = Object.entries(nextProgress).filter(([id, st]) => {
      if (st !== 'solved') return false
      const stamp = nextDates[id] ? new Date(nextDates[id]).getTime() : 0
      return stamp > 0 && (now - stamp) / 86400000 >= 3
    }).length
    const uncertainCount = Object.values(nextConfidence).filter(v => v === 'guess' || v === 'unsure').length

    if (wrongOrRedo >= 3) notificationsToCreate.push({
      type:'revision', title:'Revision pending',
      body:`You have ${wrongOrRedo} PYQs marked wrong or redo. Clear a few from your revision queue before moving on.`,
      dedupeKey:`revision-wrong-redo-${format(new Date(),'yyyy-MM-dd')}`
    })
    if (agingSolved >= 3) notificationsToCreate.push({
      type:'revision', title:'Older PYQs are due for revision',
      body:`${agingSolved} solved PYQs have been untouched for 3+ days. A short revision pass now will strengthen retention.`,
      dedupeKey:`revision-aging-${format(new Date(),'yyyy-MM-dd')}`
    })
    if (importantCount >= 3) notificationsToCreate.push({
      type:'revision', title:'Important questions are waiting',
      body:`You have ${importantCount} important PYQs saved. Revisit them before adding another batch.`,
      dedupeKey:`revision-important-${format(new Date(),'yyyy-MM-dd')}`
    })
    if (uncertainCount >= 5) notificationsToCreate.push({
      type:'confidence', title:'Confidence review recommended',
      body:`You have ${uncertainCount} PYQs marked Guess/Unsure. Revisit these after reviewing the underlying concepts.`,
      dedupeKey:`confidence-review-${format(new Date(),'yyyy-MM-dd')}`
    })

    for (const item of notificationsToCreate) {
      let existing = null as {id:string}|null
      if (supabase) {
        const result = await supabase.from('notifications').select('id').eq('user_id', targetUid).eq('dedupe_key', item.dedupeKey).maybeSingle()
        existing = result.data as {id:string}|null
      }
      if (existing) continue
      const fallback: Notification = { id: crypto.randomUUID(), title:item.title, body:item.body, created_at:new Date().toISOString(), read_at:null, type:item.type }
      let notification = fallback
      if (supabase) {
        const { data } = await supabase.from('notifications').insert({ user_id:targetUid, type:item.type, title:item.title, body:item.body, dedupe_key:item.dedupeKey }).select('id,title,body,created_at,read_at,type').single()
        if (data) notification = data as Notification
      }
      setNotifications(prev => {
        const next=[notification,...prev].filter((row,index,self)=>self.findIndex(x=>x.id===row.id || (x.title===row.title && x.body===row.body))===index).slice(0,50)
        writeLocalNotifications(targetUid,next)
        return next
      })
      announceNotificationSound(notification.id)
      toast(notification.title,{description:notification.body,icon:<BellRing size={16}/>})
    }
  }

  async function createWeakTopicNotification(nextProgress: Record<string, Status>, nextConfidence: Record<string, 'guess'|'unsure'|'confident'>) {
    if (!user || !supabase || !selected) return
    const topicRows = questions.filter(q => q.topic === selected.topic)
    const attemptedRows = topicRows.filter(q => {
      const st = nextProgress[q.id]
      return st && st !== 'unsolved'
    })
    const solved = attemptedRows.filter(q => nextProgress[q.id] === 'solved').length
    const wrong = attemptedRows.filter(q => nextProgress[q.id] === 'wrong').length
    const attempted = attemptedRows.length
    const accuracy = solved + wrong ? Math.round(solved / (solved + wrong) * 100) : 0
    const uncertain = attemptedRows.filter(q => nextConfidence[q.id] === 'guess' || nextConfidence[q.id] === 'unsure').length
    const weak = attempted >= 5 && (accuracy < 60 || wrong >= 3 || (uncertain >= 3 && accuracy < 75))
    if (!weak) return
    const safeTopic = selected.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
    const week = format(new Date(), 'yyyy-ww')
    const dedupeKey = `weak-topic-${safeTopic}-${week}`
    const { data: existing } = await supabase.from('notifications').select('id').eq('user_id', user.uid).eq('dedupe_key', dedupeKey).maybeSingle()
    if (existing) return
    const body = `Your ${selected.topic} performance is ${accuracy}% across ${attempted} attempts. Revise the core concepts and practice a few more PYQs before proceeding.`
    const { data } = await supabase.from('notifications').insert({ user_id: user.uid, type: 'weak_topic', title: `Weak topic: ${selected.topic}`, body, dedupe_key: dedupeKey }).select('id,title,body,created_at,read_at,type').single()
    pushNotification(data as Notification || { id: crypto.randomUUID(), title: `Weak topic: ${selected.topic}`, body, created_at: new Date().toISOString(), read_at: null, type:'weak_topic' })
  }

  async function updateStatus(next: Status) {
    if (!selected) return
    if (!user) { setAuthMode('login'); setAuthOpen(true); toast('Sign in to save your study status across devices.'); return }
    const previous = progress[selected.id] ?? 'unsolved'
    const now = new Date().toISOString()
    const np = { ...progress, [selected.id]: next }; const nd = { ...progressDates, [selected.id]: now }
    setProgress(np); setProgressDates(nd); await persistCache(np, nd)
    if (!supabase) { toast.error('Your study status could not be saved. Please sign in again.'); return }
    const { error } = await supabase.from('question_progress').upsert({ user_id: user.uid, question_id: selected.id, status: next, updated_at: now }, { onConflict: 'user_id,question_id' })
    if (error) {
      setProgress(prev => ({ ...prev, [selected.id]: previous }))
      const restoredDates = { ...progressDates }
      if (previous === 'unsolved') delete restoredDates[selected.id]
      setProgressDates(restoredDates)
      await persistCache({ ...progress, [selected.id]: previous }, restoredDates)
      toast.error('Could not save this status. Please try again.')
      return
    }
    if (next === 'solved' && previous !== 'solved') showSolveCelebration(np, nd)
    void createWeakTopicNotification(np, confidence)
    void createSmartNotifications(np, confidence, user.uid, nd)
    toast.success(`${selected.displayId ?? selected.id} marked ${statusMeta[next].label.toLowerCase()}`)
  }
  async function setQuestionConfidence(value: 'guess' | 'unsure' | 'confident') {
    if (!selected) return
    setConfidence(prev => ({ ...prev, [selected.id]: value }))
    if (user && supabase) {
      const { error } = await supabase.from('question_confidence').upsert({ user_id: user.uid, question_id: selected.id, confidence: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,question_id' })
      if (error && !error.message.includes('question_confidence')) toast.error('Confidence saved locally. Cloud sync will retry later.')
    }
    toast.success(`Confidence: ${value}`)
  }

  async function saveGoal(next:{type:string;value:number}) {
    const updatedAt = new Date().toISOString()
    setGoal(next)
    if (user) localStorage.setItem(`gate-pyq-goal:${user.uid}`, JSON.stringify({ ...next, updatedAt }))
    if (user && supabase) {
      const { error } = await supabase.from('study_goals').upsert({ user_id: user.uid, goal_type: next.type, goal_value: next.value, updated_at: updatedAt }, { onConflict: 'user_id' })
      if (error && !error.message.includes('study_goals')) toast.error('Goal saved locally. Cloud sync will retry later.')
    }
  }

  async function reactQuestion(kind: Exclude<Reaction, null>) {
    if (!selected) return
    if (!user) { setAuthMode('login'); setAuthOpen(true); toast('Sign in to react to questions.'); return }
    const current = reactions[selected.id] ?? null
    const next = current === kind ? null : kind
    const previousCounts = counts[selected.id] ?? { like: 0, dislike: 0 }
    const optimisticCounts = { ...previousCounts }
    if (current) optimisticCounts[current] = Math.max(0, optimisticCounts[current] - 1)
    if (next) optimisticCounts[next] += 1
    const optimisticReactions = { ...reactions, [selected.id]: next }
    setReactions(optimisticReactions)
    setCounts(prev => ({ ...prev, [selected.id]: optimisticCounts }))
    await persistCache(progress, progressDates, optimisticReactions, { ...counts, [selected.id]: optimisticCounts })
    if (!supabase) return

    // Prefer the transaction-safe RPC, but fall back to direct RLS-protected writes
    // so a stale database function cannot make the UI appear broken.
    let serverReaction: Reaction = next
    let serverCounts = optimisticCounts
    const rpc = await supabase.rpc('set_question_reaction', { p_question_id: selected.id, p_reaction: next })
    if (!rpc.error) {
      const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
      if (row) {
        serverReaction = (row.my_reaction ?? null) as Reaction
        serverCounts = { like: Number(row.likes ?? 0), dislike: Number(row.dislikes ?? 0) }
      }
    } else {
      try {
        if (next) {
          const { error } = await supabase.from('question_reactions').upsert({ user_id: user.uid, question_id: selected.id, reaction: next }, { onConflict: 'user_id,question_id' })
          if (error) throw error
        } else {
          const { error } = await supabase.from('question_reactions').delete().eq('user_id', user.uid).eq('question_id', selected.id)
          if (error) throw error
        }
        const [mine, totals] = await Promise.all([
          supabase.from('question_reactions').select('reaction').eq('user_id', user.uid).eq('question_id', selected.id).maybeSingle(),
          supabase.from('question_reaction_counts').select('likes,dislikes').eq('question_id', selected.id).maybeSingle()
        ])
        if (mine.error) throw mine.error
        serverReaction = (mine.data?.reaction ?? null) as Reaction
        if (!totals.error && totals.data) serverCounts = { like: Number(totals.data.likes ?? 0), dislike: Number(totals.data.dislikes ?? 0) }
      } catch {
        setReactions(prev => ({ ...prev, [selected.id]: current }))
        setCounts(prev => ({ ...prev, [selected.id]: previousCounts }))
        await persistCache(progress, progressDates, { ...reactions, [selected.id]: current }, { ...counts, [selected.id]: previousCounts })
        toast.error('Reaction could not be saved. Please try again.')
        return
      }
    }
    setReactions(prev => ({ ...prev, [selected.id]: serverReaction }))
    setCounts(prev => ({ ...prev, [selected.id]: serverCounts }))
    await persistCache(progress, progressDates, { ...reactions, [selected.id]: serverReaction }, { ...counts, [selected.id]: serverCounts })
    toast.success(serverReaction === 'like' ? 'Liked question' : serverReaction === 'dislike' ? 'Disliked question' : 'Reaction removed')
  }
  async function signOut() { if (firebaseAuth) await firebaseSignOut(firebaseAuth); navigate('home') }

  const selectQuestion = useCallback((id: string) => setSelectedId(id), [])
  const navItems: Array<{ id: View; label: string; icon: React.ReactNode }> = [
    { id: 'home', label: 'Home', icon: <Home size={17} /> },
    { id: 'library', label: 'Questions', icon: <BookOpen size={17} /> },
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={17} /> },
    { id: 'profile', label: 'Profile', icon: <UserRound size={17} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={17} /> },
    { id: 'settings', label: 'Settings', icon: <Settings2 size={17} /> },
  ]

  return <div className="min-h-screen bg-background text-foreground">
    <Toaster richColors position="bottom-right" theme={dark ? 'dark' : 'light'} />
    <AnimatePresence>{welcome && <motion.div initial={{opacity:0,y:-28,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-20,scale:.98}} className="pointer-events-none fixed left-1/2 top-4 z-[100] w-[min(92vw,430px)] -translate-x-1/2"><div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[.12] px-4 py-3 shadow-2xl backdrop-blur-xl"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">{welcome.icon}</div><div className="min-w-0"><p className="truncate text-sm font-black">{welcome.title}</p><p className="text-[11px] text-muted-foreground">{welcome.body}</p></div></div></motion.div>}</AnimatePresence>
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 md:px-6">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}><Menu size={18} /></Button>
        <button onClick={() => navigate('home')} className="group flex items-center gap-3 text-left">
          <motion.div whileHover={{ rotate: -4, scale: 1.04 }} className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-xl shadow-primary/25"><Zap size={19} fill="currentColor" /></motion.div>
          <div><div className="text-sm font-black tracking-tight">GATE<span className="text-primary">PYQ</span></div><div className="text-[9px] font-bold tracking-[0.22em] text-muted-foreground">COMMAND CENTER</div></div>
        </button>
        <div className="hidden items-center gap-2 pl-4 text-xs text-muted-foreground lg:flex"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> {questions.length.toLocaleString()} PYQs loaded</div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Button variant="outline" className="hidden h-9 gap-2 text-xs md:inline-flex" onClick={() => setCommandOpen(true)}><CommandIcon size={14} /> Search <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[9px]">Ctrl K</kbd></Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(v => !v)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</Button>
          {user && <div className="relative"><Button variant="ghost" size="icon" onClick={() => setNotificationOpen(v => !v)} aria-label="Notifications"><Bell size={18} />{unread > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{unread > 9 ? '9+' : unread}</span>}</Button>{notificationOpen && <NotificationPopover notifications={notifications} unread={unread} onRead={async id => { if (!supabase || !user) return; const at = new Date().toISOString(); await supabase.from('notifications').update({ read_at: at }).eq('id', id).eq('user_id', user.uid); setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: at } : n)) }} onOpenAll={() => navigate('notifications')} />}</div>}
          {user ? <div className="flex items-center gap-2"><Avatar photo={profilePhoto || user.photoURL || ''} name={user.displayName || user.email || 'User'} verified={user.emailVerified} /><div className="hidden max-w-32 truncate text-xs font-medium sm:block">{user.displayName || user.email}</div><Button variant="outline" size="sm" onClick={signOut}><LogOut size={14} /><span className="hidden sm:inline">Sign out</span></Button></div> : <Button size="sm" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}><LogIn size={14} /> Sign in</Button>}
        </div>
      </div>
    </header>

    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1600px]">
      <aside className={`${sidebar ? 'w-64' : 'w-[76px]'} sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-border/70 bg-card/55 transition-[width] duration-300 md:flex`}>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-5 flex justify-end"><Button variant="ghost" size="icon" onClick={() => setSidebar(v => !v)} title="Toggle sidebar">{sidebar ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</Button></div>
          <div className="space-y-1">{navItems.map(item => <SideNav key={item.id} active={view === item.id} icon={item.icon} label={item.label} collapsed={!sidebar} badge={item.id === 'notifications' && unread ? String(unread) : undefined} onClick={() => navigate(item.id)} />)}</div>
          {sidebar && <>
            <Separator className="my-5" />
            <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Quick status</div>
            {(Object.keys(statusMeta) as Status[]).map(s => <SideNav key={s} active={view === 'library' && statusFilter === s} icon={statusMeta[s].icon} label={statusMeta[s].label} collapsed={false} badge={String(progressCounts[s] ?? 0)} onClick={() => { setStatusFilter(s); navigate('library') }} />)}
            
          </>}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {notice && <div className="mx-auto mt-4 flex max-w-[1450px] items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground"><Info size={15} className="mt-0.5 shrink-0 text-primary" /><span className="flex-1">{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .2 }}>
            {view === 'home' && <ViewBoundary><HomeView stats={stats} user={user} qotd={qotd} revisionQueue={revisionQueue} goal={goal} achievements={achievements} onStart={() => navigate('library')} onDashboard={() => navigate('dashboard')} onSignIn={() => { setAuthMode('login'); setAuthOpen(true) }} onOpenQuestion={id => { setSelectedId(id); navigate('library') }} onShare={() => setShareOpen(true)} /></ViewBoundary>}
            {view === 'library' && <ViewBoundary><LibraryView {...{ query, setQuery: (v: string) => { setQuery(v); updateSearch(v) }, subject, setSubject, topic, setTopic, volume, setVolume, statusFilter, setStatusFilter, showFilters, setShowFilters, filtered, selected, selectedIndex, progress, reactions, counts, onSelect: selectQuestion, onStatus: updateStatus, onReaction: reactQuestion, onMove: move, user, setAuthOpen, setAuthMode, openQuestion: () => setSelectedQuestionOpen(true), confidence, onConfidence: setQuestionConfidence, sidebar, setSidebar }} /></ViewBoundary>}
            {view === 'dashboard' && <ViewBoundary><DashboardView questions={questions} progress={progress} progressDates={progressDates} subjectStats={subjectStats} topicStats={topicStats} confidence={confidence} stats={stats} goal={goal} setGoal={saveGoal} revisionQueue={revisionQueue} achievements={achievements} onOpenQuestion={id => { setSelectedId(id); navigate('library') }} onShare={() => setShareOpen(true)} /></ViewBoundary>}
            {view === 'leaderboard' && <ViewBoundary><LeaderboardView user={user} stats={stats} /></ViewBoundary>}
            {view === 'profile' && <ViewBoundary><ProfileView user={user} photo={profilePhoto} setPhoto={setProfilePhoto} stats={stats} goal={goal} setGoal={saveGoal} achievements={achievements} onShare={() => setShareOpen(true)} onSignIn={() => { setAuthMode('login'); setAuthOpen(true) }} /></ViewBoundary>}
            {view === 'notifications' && <ViewBoundary><NotificationsView notifications={notifications} unread={unread} dailyEmailEnabled={dailyEmailEnabled} setDailyEmailEnabled={setDailyEmailEnabled} user={user} onRead={async id => { if (!supabase || !user) return; const at = new Date().toISOString(); await supabase.from('notifications').update({ read_at: at }).eq('id', id).eq('user_id', user.uid); setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: at } : n)) }} /></ViewBoundary>}
            {view === 'settings' && <ViewBoundary><SettingsView dark={dark} setDark={setDark} user={user} notificationSoundEnabled={notificationSoundEnabled} setNotificationSoundEnabled={setNotificationSoundEnabled} onTestSound={() => { unlockNotificationAudio(); softNotificationChime() }} onSignIn={() => { setAuthMode('login'); setAuthOpen(true) }} /></ViewBoundary>}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>

    <SiteFooter />

    <AnimatePresence>
      {celebration && <motion.div initial={{ opacity: 0, y: -24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -18, scale: .97 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} className="pointer-events-none fixed left-1/2 top-[76px] z-[90] w-[min(360px,calc(100vw-24px))] -translate-x-1/2">
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500 px-4 py-3 text-white shadow-[0_18px_50px_-18px_rgba(16,185,129,.8)]">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">{celebration.icon}</div>
          <div className="min-w-0"><p className="text-sm font-black leading-5">{celebration.title}</p><p className="text-[11px] leading-4 text-white/80">{celebration.body}</p></div>
        </div>
      </motion.div>}
    </AnimatePresence>

    <footer className="border-t border-border/70 bg-card/45">
      <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-8 md:grid-cols-[1.4fr_.8fr_.8fr] md:px-8">
        <div><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={15} fill="currentColor" /></div><span className="text-sm font-black">GATE<span className="text-primary">PYQ</span></span></div><p className="mt-3 max-w-md text-xs leading-5 text-muted-foreground">A focused free workspace for solving, revising and understanding GATE CSE previous-year questions.</p></div>
        <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-muted-foreground">Explore</p><div className="mt-3 grid gap-2 text-xs"><button className="text-left hover:text-primary" onClick={() => navigate('home')}>Home</button><button className="text-left hover:text-primary" onClick={() => navigate('library')}>Questions</button><button className="text-left hover:text-primary" onClick={() => navigate('dashboard')}>Dashboard</button><button className="text-left hover:text-primary" onClick={() => navigate('leaderboard')}>Leaderboard</button></div></div>
        <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-muted-foreground">Study system</p><div className="mt-3 grid gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-500"/> Solve & track</span><span className="flex items-center gap-2"><RotateCcw size={13} className="text-amber-500"/> Revise weak areas</span><span className="flex items-center gap-2"><BarChart3 size={13} className="text-primary"/> Measure progress</span></div></div>
      </div>
      <div className="border-t border-border/60 px-5 py-4 text-center text-[10px] text-muted-foreground md:px-8">Free to use for GATE preparation · Your study trail stays tied to your account when cloud sync is enabled.</div>
    </footer>

    <Drawer.Root open={mobileOpen} onOpenChange={setMobileOpen} direction="left"><Drawer.Portal><Drawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" /><Drawer.Content className="fixed inset-y-0 left-0 z-50 w-[82vw] max-w-sm rounded-r-3xl border-r bg-card p-5 shadow-2xl"><Drawer.Title className="sr-only">Navigation</Drawer.Title><div className="mb-6 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><Zap size={18} fill="currentColor" /></div><div className="text-sm font-black">GATE<span className="text-primary">PYQ</span></div></div><div className="space-y-1">{navItems.map(item => <SideNav key={item.id} active={view === item.id} icon={item.icon} label={item.label} collapsed={false} badge={item.id === 'notifications' && unread ? String(unread) : undefined} onClick={() => navigate(item.id)} />)}</div></Drawer.Content></Drawer.Portal></Drawer.Root>
    <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} navigate={navigate} onOpenQuestion={id => { setSelectedId(id); setCommandOpen(false); navigate('library') }} questions={questions} />
    {authOpen && <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setAuthOpen(false)} />}
    {selectedQuestionOpen && selected && <QuestionLightbox question={selected} status={progress[selected.id] ?? 'unsolved'} reaction={reactions[selected.id] ?? null} counts={counts[selected.id] ?? { like: 0, dislike: 0 }} onStatus={updateStatus} onReaction={reactQuestion} onClose={() => setSelectedQuestionOpen(false)} onMove={move} selectedIndex={selectedIndex} total={filtered.length} user={user} setAuthOpen={setAuthOpen} setAuthMode={setAuthMode} confidence={confidence[selected.id] ?? null} onConfidence={setQuestionConfidence} />}
    {shareOpen && <ShareProgressModal stats={stats} goal={goal} subjectStats={subjectStats} user={user} onClose={() => setShareOpen(false)} />}
  </div>
}

function ViewBoundary({children}:{children:React.ReactNode}){return <ErrorBoundary FallbackComponent={({resetErrorBoundary})=><div className="m-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center"><ShieldCheck className="mx-auto text-destructive" size={24}/><p className="mt-2 text-sm font-semibold">This section could not be loaded.</p><p className="mt-1 text-xs text-muted-foreground">Your account and study data are safe. Try this section again.</p><Button className="mt-4" size="sm" onClick={resetErrorBoundary}>Retry section</Button></div>}>{children}</ErrorBoundary>}

function SideNav({ active, icon, label, collapsed, badge, onClick }: { active:boolean; icon:React.ReactNode; label:string; collapsed:boolean; badge?:string; onClick:()=>void }) {
  return <button onClick={onClick} title={collapsed ? label : undefined} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${active ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}><span className={active ? 'text-primary' : 'group-hover:text-foreground'}>{icon}</span>{!collapsed && <><span className="min-w-0 flex-1 truncate font-medium">{label}</span>{badge && <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold">{badge}</span>}</>}</button>
}

function AnimatedGlowCard({children,className='',scrollFlip=false}:{children:React.ReactNode;className?:string;scrollFlip?:boolean}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollFlip) return
    const node = ref.current
    if (!node) return
    let frame = 0
    const update = () => {
      frame = 0
      const rect = node.getBoundingClientRect()
      const viewport = window.innerHeight || 800
      const start = viewport * 0.88
      const end = viewport * 0.28
      const progress = Math.max(0, Math.min(1, (start - rect.top) / (start - end)))
      node.style.setProperty('--hero-scroll-progress', progress.toFixed(4))
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [scrollFlip])
  return <div ref={ref} className={`glow-card ${scrollFlip ? 'scroll-flip-card' : ''} ${className}`}>
    <svg className="glow-card__orbit" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="goldBeam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="22%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="78%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <filter id="goldGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="0.75" result="blur1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur2" />
          <feMerge><feMergeNode in="blur2"/><feMergeNode in="blur1"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect className="glow-card__orbit-base" x="1" y="1" width="98" height="98" rx="5" pathLength="100" />
      <rect className="glow-card__orbit-glow" x="1" y="1" width="98" height="98" rx="5" pathLength="100" filter="url(#goldGlow)" />
      <rect className="glow-card__orbit-beam" x="1" y="1" width="98" height="98" rx="5" pathLength="100" filter="url(#goldGlow)" />
    </svg>
    <div className="glow-card__inner">{children}</div>
  </div>
}

function HomeView({ stats, user, qotd, revisionQueue, goal, achievements, onStart, onDashboard, onSignIn, onOpenQuestion, onShare }: { stats:UserStats; user:User|null; qotd:Question; revisionQueue:Question[]; goal:{type:string;value:number}; achievements:{id:string;label:string;icon:React.ReactNode;unlocked:boolean}[]; onStart:()=>void; onDashboard:()=>void; onSignIn:()=>void; onOpenQuestion:(id:string)=>void; onShare:()=>void }) {
  const features = [{ icon:<Target size={18}/>, title:'Solve loop', body:'Open, solve, mark, move. Your study trail stays intact.' },{ icon:<CloudIcon/>, title:'Cloud memory', body:'Progress and reactions follow your account across devices.' },{ icon:<Gauge size={18}/>, title:'Performance cockpit', body:'See coverage, accuracy, streaks and subject signals at a glance.' }]
  return <div className="space-y-8 px-4 py-8 md:px-8 md:py-10 xl:px-10">
    <AnimatedGlowCard scrollFlip className="rounded-[2rem]">
      <section className="relative overflow-hidden rounded-[2rem] border bg-card/95 p-7 shadow-[0_30px_90px_-45px_hsl(var(--primary)/.45)] md:p-10 xl:p-14">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"/><div className="absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl"/>
        <div className="relative grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center"><div><Badge variant="outline" className="gap-2 border-primary/25 bg-primary/5 text-primary"><Sparkles size={13}/> YOUR GATE STUDY HQ</Badge><h1 className="mt-5 max-w-3xl text-4xl font-black tracking-[-.04em] md:text-6xl">Turn thousands of PYQs into a <span className="text-primary">repeatable system.</span></h1><p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">A focused workspace for solving, reviewing and measuring GATE CSE PYQs without losing the thread between sessions.</p><div className="mt-7 flex flex-wrap gap-3"><Button size="sm" onClick={onStart}><BookOpen size={16}/> Start solving</Button><Button size="sm" variant="outline" onClick={onDashboard}><BarChart3 size={16}/> View dashboard</Button><Button size="sm" variant="ghost" onClick={onShare}><Share2 size={16}/> Share progress</Button>{!user && <Button size="sm" variant="ghost" onClick={onSignIn}><LogIn size={16}/> Create your cloud account</Button>}</div><div className="mt-8 flex flex-wrap items-center gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-500"/> {stats.solved} solved</span><span className="flex items-center gap-2"><Flame size={15} className="text-orange-500"/> {stats.streak} day streak</span><span className="flex items-center gap-2"><Target size={15} className="text-primary"/> {stats.accuracy}% accuracy</span></div></div><div className="grid gap-3 sm:grid-cols-2"><HeroStat label="PYQ bank" value={questions.length} icon={<BookOpen size={18}/>} /><HeroStat label="Coverage" value={stats.completion} suffix="%" icon={<CircleGauge size={18}/>} /><HeroStat label="Solved" value={stats.solved} icon={<Check size={18}/>} /><HeroStat label="Streak" value={stats.streak} suffix="d" icon={<Flame size={18}/>} /></div></div>
      </section>
    </AnimatedGlowCard>

    <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Card className="rounded-2xl border-primary/15 bg-primary/[.035]"><CardHeader><div className="flex items-center justify-between"><div><Badge variant="outline" className="border-primary/25 text-primary">QUESTION OF THE DAY</Badge><CardTitle className="mt-3 text-xl">One question. Zero excuses. ☕</CardTitle><CardDescription>Make today's rep before you disappear into the syllabus.</CardDescription></div><Badge variant="secondary">Daily</Badge></div></CardHeader><CardContent><button onClick={()=>onOpenQuestion(qotd.id)} className="w-full rounded-2xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary"><span>{qotd.subject}</span><span>•</span><span>{qotd.topic}</span></div><p className="mt-2 text-sm font-bold">{qotd.displayId ?? qotd.id} · {qotd.source}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">Open the focused viewer and solve the complete original question.</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary">Solve today's question <ArrowRight size={14}/></span></button></CardContent></Card>
      <Card className="rounded-2xl"><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-xl">Revision queue</CardTitle><CardDescription>Questions that deserve another look.</CardDescription></div><Badge variant="secondary">{revisionQueue.length}</Badge></div></CardHeader><CardContent>{revisionQueue.length?<div className="space-y-2">{revisionQueue.slice(0,4).map(q=><button key={q.id} onClick={()=>onOpenQuestion(q.id)} className="flex w-full items-center gap-3 rounded-xl border bg-background/60 p-3 text-left hover:bg-accent"><RotateCcw size={15} className="shrink-0 text-amber-500"/><span className="min-w-0 flex-1"><b className="block truncate text-xs">{q.displayId} · {q.topic}</b><span className="block truncate text-[10px] text-muted-foreground">{q.source}</span></span><ChevronRight size={14}/></button>)}</div>:<EmptyState text="Solve a few questions and your revision queue will appear here."/>}</CardContent></Card>
    </div>

    <div className="grid gap-4 md:grid-cols-3"><Card className="rounded-2xl md:col-span-2"><CardHeader><CardTitle>Preparation snapshot</CardTitle><CardDescription>Keep the next target visible, not buried in a spreadsheet.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border bg-background/60 p-4"><Target className="text-primary" size={18}/><p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Goal</p><p className="mt-1 text-lg font-black">{goal.type}</p></div><div className="rounded-2xl border bg-background/60 p-4"><Trophy className="text-primary" size={18}/><p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Badges</p><p className="mt-1 text-lg font-black">{achievements.filter(a=>a.unlocked).length} / {achievements.length}</p></div><div className="rounded-2xl border bg-background/60 p-4"><BrainCircuit className="text-primary" size={18}/><p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">Revision</p><p className="mt-1 text-lg font-black">{revisionQueue.length} due</p></div></CardContent></Card><div className="grid gap-4"><FeaturePill icon={<Database size={16}/>} title="Fast cached data"/><FeaturePill icon={<Wifi size={16}/>} title="Lazy PDF rendering"/></div></div>
    <div className="grid gap-4 md:grid-cols-3">{features.map((f,i)=><motion.div key={f.title} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:i*.06}}><Card className="h-full rounded-2xl"><CardContent className="p-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">{f.icon}</div><h3 className="mt-4 font-bold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{f.body}</p></CardContent></Card></motion.div>)}</div>
    <TopSolversStrip />
  </div>
}

function HeroStat({label,value,suffix='',icon}:{label:string;value:number; suffix?:string; icon:React.ReactNode}) { return <motion.div whileHover={{y:-3}} className="rounded-2xl border bg-background/70 p-5 shadow-sm"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-semibold">{label}</span><span className="text-primary">{icon}</span></div><div className="mt-4 text-3xl font-black tracking-tight tabular-nums"><AnimatedNumber value={value} suffix={suffix}/></div></motion.div> }
function CloudIcon(){return <Wifi size={18}/>} 

function LibraryView(props: any) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({ count: props.filtered.length, getScrollElement: () => parentRef.current, estimateSize: () => 76, overscan: 8 })
  const topicOptions = ['All topics', ...(topicsBySubject.get(props.subject) ?? allTopics)]
  const [focusMode, setFocusMode] = useState(false)
  const previousSidebar = useRef<boolean | null>(null)
  const toggleFocus = () => {
    if (focusMode) {
      setFocusMode(false)
      if (previousSidebar.current !== null) props.setSidebar(previousSidebar.current)
      previousSidebar.current = null
    } else {
      previousSidebar.current = props.sidebar
      props.setSidebar(false)
      setFocusMode(true)
    }
  }
  useEffect(() => () => {
    if (previousSidebar.current !== null) props.setSidebar(previousSidebar.current)
  }, [])
  return <div className={`px-4 py-6 md:px-7 md:py-8 xl:px-10 ${focusMode ? 'solve-focus-mode' : ''}`}><div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><BookOpen size={13}/> QUESTION LIBRARY</Badge><h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Pick a question. Enter solve mode.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Fast search, virtualized lists and lazy PDF crops keep the library snappy even with thousands of questions.</p></div><div className="grid grid-cols-4 gap-2"><MiniMetric label="Attempted" value={Object.values(props.progress as Record<string, Status>).filter((v:Status)=>v!=='unsolved').length}/><MiniMetric label="Solved" value={Object.values(props.progress as Record<string, Status>).filter((v:Status)=>v==='solved').length}/><MiniMetric label="Wrong" value={Object.values(props.progress as Record<string, Status>).filter((v:Status)=>v==='wrong').length}/><MiniMetric label="Important" value={Object.values(props.progress as Record<string, Status>).filter((v:Status)=>v==='important').length}/></div></div>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={17}/><Input value={props.query} onChange={e=>props.setQuery(e.target.value)} className="h-11 pl-10" placeholder="Search year, topic, source, tag, ID…"/></div><Button variant={props.showFilters?'secondary':'outline'} onClick={()=>props.setShowFilters((v:boolean)=>!v)} className="h-11"><SlidersHorizontal size={15}/> Filters <ChevronDown size={14}/></Button><Badge variant="secondary" className="h-11 justify-center rounded-md px-4">{props.filtered.length.toLocaleString()} matches</Badge></div>
    {props.showFilters && <Card className="mb-4 rounded-2xl"><CardContent className="grid gap-3 p-4 md:grid-cols-4"><FilterSelect label="Volume" value={props.volume} options={['all','v1','v2','v3']} labels={{v1:'Volume 1',v2:'Volume 2',v3:'Volume 3'}} onChange={props.setVolume}/><FilterSelect label="Subject" value={props.subject} options={['All subjects',...subjects]} onChange={(v:string)=>{props.setSubject(v);props.setTopic('All topics')}}/><FilterSelect label="Topic" value={props.topic} options={topicOptions} onChange={props.setTopic}/><FilterSelect label="Status" value={props.statusFilter} options={['all',...(Object.keys(statusMeta) as Status[])]} onChange={props.setStatusFilter}/></CardContent></Card>}
    <div className="question-solve-layout grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      {props.selected && <div className="question-player min-w-0"><QuestionWorkspace {...props} focusMode={focusMode} onToggleFocus={toggleFocus}/></div>}
      <Card className="question-playlist overflow-hidden rounded-2xl xl:sticky xl:top-20 xl:self-start"><CardHeader className="border-b p-4"><div className="flex items-center justify-between"><div><CardTitle className="text-sm">Question bank</CardTitle><CardDescription className="mt-1 text-[11px]">Virtualized rendering • only nearby rows exist in the DOM.</CardDescription></div><Badge variant="outline">{props.filtered.length}</Badge></div></CardHeader><div ref={parentRef} className="h-[calc(100vh-300px)] min-h-[420px] overflow-auto"><div style={{height:rowVirtualizer.getTotalSize(),position:'relative',width:'100%'}}>{rowVirtualizer.getVirtualItems().map(item=>{const q=props.filtered[item.index];return <div key={q.id} ref={rowVirtualizer.measureElement} data-index={item.index} style={{position:'absolute',top:0,left:0,width:'100%',transform:`translateY(${item.start}px)`}}><QuestionRow question={q} selected={props.selected?.id===q.id} status={props.progress[q.id]??'unsolved'} onSelect={props.onSelect}/></div>})}</div>{!props.filtered.length&&<div className="grid h-full place-items-center p-8 text-center"><Search className="text-primary" size={24}/><p className="mt-3 text-sm font-semibold">No questions found</p><p className="mt-1 text-xs text-muted-foreground">Try a different filter.</p></div>}</div></Card>
    </div>
  </div>
}

function AnimatedNumber({ value, suffix = '', duration = 700, className = '' }: { value: number; suffix?: string; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0)
  const previous = useRef(0)
  useEffect(() => {
    const from = previous.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
      else previous.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <motion.span className={className} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>{display.toLocaleString()}{suffix}</motion.span>
}

function QuestionActionBar({ question, reaction, counts, status, onReaction, onStatus, user, onSignIn, onComments }: any) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = `${window.location.origin}/?question=${encodeURIComponent(question.id)}`
    try {
      if (navigator.share) await navigator.share({ title: question.displayId ?? question.id, url })
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    } catch { /* share dismissed */ }
  }
  const copyLink = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/?question=${encodeURIComponent(question.id)}`); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch {} }
  const save = () => onStatus(status === 'important' ? 'unsolved' : 'important')
  return <div className="mt-4 rounded-2xl border bg-card/90 p-2 shadow-sm">
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex items-center overflow-hidden rounded-full border bg-background">
        <button type="button" onClick={() => onReaction('like')} className={`inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${reaction === 'like' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`} aria-label="Like question"><ThumbsUp size={16} strokeWidth={2}/><AnimatedNumber value={counts.like}/></button>
        <span className="h-5 w-px bg-border" />
        <button type="button" onClick={() => onReaction('dislike')} className={`inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${reaction === 'dislike' ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`} aria-label="Dislike question"><ThumbsDown size={16} strokeWidth={2}/><AnimatedNumber value={counts.dislike}/></button>
      </div>
      <button type="button" onClick={onComments} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-accent"><MessageCircle size={16}/> Comments</button>
      <button type="button" onClick={share} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-accent"><Share2 size={16}/> Share</button>
      <button type="button" onClick={save} className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-accent ${status === 'important' ? 'border-primary/30 bg-primary/10 text-primary' : ''}`}><BookmarkCheck size={16}/> {status === 'important' ? 'Saved' : 'Save'}</button>
      <div className="ml-auto flex items-center gap-1">
        {question.qrUrl && <a href={question.qrUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-primary hover:bg-primary/10"><ExternalLink size={15}/> GateOverflow</a>}
        <button type="button" onClick={copyLink} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent" title={copied ? 'Copied' : 'Copy link'}>{copied ? <CheckCheck size={16} className="text-emerald-500"/> : <Link2 size={16}/>}</button>
        <button type="button" onClick={() => toast('More question actions are coming soon.')} className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent" title="More"><MoreHorizontal size={17}/></button>
      </div>
    </div>
    <div className="mt-1.5 flex items-center gap-2 px-2 text-[10px] text-muted-foreground"><span>{user ? 'Your reaction is synced to your account.' : 'Sign in to sync your reaction.'}</span>{!user && <button onClick={onSignIn} className="font-semibold text-primary hover:underline">Sign in</button>}</div>
  </div>
}

function QuestionDiscussion({ question, user, onSignIn }: { question: Question; user: User | null; onSignIn: () => void }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [comments, setComments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const load = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.from('question_comments').select('id,user_id,author_name,body,created_at,updated_at').eq('question_id', question.id).order('created_at', { ascending: false }).limit(50)
    if (!error) {
      const rows = data ?? []
      const ids = [...new Set(rows.map((r:any)=>r.user_id))]
      const profiles = ids.length ? await supabase.from('profiles').select('id,display_name,avatar_url,verified').in('id', ids) : { data: [], error: null }
      const profileMap = new Map((profiles.data ?? []).map((p:any)=>[p.id,p]))
      setComments(rows.map((r:any)=>({ ...r, profile: profileMap.get(r.user_id) })))
    }
    setLoading(false)
  }
  useEffect(() => { if (open) void load() }, [open, question.id])
  const submit = async () => {
    if (!user) { onSignIn(); return }
    const text = body.trim(); if (!text || !supabase) return
    setSending(true)
    const { data, error } = await supabase.from('question_comments').insert({ question_id: question.id, user_id: user.uid, author_name: user.displayName || user.email?.split('@')[0] || 'GATE Learner', body: text }).select('id,user_id,author_name,body,created_at,updated_at').single()
    if (error) toast.error('Could not post your comment. Please try again.')
    else {
      setComments(prev => [{ ...data, profile: { id:user.uid, display_name:user.displayName, avatar_url:user.photoURL, verified:user.emailVerified } }, ...prev]); setBody('')
    }
    setSending(false)
  }
  const saveEdit = async (id:string) => {
    if (!user || !supabase) return
    const text=editingBody.trim(); if(!text) return
    const { data, error } = await supabase.from('question_comments').update({ body:text, updated_at:new Date().toISOString() }).eq('id',id).eq('user_id',user.uid).select('id,user_id,author_name,body,created_at,updated_at').single()
    if(error) toast.error('Could not update the comment. Please try again.')
    else { setComments(prev=>prev.map(c=>c.id===id?{...c,...data}:c)); setEditingId(null); setEditingBody('') }
  }
  const remove = async (id:string) => {
    if (!user || !supabase || !window.confirm('Delete this comment?')) return
    const { error } = await supabase.from('question_comments').delete().eq('id',id).eq('user_id',user.uid)
    if(error) toast.error('Could not delete the comment. Please try again.')
    else setComments(prev=>prev.filter(c=>c.id!==id))
  }
  return <div className="mt-2 rounded-2xl border bg-background/70 p-3">
    <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between px-1 py-1 text-left"><span className="flex items-center gap-2 text-sm font-bold"><MessageCircle size={16} className="text-primary"/> Discussion</span><span className="text-[11px] text-muted-foreground">{open ? 'Hide' : 'Open comments'}</span></button>
    <AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="mt-3 flex gap-2"><input value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }} placeholder={user ? 'Add a comment or explanation…' : 'Sign in to join the discussion'} className="h-9 min-w-0 flex-1 rounded-full border bg-background px-4 text-xs outline-none focus:ring-2 focus:ring-ring"/><button type="button" onClick={()=>void submit()} disabled={sending || !body.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send size={15}/></button></div>{loading ? <p className="p-5 text-center text-xs text-muted-foreground">Loading discussion…</p> : comments.length ? <div className="mt-3 space-y-2">{comments.map(c => { const mine = user?.uid===c.user_id; const profile=c.profile; const name=profile?.display_name||c.author_name||'GATE Learner'; return <div key={c.id} className="rounded-xl border bg-card p-3"><div className="flex items-start gap-2"><Avatar photo={profile?.avatar_url||''} name={name}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="text-xs font-semibold">{name}</p>{profile?.verified&&<BadgeCheck size={14} className="text-sky-500" aria-label="Verified"/>}</div><p className="text-[9px] text-muted-foreground">{format(new Date(c.created_at), 'dd MMM yyyy · hh:mm a')}{c.updated_at && c.updated_at!==c.created_at?' · edited':''}</p></div>{mine&&<div className="flex items-center gap-1"><button type="button" className="grid h-7 w-7 place-items-center rounded-full hover:bg-accent" title="Edit" aria-label="Edit comment" onClick={()=>{setEditingId(c.id);setEditingBody(c.body)}}><Pencil size={13}/></button><button type="button" className="grid h-7 w-7 place-items-center rounded-full text-destructive hover:bg-destructive/10" title="Delete" aria-label="Delete comment" onClick={()=>void remove(c.id)}><Trash2 size={13}/></button></div>}</div>{editingId===c.id?<div className="mt-2 flex gap-2"><input value={editingBody} onChange={e=>setEditingBody(e.target.value)} className="h-9 min-w-0 flex-1 rounded-full border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"/><Button size="sm" onClick={()=>void saveEdit(c.id)}>Save</Button><Button size="sm" variant="outline" onClick={()=>{setEditingId(null);setEditingBody('')}}>Cancel</Button></div>:<p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground/90">{c.body}</p>}</div> })}</div> : <p className="p-5 text-center text-xs text-muted-foreground">No comments yet. Be the first to explain the solution.</p>}</motion.div>}</AnimatePresence>
  </div>
}

function ConfidencePicker({value,onChange}:{value:'guess'|'unsure'|'confident'|null;onChange:(v:'guess'|'unsure'|'confident')=>void}) {
  const items=[['guess','Guess',CircleHelp],['unsure','Unsure',BrainCircuit],['confident','Confident',CheckCircle2]] as const
  return <div className="rounded-2xl border bg-background/60 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">How confident were you?</p><p className="mt-0.5 text-[10px] text-muted-foreground">Track confidence separately from correctness.</p></div><Gauge size={16} className="text-primary"/></div><div className="mt-2 grid grid-cols-3 gap-2">{items.map(([id,label,Icon])=><button key={id} onClick={()=>onChange(id)} className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[10px] font-bold transition ${value===id?'border-primary/40 bg-primary/10 text-primary':'hover:bg-accent'}`}><Icon size={14}/>{label}</button>)}</div></div>
}

function QuestionWorkspace({selected, selectedIndex, filtered, progress, reactions, counts, onStatus, onReaction, onMove, user, setAuthOpen, setAuthMode, openQuestion, confidence, onConfidence, focusMode, onToggleFocus}: any) {
  const signIn = () => { setAuthMode('login'); setAuthOpen(true) }
  return <Card className="min-w-0 overflow-hidden rounded-2xl"><CardHeader className="border-b p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-primary"><span>{selected.subject}</span><span className="text-muted-foreground">•</span><span>{selected.topic}</span></div><div className="mt-2 flex flex-wrap items-center gap-2"><CardTitle className="text-2xl">{selected.displayId??selected.id}</CardTitle><Badge variant="secondary">{volumeLabels[selected.volume]}</Badge></div><CardDescription className="mt-1 truncate">{selected.source}</CardDescription></div><div className="flex shrink-0 items-center gap-2"><Badge variant="outline">{selectedIndex+1} / {filtered.length}</Badge><Button variant="outline" size="icon" onClick={onToggleFocus} title={focusMode ? 'Exit focus mode' : 'Expand question'} aria-label={focusMode ? 'Exit focus mode' : 'Expand question'}>{focusMode ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</Button></div></div></CardHeader><CardContent className="p-4 md:p-5"><div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]"><div><div className="question-paper overflow-hidden rounded-2xl border bg-white shadow-inner"><PdfQuestion question={selected}/></div><QuestionActionBar question={selected} reaction={reactions[selected.id] ?? null} counts={counts[selected.id] ?? { like: 0, dislike: 0 }} status={progress[selected.id] ?? 'unsolved'} onReaction={onReaction} onStatus={onStatus} user={user} onSignIn={signIn} onComments={() => document.getElementById(`discussion-${selected.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}/><div id={`discussion-${selected.id}`}><QuestionDiscussion question={selected} user={user} onSignIn={signIn}/></div></div><div className="space-y-3"><ConfidencePicker value={confidence?.[selected.id] ?? null} onChange={onConfidence}/><Card className="rounded-2xl bg-background"><CardContent className="p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">Your study status</p><span className="hidden text-[10px] text-muted-foreground sm:block">Saved permanently</span></div><div className="mt-3 flex items-center justify-center gap-2">{(Object.keys(statusMeta) as Status[]).map(s=><Button key={s} variant="ghost" size="icon" title={statusMeta[s].label} aria-label={statusMeta[s].label} className={`h-9 w-9 rounded-full border ${statusMeta[s].cls} ${(progress[selected.id]??'unsolved')===s?'border-primary/40 bg-primary/10 shadow-sm':'hover:bg-accent'}`} onClick={()=>onStatus(s)}>{statusMeta[s].icon}</Button>)}</div></CardContent></Card><div className="rounded-2xl border bg-primary/[.045] p-4"><div className="flex items-start gap-3"><ExternalLink size={17} className="mt-0.5 text-primary"/><div className="min-w-0"><p className="text-sm font-bold">Exact GateOverflow thread</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">The link comes from this question's source metadata.</p>{selected.qrUrl?<a className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-primary hover:underline" href={selected.qrUrl} target="_blank" rel="noreferrer">Open exact question <ArrowUpRight size={13}/></a>:<span className="mt-2 block text-xs text-muted-foreground">No source URL recorded.</span>}</div></div></div><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={()=>onMove(-1)} disabled={selectedIndex<=0}><ArrowLeft size={15}/> Previous</Button><Button variant="outline" onClick={()=>onMove(1)} disabled={selectedIndex>=filtered.length-1}>Next <ArrowRight size={15}/></Button></div><Button className="w-full" onClick={openQuestion}><Eye size={15}/> Open focused viewer</Button>{!user&&<button className="w-full text-center text-[11px] font-semibold text-primary" onClick={signIn}>Sign in to keep this trail across devices</button>}</div></div></CardContent></Card>
}

function QuestionLightbox({question,status,reaction,counts,onStatus,onReaction,onClose,onMove,selectedIndex,total,user,setAuthOpen,setAuthMode,confidence,onConfidence}:{question:Question;status:Status;reaction:Reaction;counts:{like:number;dislike:number};onStatus:(s:Status)=>void;onReaction:(r:Exclude<Reaction,null>)=>void;onClose:()=>void;onMove:(d:number)=>void;selectedIndex:number;total:number;user:User|null;setAuthOpen:(v:boolean)=>void;setAuthMode:(m:'login'|'signup')=>void;confidence:'guess'|'unsure'|'confident'|null;onConfidence:(v:'guess'|'unsure'|'confident')=>void}) {
  const signIn = () => { setAuthMode('login'); setAuthOpen(true) }
  return <div className="fixed inset-0 z-[60] bg-background/95 p-2 backdrop-blur-xl sm:p-3 md:p-6"><div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl"><div className="flex items-center gap-3 border-b px-3 py-2 md:px-6 md:py-3"><Button variant="ghost" size="icon" onClick={onClose}><X size={18}/></Button><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{question.displayId??question.id} · {question.subject}</p><p className="truncate text-[11px] text-muted-foreground">{question.source}</p></div><Badge variant="outline">{selectedIndex+1} / {total}</Badge></div><div className="min-h-0 flex-1 overflow-auto p-2 sm:p-3 md:p-6"><div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-inner"><PdfQuestion question={question}/></div><div className="mx-auto max-w-5xl"><QuestionActionBar question={question} reaction={reaction} counts={counts} status={status} onReaction={onReaction} onStatus={onStatus} user={user} onSignIn={signIn} onComments={() => document.getElementById(`lightbox-discussion-${question.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}/><div className="mt-2"><ConfidencePicker value={confidence} onChange={onConfidence}/></div><div id={`lightbox-discussion-${question.id}`}><QuestionDiscussion question={question} user={user} onSignIn={signIn}/></div></div></div><div className="flex justify-between gap-2 border-t px-3 py-2 md:px-6 md:py-3"><Button variant="outline" onClick={()=>onMove(-1)} disabled={selectedIndex<=0}><ArrowLeft size={15}/> Previous</Button><Button variant="outline" onClick={()=>onMove(1)} disabled={selectedIndex>=total-1}>Next <ArrowRight size={15}/> </Button></div></div></div>
}

function QuestionRow({question,selected,status,onSelect}:{question:Question;selected:boolean;status:Status;onSelect:(id:string)=>void}) { return <button onClick={() => onSelect(question.id)} className={`w-full border-b px-4 py-3 text-left transition-colors ${selected?'bg-primary/10':'hover:bg-accent/70'}`}><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${selected?'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`}><BookOpen size={14}/></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><b className="font-mono text-[11px]">{question.displayId??question.id}</b><span className="truncate text-[10px] text-muted-foreground">{question.source}</span></span><span className="mt-1 block truncate text-xs font-medium">{question.topic}</span></span><span className={safeStatusMeta(status).cls}>{safeStatusMeta(status).icon}</span></div></button> }

function PdfQuestion({question}:{question:Question}) { const segments = Array.isArray(question.segments) ? question.segments : []; if (!segments.length) return <div className="grid min-h-32 place-items-center p-6 text-center text-xs text-muted-foreground">Question image is temporarily unavailable.</div>; return <div>{segments.map((s,i)=><Crop key={`${question.id}-${i}`} segment={s}/>)}</div> }
function Crop({segment}:{segment:any}) { const ref=useRef<HTMLCanvasElement>(null); useEffect(()=>{if(ref.current)renderCrop(ref.current,segment).catch(()=>{})},[segment]); return <canvas ref={ref} className="mx-auto"/> }

function ActivityChart({activity}:{activity:{label:string;count:number}[]}){const max=Math.max(1,...activity.map(x=>x.count));return <div className="h-48 w-full"><div className="flex h-40 items-end gap-1.5 sm:gap-2">{activity.map((x,i)=><div key={`${x.label}-${i}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${x.count} study touches`}><div className="w-full max-w-7 rounded-t-md bg-primary/70 transition-[height] duration-300 group-hover:bg-primary" style={{height:`${Math.max(5,(x.count/max)*100)}%`}}/><span className="text-[9px] text-muted-foreground">{x.label.slice(0,2)}</span></div>)}</div></div>}

function DashboardView({questions,progress,progressDates,subjectStats,topicStats,confidence,stats,goal,setGoal,revisionQueue,achievements,onOpenQuestion,onShare}:{questions:Question[];progress:Record<string,Status>;progressDates:Record<string,string>;subjectStats:any[];topicStats:any[];confidence:Record<string,'guess'|'unsure'|'confident'>;stats:UserStats;goal:{type:string;value:number};setGoal:(g:{type:string;value:number})=>void;revisionQueue:Question[];achievements:{id:string;label:string;icon:React.ReactNode;unlocked:boolean}[];onOpenQuestion:(id:string)=>void;onShare:()=>void}) {
  const recent=questions.filter(q=>progress[q.id]&&progress[q.id]!=='unsolved').slice(-10).reverse()
  const activity=Array.from({length:14},(_,i)=>{const day=subDays(new Date(),13-i);const key=format(day,'yyyy-MM-dd');return {label:format(day,'EEE'),count:Object.values(progressDates).filter(d=>format(new Date(d),'yyyy-MM-dd')===key).length}})
  const goalOptions=[['AIR < 100','100'],['AIR < 500','500'],['AIR < 1000','1000'],['Qualify GATE','0']] as const
  return <div className="space-y-5 px-4 py-7 md:px-7 md:py-8 xl:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><BarChart3 size={13}/> PERSONAL ANALYTICS</Badge><h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Your preparation cockpit</h1><p className="mt-2 text-sm text-muted-foreground">Solve, measure, revise, repeat.</p></div><Button variant="outline" onClick={onShare}><Share2 size={15}/> Share progress</Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><StatCard label="Solved" value={stats.solved} icon={<Check size={17}/>} tone="emerald"/><StatCard label="Attempted" value={stats.attempted} icon={<Target size={17}/>} tone="primary"/><StatCard label="Accuracy" value={`${stats.accuracy}%`} icon={<TrendingUp size={17}/>} tone="violet"/><StatCard label="Redo" value={stats.redo} icon={<RotateCcw size={17}/>} tone="amber"/><StatCard label="Streak" value={`${stats.streak}d`} icon={<Flame size={17}/>} tone="orange"/></div><div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]"><Card className="rounded-2xl"><CardHeader><CardTitle>14-day solving rhythm</CardTitle><CardDescription>Every status update counts as a study touch.</CardDescription></CardHeader><CardContent><ActivityChart activity={activity}/></CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Target</CardTitle><CardDescription>Pick the goal you want visible every day.</CardDescription></CardHeader><CardContent><div className="grid grid-cols-2 gap-2">{goalOptions.map(([label,value])=><button key={label} onClick={()=>setGoal({type:label,value:Number(value)})} className={`rounded-xl border p-3 text-left text-xs font-bold transition ${goal.type===label?'border-primary/40 bg-primary/10 text-primary':'hover:bg-accent'}`}>{label}</button>)}</div><div className="mt-4 rounded-2xl border bg-background/60 p-4"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Current target</p><p className="mt-1 text-2xl font-black">{goal.type}</p><p className="mt-1 text-xs text-muted-foreground">Keep this target visible while you build your question volume and accuracy.</p></div></CardContent></Card></div><div className="grid gap-4 xl:grid-cols-2"><Card className="rounded-2xl"><CardHeader><CardTitle>Confidence map</CardTitle><CardDescription>Separate how sure you felt from whether you were right.</CardDescription></CardHeader><CardContent className="grid grid-cols-3 gap-2"><ConfidenceSummary label="Guess" value={Object.values(confidence).filter(v=>v==='guess').length}/><ConfidenceSummary label="Unsure" value={Object.values(confidence).filter(v=>v==='unsure').length}/><ConfidenceSummary label="Confident" value={Object.values(confidence).filter(v=>v==='confident').length}/></CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Revision queue</CardTitle><CardDescription>{revisionQueue.length} questions currently deserve another pass.</CardDescription></CardHeader><CardContent className="space-y-2">{revisionQueue.slice(0,6).map(q=><button key={q.id} onClick={()=>onOpenQuestion(q.id)} className="flex w-full items-center gap-3 rounded-xl border bg-background/60 p-3 text-left hover:bg-accent"><RotateCcw size={14} className="text-amber-500"/><span className="min-w-0 flex-1"><b className="block truncate text-xs">{q.displayId} · {q.topic}</b><span className="text-[10px] text-muted-foreground">{q.source}</span></span><ArrowRight size={14}/></button>)}{!revisionQueue.length&&<EmptyState text="Your revision queue is clear."/>}</CardContent></Card></div><div className="grid gap-4 xl:grid-cols-2"><Card className="rounded-2xl"><CardHeader><CardTitle>Weakest topics</CardTitle><CardDescription>Low-accuracy areas rise to the top.</CardDescription></CardHeader><CardContent className="space-y-3">{topicStats.length?topicStats.map(s=><div key={s.name} className="grid grid-cols-[minmax(0,1fr)_60px] gap-3 items-center"><div><div className="flex justify-between text-xs"><span className="truncate font-semibold">{s.name}</span><span className="text-muted-foreground">{s.attempted}</span></div><Progress value={s.accuracy} className="mt-1.5 h-1.5"/></div><span className="text-right text-sm font-black">{s.accuracy}%</span></div>):<EmptyState text="Attempt questions to reveal weak topics."/>}</CardContent></Card></div><Card className="rounded-2xl"><CardHeader><CardTitle>Subject-wise performance</CardTitle><CardDescription>Coverage and accuracy across your active subjects.</CardDescription></CardHeader><CardContent className="space-y-4">{subjectStats.slice(0,14).map(s=><div key={s.name} className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_100px_70px] sm:items-center"><div><div className="flex justify-between text-xs"><span className="font-semibold">{s.name}</span><span className="text-muted-foreground">{s.attempted}/{s.total}</span></div><Progress value={s.total?s.attempted/s.total*100:0} className="mt-1.5 h-1.5"/></div><span className="text-xs text-muted-foreground">Solved <b className="text-foreground">{s.solved}</b></span><span className="text-right text-sm font-bold">{s.accuracy}%</span></div>)}</CardContent></Card><div className="grid gap-4 lg:grid-cols-2"><Card className="rounded-2xl"><CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Your latest touched questions.</CardDescription></CardHeader><CardContent className="space-y-1">{recent.length?recent.map(q=><button key={q.id} onClick={()=>onOpenQuestion(q.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-accent"><span className="font-mono text-[10px] text-primary">{q.id}</span><span className="min-w-0 flex-1 truncate text-xs">{q.topic}</span><Badge variant="outline" className={safeStatusMeta(progress[q.id]).cls}>{safeStatusMeta(progress[q.id]).label}</Badge></button>):<EmptyState text="Start solving questions and this panel will fill itself."/>}</CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Achievements</CardTitle><CardDescription>Small milestones, long preparation.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">{achievements.map(a=><div key={a.id} className={`rounded-2xl border p-3 ${a.unlocked?'border-primary/30 bg-primary/[.06]':'opacity-50'}`}><div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">{a.icon}</div><p className="mt-2 text-[10px] font-bold">{a.label}</p><p className="mt-1 text-[9px] text-muted-foreground">{a.unlocked?'Unlocked':'Locked'}</p></div>)}</CardContent></Card></div></div>
}

function ConfidenceSummary({label,value}:{label:string;value:number}){return <div className="rounded-2xl border bg-background/60 p-4 text-center"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></div>}
function StatCard({label,value,icon,tone}:{label:string;value:string|number;icon:React.ReactNode;tone:string}){return <motion.div whileHover={{y:-2}}><Card className="rounded-2xl"><CardContent className="p-5"><div className={`flex items-center gap-2 text-sm ${tone==='emerald'?'text-emerald-500':tone==='amber'?'text-amber-500':tone==='orange'?'text-orange-500':tone==='violet'?'text-violet-500':'text-primary'}`}>{icon}{label}</div><div className="mt-3 text-3xl font-black">{value}</div></CardContent></Card></motion.div>}
function MiniMetric({label,value}:{label:string;value:number}){return <div className="rounded-xl border bg-card px-3 py-2 text-center"><div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-lg font-black tabular-nums"><AnimatedNumber value={value}/></div></div>}
function FilterSelect({label,value,options,labels,onChange}:{label:string;value:string;options:string[];labels?:Record<string,string>;onChange:(v:string)=>void}){return <label className="grid gap-1.5 text-xs font-semibold"><span className="text-muted-foreground">{label}</span><Select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{labels?.[o]??o}</option>)}</Select></label>}
function EmptyState({text}:{text:string}){return <div className="py-8 text-center text-sm text-muted-foreground"><CircleDot className="mx-auto mb-2" size={22}/>{text}</div>}

function LeaderboardView({user,stats}:{user:User|null;stats:UserStats}) {
  const {data,isLoading}=useQuery({queryKey:['leaderboard'],queryFn:async()=>{if(!supabase)return [];const r=await supabase.from('leaderboard_public').select('display_name,solved_count,accuracy,streak').order('solved_count',{ascending:false}).limit(30);if(r.error){console.warn('Leaderboard is temporarily unavailable');return []}return r.data??[]},retry:0,staleTime:60_000})
  const fallback=[{display_name:'Top solver',solved_count:312,accuracy:91,streak:26},{display_name:'Consistency champ',solved_count:287,accuracy:88,streak:31},{display_name:'PYQ grinder',solved_count:264,accuracy:86,streak:19},{display_name:'Graph hunter',solved_count:241,accuracy:92,streak:17},{display_name:'You',solved_count:stats.solved,accuracy:stats.accuracy,streak:stats.streak}]
  const rows=(data&&data.length?data:fallback) as any[]
  return <div className="space-y-6 px-4 py-7 md:px-7 md:py-8 xl:px-10"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><Trophy size={13}/> LEADERBOARD</Badge><h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Compete without turning study into noise.</h1><p className="mt-2 text-sm text-muted-foreground">A lightweight public ranking built from solved volume, accuracy and consistency.</p></div><TopSolversStrip rows={rows}/><Card className="rounded-2xl"><CardHeader><CardTitle>Top solvers</CardTitle><CardDescription>{isLoading?'Loading the public ranking…':'Your personal data stays private; only leaderboard aggregates are public.'}</CardDescription></CardHeader><CardContent><div className="space-y-2">{rows.map((r,i)=><div key={`${r.display_name}-${i}`} className="flex items-center gap-3 rounded-2xl border bg-background/60 p-3"><div className={`grid h-9 w-9 place-items-center rounded-xl ${i<3?'bg-primary/10 text-primary':'bg-secondary text-muted-foreground'}`}>{i<3?<Medal size={17}/>:i+1}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{r.display_name}</p><p className="text-[11px] text-muted-foreground">{r.streak} day streak · {r.accuracy}% accuracy</p></div><div className="text-right"><p className="text-lg font-black">{r.solved_count}</p><p className="text-[9px] uppercase tracking-wider text-muted-foreground">solved</p></div></div>)}</div></CardContent></Card>{!user&&<p className="text-center text-xs text-muted-foreground">Sign in to have your own stats reflected in the leaderboard.</p>}</div>
}
function TopSolversStrip({rows}:{rows?:any[]}){const data=rows??[{display_name:'Aarav',solved_count:312},{display_name:'Meera',solved_count:287},{display_name:'Rohan',solved_count:264},{display_name:'Ananya',solved_count:241},{display_name:'Kabir',solved_count:229},{display_name:'Ishita',solved_count:218}];const doubled=[...data,...data];return <Card className="overflow-hidden rounded-2xl"><CardHeader className="pb-3"><div className="flex items-center gap-2"><Award size={17} className="text-primary"/><CardTitle className="text-sm">Top solvers</CardTitle></div><CardDescription>Quietly competitive, pleasantly relentless.</CardDescription></CardHeader><div className="top-solvers-marquee overflow-hidden pb-5"><div className="top-solvers-track flex w-max gap-3 px-2">{doubled.map((r:any,i:number)=><div key={`${r.display_name}-${i}`} className="top-solver-card flex min-w-[190px] items-center gap-3 rounded-2xl border bg-background/60 px-4 py-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Trophy size={16}/></div><div><p className="text-xs font-bold">{r.display_name}</p><p className="text-[10px] text-muted-foreground">{r.solved_count} solved</p></div></div>)}</div></div></Card>}

function ProfileView({user,photo,setPhoto,stats,goal,setGoal,achievements,onShare,onSignIn}:{user:User|null;photo:string;setPhoto:(v:string)=>void;stats:UserStats;goal:{type:string;value:number};setGoal:(g:{type:string;value:number})=>void;achievements:{id:string;label:string;icon:React.ReactNode;unlocked:boolean}[];onShare:()=>void;onSignIn:()=>void}){const [saved,setSaved]=useState(false);const [photoBusy,setPhotoBusy]=useState(false);const {register,handleSubmit,formState:{errors},reset}=useForm<ProfileForm>({resolver:zodResolver(profileSchema),defaultValues:{displayName:user?.displayName||'',bio:''}});useEffect(()=>reset({displayName:user?.displayName||'',bio:''}),[user,reset]);const onPhotoChange=useCallback(async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;setPhotoBusy(true);try{const {default:imageCompression}=await import('browser-image-compression');const compressed=await imageCompression(file,{maxSizeMB:.25,maxWidthOrHeight:512,useWebWorker:true,fileType:'image/webp'});const reader=new FileReader();reader.onload=()=>{const value=String(reader.result);localStorage.setItem('gate-pyq-profile-photo',value);setPhoto(value);toast.success('Profile photo saved on this browser')};reader.readAsDataURL(compressed)}catch{toast.error('Could not process that image')}finally{setPhotoBusy(false)}},[setPhoto]);async function submit(values:ProfileForm){if(!user||!firebaseAuth){toast('Sign in to edit your profile');return}await updateProfile(user,{displayName:values.displayName});if(supabase)await supabase.from('profiles').upsert({id:user.uid,display_name:values.displayName,avatar_url:user.photoURL||null,verified:user.emailVerified},{onConflict:'id'});setSaved(true);setTimeout(()=>setSaved(false),1800);toast.success('Profile updated')}return <div className="space-y-6 px-4 py-7 md:px-7 md:py-8 xl:px-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><UserRound size={13}/> PROFILE</Badge><h1 className="mt-3 text-3xl font-black tracking-tight">Your study identity</h1><p className="mt-2 text-sm text-muted-foreground">A clean profile for your GATE journey.</p></div><Button variant="outline" onClick={onShare}><Share2 size={15}/> Share progress</Button></div>{!user?<Card className="rounded-2xl"><CardContent className="p-8 text-center"><UserRound className="mx-auto text-primary" size={30}/><h2 className="mt-4 text-xl font-black">Create your study profile</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Sign in to save your progress, reactions and profile across devices.</p><Button className="mt-5" onClick={onSignIn}><LogIn size={15}/> Sign in</Button></CardContent></Card>:<div className="grid gap-4 lg:grid-cols-[.7fr_1.3fr]"><Card className="rounded-2xl"><CardContent className="p-6"><div className="flex flex-col items-center text-center"><Avatar photo={photo||user.photoURL||''} name={user.displayName||user.email||'User'} size="xl" verified={user.emailVerified}/><label className="mt-5 block w-full cursor-pointer rounded-2xl border border-dashed p-4 text-xs transition-colors hover:bg-accent"><input type="file" accept="image/*" className="sr-only" onChange={onPhotoChange} disabled={photoBusy}/><Upload className="mx-auto mb-2 text-primary" size={18}/>{photoBusy?'Processing photo…':'Choose a new profile photo'}</label><p className="mt-2 text-[10px] text-muted-foreground">Compressed and stored only in localStorage.</p></div><Separator className="my-6"/><div className="grid grid-cols-3 gap-2"><MiniMetric label="Solved" value={stats.solved}/><MiniMetric label="Accuracy" value={stats.accuracy}/><MiniMetric label="Streak" value={stats.streak}/></div></CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Profile details</CardTitle><CardDescription>Keep the public-facing bits clean and simple.</CardDescription></CardHeader><CardContent><form onSubmit={handleSubmit(submit)} className="space-y-4"><label className="grid gap-1.5 text-xs font-semibold">Display name<Input {...register('displayName')} placeholder="Your name"/>{errors.displayName&&<span className="text-[11px] text-destructive">{errors.displayName.message}</span>}</label><label className="grid gap-1.5 text-xs font-semibold">Bio<textarea {...register('bio')} className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring" placeholder="What are you preparing for?"/>{errors.bio&&<span className="text-[11px] text-destructive">{errors.bio.message}</span>}</label><div className="flex items-center justify-between"><p className="text-[11px] text-muted-foreground">{saved?'Saved successfully.':'Changes are synced when your account is available.'}</p><Button type="submit"><Save size={15}/> Save profile</Button></div></form></CardContent></Card></div>}<div className="grid gap-4 lg:grid-cols-2"><Card className="rounded-2xl"><CardHeader><CardTitle>My target</CardTitle><CardDescription>Choose the preparation target you want surfaced throughout the app.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2">{['AIR < 100','AIR < 500','AIR < 1000','Qualify GATE'].map(label=><button key={label} onClick={()=>setGoal({type:label,value:Number(label.match(/\d+/)?.[0]||0)})} className={`rounded-xl border p-3 text-left text-xs font-bold ${goal.type===label?'border-primary/40 bg-primary/10 text-primary':'hover:bg-accent'}`}>{label}</button>)}</CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Achievements</CardTitle><CardDescription>{achievements.filter(a=>a.unlocked).length} unlocked so far.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">{achievements.map(a=><div key={a.id} className={`rounded-2xl border p-3 ${a.unlocked?'border-primary/30 bg-primary/[.06]':'opacity-45'}`}><div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">{a.icon}</div><p className="mt-2 text-[10px] font-bold">{a.label}</p></div>)}</CardContent></Card></div></div>}



function NotificationsView({notifications,unread,dailyEmailEnabled,setDailyEmailEnabled,user,onRead}:{notifications:Notification[];unread:number;dailyEmailEnabled:boolean;setDailyEmailEnabled:(v:boolean)=>void;user:User|null;onRead:(id:string)=>void}){async function toggle(v:boolean){setDailyEmailEnabled(v);if(user&&supabase)await supabase.from('notification_preferences').upsert({user_id:user.uid,daily_email_enabled:v,email:user.email,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},{onConflict:'user_id'});toast.success(v?'Daily study reminders enabled':'Daily study reminders disabled')}return <div className="space-y-5 px-4 py-7 md:px-7 md:py-8 xl:px-10"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><Bell size={13}/> NOTIFICATIONS</Badge><h1 className="mt-3 text-3xl font-black tracking-tight">Your notification center</h1><p className="mt-2 text-sm text-muted-foreground">{unread} unread. Useful nudges only, no notification confetti cannon.</p></div><Card className="rounded-2xl"><CardHeader><CardTitle>Daily study reminder</CardTitle><CardDescription>Receive a gentle daily study reminder based on your progress.</CardDescription></CardHeader><CardContent><label className="flex items-center justify-between rounded-2xl border bg-background/60 p-4"><span className="flex items-center gap-3"><Mail size={18} className="text-primary"/><span><b className="block text-sm">Daily email</b><span className="text-xs text-muted-foreground">{dailyEmailEnabled?'Enabled':'Disabled'}</span></span></span><input type="checkbox" checked={dailyEmailEnabled} onChange={e=>toggle(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]"/></label></CardContent></Card><div className="space-y-2">{notifications.length?notifications.map(n=><button key={n.id} onClick={()=>onRead(n.id)} className={`w-full rounded-2xl border p-4 text-left transition hover:bg-accent ${n.read_at?'bg-card':'bg-primary/[.045] border-primary/15'}`}><div className="flex gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><BellRing size={16}/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-sm">{n.title}</b>{!n.read_at&&<span className="h-2 w-2 rounded-full bg-primary"/>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{n.body}</p><p className="mt-2 text-[10px] text-muted-foreground">{format(new Date(n.created_at),'dd MMM yyyy, HH:mm')}</p></div></div></button>):<EmptyState text="No notifications yet."/>}</div></div>}

function SettingsView({dark,setDark,user,notificationSoundEnabled,setNotificationSoundEnabled,onTestSound,onSignIn}:{dark:boolean;setDark:(v:boolean)=>void;user:User|null;notificationSoundEnabled:boolean;setNotificationSoundEnabled:(v:boolean)=>void;onTestSound:()=>void;onSignIn:()=>void}){return <div className="space-y-5 px-4 py-7 md:px-7 md:py-8 xl:px-10"><div><Badge variant="outline" className="gap-2 border-primary/25 text-primary"><Settings2 size={13}/> SETTINGS</Badge><h1 className="mt-3 text-3xl font-black tracking-tight">Tune the workspace</h1><p className="mt-2 text-sm text-muted-foreground">Small controls, big comfort.</p></div><Card className="rounded-2xl"><CardHeader><CardTitle>Appearance & alerts</CardTitle><CardDescription>Keep the workspace comfortable and notification sounds subtle.</CardDescription></CardHeader><CardContent className="space-y-3"><button onClick={()=>setDark(!dark)} className="flex w-full items-center justify-between rounded-2xl border bg-background/60 p-4 text-left hover:bg-accent"><span className="flex items-center gap-3"><Palette size={18} className="text-primary"/><span><b className="block text-sm">Theme</b><span className="text-xs text-muted-foreground">{dark?'Dark':'Light'}</span></span></span>{dark?<Moon size={18}/>:<Sun size={18}/>}</button><div className="flex flex-col gap-2 rounded-2xl border bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between"><button onClick={()=>setNotificationSoundEnabled(!notificationSoundEnabled)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-accent"><BellRing size={18} className="shrink-0 text-primary"/><span><b className="block text-sm">Notification sound</b><span className="text-xs text-muted-foreground">{notificationSoundEnabled?'Soft chime enabled':'Muted'}</span></span></button><Button variant="outline" size="sm" disabled={!notificationSoundEnabled} onClick={onTestSound}>Test sound</Button></div></CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Account & sync</CardTitle><CardDescription>Your account keeps your study progress and preferences in sync.</CardDescription></CardHeader><CardContent>{user?<div className="flex items-center gap-3 rounded-2xl border p-4"><ShieldCheck className="text-emerald-500"/><div><b className="text-sm">Account connected</b><p className="text-xs text-muted-foreground">{user.email}</p></div></div>:<Button onClick={onSignIn}><LogIn size={15}/> Sign in to enable cloud sync</Button>}</CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Performance philosophy</CardTitle><CardDescription>How this app stays quick.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><FeaturePill icon={<Database size={16}/>} title="Fast cached data"/><FeaturePill icon={<Wifi size={16}/>} title="Lazy PDF rendering"/><FeaturePill icon={<Gauge size={16}/>} title="Virtualized lists"/></CardContent></Card></div>}
function FeaturePill({icon,title}:{icon:React.ReactNode;title:string}){return <div className="flex items-center gap-3 rounded-2xl border bg-background/60 p-4 text-sm font-semibold">{icon}<span>{title}</span></div>}

function ShareProgressModal({stats,goal,subjectStats,user,onClose}:{stats:UserStats;goal:{type:string;value:number};subjectStats:any[];user:User|null;onClose:()=>void}) {
  const name=user?.displayName || user?.email?.split('@')[0] || 'GATE Learner'
  const shareText=`${name} · GATE CSE\n${stats.solved} PYQs solved · ${stats.accuracy}% accuracy · ${stats.streak} day streak\nGoal: ${goal.type}\nGATE PYQ Command Center`
  const copy=async()=>{try{await navigator.clipboard.writeText(shareText);toast.success('Progress copied')}catch{toast.error('Could not copy progress')}}
  const share=async()=>{try{if(navigator.share) await navigator.share({title:'My GATE progress',text:shareText,url:window.location.origin});else await copy()}catch{}}
  return <div className="fixed inset-0 z-[75] grid place-items-center bg-black/60 p-4 backdrop-blur-md" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><motion.div initial={{opacity:0,scale:.96,y:8}} animate={{opacity:1,scale:1,y:0}} className="w-full max-w-md"><Card className="overflow-hidden rounded-3xl"><div className="share-card-preview p-7 text-white"><div className="text-[10px] font-black uppercase tracking-[.25em] text-violet-200">GATEPYQ · COMMAND CENTER</div><p className="mt-5 text-lg font-bold">{name}</p><p className="mt-1 text-xs text-violet-200">GATE CSE preparation</p><div className="mt-7 grid grid-cols-3 gap-2"><div><b className="block text-3xl">{stats.solved}</b><span className="text-[9px] uppercase tracking-wider text-violet-200">Solved</span></div><div><b className="block text-3xl">{stats.accuracy}%</b><span className="text-[9px] uppercase tracking-wider text-violet-200">Accuracy</span></div><div><b className="block text-3xl">{stats.streak}</b><span className="text-[9px] uppercase tracking-wider text-violet-200">Day streak</span></div></div><div className="mt-7 rounded-2xl border border-white/15 bg-white/10 p-4"><p className="text-[9px] uppercase tracking-widest text-violet-200">Target</p><p className="mt-1 text-lg font-black">{goal.type}</p><div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">{subjectStats.slice(0,3).map(s=><span key={s.name} className="truncate">{s.name}: <b>{s.accuracy}%</b></span>)}</div></div></div><CardContent className="space-y-2 p-4"><p className="px-2 text-xs text-muted-foreground">Share a clean progress snapshot. No payment, no paywall.</p><div className="grid grid-cols-2 gap-2"><Button onClick={share}><Share2 size={15}/> Share</Button><Button variant="outline" onClick={copy}><Copy size={15}/> Copy</Button></div><Button variant="ghost" className="w-full" onClick={onClose}>Close</Button></CardContent></Card></motion.div></div>
}

function SiteFooter(){return <footer className="border-t border-border/70 bg-card/45 px-4 py-8 md:px-7 xl:px-10"><div className="mx-auto flex max-w-[1600px] flex-col gap-6 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={15} fill="currentColor"/></div><div><p className="text-sm font-black">GATE<span className="text-primary">PYQ</span></p><p className="text-[9px] font-bold tracking-[.18em] text-muted-foreground">COMMAND CENTER</p></div></div><p className="mt-3 max-w-md text-xs leading-5 text-muted-foreground">A focused workspace for solving, revising and understanding GATE CSE PYQs with your study history kept in your account.</p></div><div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs sm:grid-cols-4"><a href="#" onClick={e=>e.preventDefault()} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Info size={13}/> About</a><a href="#" onClick={e=>e.preventDefault()} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><BookOpen size={13}/> How it works</a><a href="#" onClick={e=>e.preventDefault()} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><ShieldCheck size={13}/> Privacy</a><a href="https://github.com/A-gif449/gate-pyq-command-center" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><ExternalLink size={13}/> GitHub</a></div></div><div className="mx-auto mt-5 flex max-w-[1600px] items-center justify-between border-t pt-4 text-[10px] text-muted-foreground"><span>© {new Date().getFullYear()} GATE PYQ Command Center</span><span className="inline-flex items-center gap-1.5"><LockKeyhole size={11}/> Your personal progress stays account-scoped.</span></div></footer>}

function NotificationPopover({notifications,unread,onRead,onOpenAll}:{notifications:Notification[];unread:number;onRead:(id:string)=>void;onOpenAll:()=>void}){return <div className="notification-popover absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-24px))] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border bg-card p-2 shadow-2xl"><div className="flex items-center justify-between px-3 py-2"><div><b className="text-sm">Notifications</b><p className="text-[10px] text-muted-foreground">{unread} unread</p></div><Bell size={15} className="shrink-0 text-primary"/></div><div className="max-h-[min(60vh,420px)] overflow-y-auto overflow-x-hidden overscroll-contain">{notifications.slice(0,8).map(n=><button key={n.id} onClick={()=>onRead(n.id)} className="w-full rounded-xl p-3 text-left hover:bg-accent"><p className="break-words text-xs font-bold">{n.title}</p><p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{n.body}</p></button>)}</div><Button variant="ghost" className="mt-1 w-full text-xs" onClick={onOpenAll}>Open notification center <ChevronRight size={14}/></Button></div>}

function CommandPalette({open,onOpenChange,navigate,onOpenQuestion,questions}:{open:boolean;onOpenChange:(v:boolean)=>void;navigate:(v:View)=>void;onOpenQuestion:(id:string)=>void;questions:Question[]}){const [q,setQ]=useState('');const matches=questions.filter(x=>`${x.id} ${x.displayId} ${x.source} ${x.topic}`.toLowerCase().includes(q.toLowerCase())).slice(0,8);const action=(fn:()=>void)=>{fn();onOpenChange(false);setQ('')};return <AnimatePresence>{open&&<motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[70] bg-black/40 p-4 backdrop-blur-sm" onMouseDown={e=>{if(e.target===e.currentTarget)onOpenChange(false)}}><motion.div initial={{opacity:0,scale:.97,y:-10}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.97,y:-10}} className="mx-auto mt-[10vh] max-w-2xl overflow-hidden rounded-3xl border bg-card shadow-2xl"><Command label="Command palette"><div className="flex items-center gap-3 border-b px-4"><Search size={18} className="text-muted-foreground"/><Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search questions or navigate…" className="h-14 flex-1 bg-transparent text-sm outline-none"/><kbd className="rounded border px-2 py-1 text-[10px]">ESC</kbd></div><Command.List className="max-h-[55vh] overflow-auto p-2"><Command.Empty className="p-6 text-center text-sm text-muted-foreground">No match.</Command.Empty><Command.Group heading="Navigate" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{[['Questions','library',BookOpen],['Dashboard','dashboard',BarChart3],['Leaderboard','leaderboard',Trophy],['Profile','profile',UserRound],['Notifications','notifications',Bell],['Settings','settings',Settings2]].map(([label,id,Icon])=><Command.Item key={String(id)} onSelect={()=>action(()=>navigate(id as View))} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm aria-selected:bg-accent"><Icon size={15}/>{label as string}</Command.Item>)}</Command.Group>{q&&<Command.Group heading="Questions" className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{matches.map(x=><Command.Item key={x.id} value={`${x.id} ${x.source} ${x.topic}`} onSelect={()=>action(()=>onOpenQuestion(x.id))} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 aria-selected:bg-accent"><BookOpen size={14}/><span className="min-w-0 flex-1 truncate"><b>{x.displayId??x.id}</b><span className="ml-2 text-xs text-muted-foreground">{x.topic}</span></span></Command.Item>)}</Command.Group>}</Command.List></Command></motion.div></motion.div>}</AnimatePresence>}

function Avatar({photo,name,size='sm',verified=false}:{photo:string;name:string;size?:'sm'|'xl';verified?:boolean}){return <div className="relative shrink-0">{photo?<img src={photo} alt="Profile" className={`${size==='xl'?'h-28 w-28':'h-8 w-8'} rounded-full border object-cover shadow-sm`}/>:<div className={`grid ${size==='xl'?'h-28 w-28 text-3xl':'h-8 w-8 text-xs'} place-items-center rounded-full bg-primary/10 font-black text-primary`}>{(name.trim()[0]||'U').toUpperCase()}</div>}{verified&&<span className={`absolute ${size==='xl'?'bottom-1 right-1':'-bottom-0.5 -right-0.5'} grid ${size==='xl'?'h-6 w-6':'h-4 w-4'} place-items-center rounded-full border-2 border-card bg-sky-500 text-white`}><Check size={size==='xl'?13:9} strokeWidth={3}/></span>}</div>}

function AuthModal({mode,onModeChange,onClose}:{mode:'login'|'signup';onModeChange:(m:'login'|'signup')=>void;onClose:()=>void}){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [forgot,setForgot]=useState(false); const [otpMode,setOtpMode]=useState(false); const [otp,setOtp]=useState(''); const [otpSent,setOtpSent]=useState(false); const [otpBusy,setOtpBusy]=useState(false); const [resendIn,setResendIn]=useState(0)
  useEffect(()=>{ if(!resendIn)return; const t=window.setInterval(()=>setResendIn(v=>Math.max(0,v-1)),1000); return()=>window.clearInterval(t) },[resendIn])
  async function run(action:()=>Promise<unknown>, welcomeKind:'new'|'returning'='returning'){setBusy(true);setMessage('');try{await action();if(firebaseAuth?.currentUser)sessionStorage.setItem(`gate-pyq-welcome:${firebaseAuth.currentUser.uid}`,welcomeKind);onClose();toast.success(welcomeKind==='new'?'Account created':'Welcome back')}catch(e){setMessage(firebaseError(e))}finally{setBusy(false)}}
  async function submit(e:React.FormEvent){e.preventDefault();const auth=firebaseAuth;if(!auth){setMessage('Sign-in is temporarily unavailable. Please try again.');return}await run(async()=>{if(mode==='signup'){const r=await createUserWithEmailAndPassword(auth,email.trim(),password);if(name.trim())await updateProfile(r.user,{displayName:name.trim()});void sendEmailVerification(r.user).catch(()=>{})}else {await signInWithEmailAndPassword(auth,email.trim(),password)}},mode==='signup'?'new':'returning')}
  async function google(){const auth=firebaseAuth;if(!auth){setMessage('Sign-in is temporarily unavailable. Please try again.');return}try{setBusy(true);setMessage('');const r=await signInWithPopup(auth,new GoogleAuthProvider());const info=getAdditionalUserInfo(r);sessionStorage.setItem(`gate-pyq-welcome:${r.user.uid}`,info?.isNewUser?'new':'returning');onClose();toast.success(info?.isNewUser?'Account created':'Welcome back')}catch(e){setMessage(firebaseError(e))}finally{setBusy(false)}}
  async function resetPassword(){const auth=firebaseAuth;if(!auth){setMessage('Sign-in is temporarily unavailable. Please try again.');return}if(!email.trim()){setMessage('Enter your email first.');return}setBusy(true);setMessage('');try{await sendPasswordResetEmail(auth,email.trim());setMessage('Password reset email sent. Check your inbox.')}catch(e){setMessage(firebaseError(e))}finally{setBusy(false)}}
  async function requestOtp(){if(!email.trim()){setMessage('Enter your email first.');return}setOtpBusy(true);setMessage('');try{const r=await fetch(OTP_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',purpose:mode,email:email.trim(),name:name.trim()})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Could not send the OTP.');setOtpSent(true);setResendIn(60);toast.success('Verification code sent')}catch(e){setMessage(e instanceof Error?e.message:'Could not send the OTP.')}finally{setOtpBusy(false)}}
  async function verifyOtp(){if(!/^\d{6}$/.test(otp)){setMessage('Enter the 6-digit code from your email.');return}setOtpBusy(true);setMessage('');try{const r=await fetch(OTP_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',purpose:mode,email:email.trim(),code:otp,name:name.trim()})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Could not verify the OTP.');if(!firebaseAuth)throw new Error('Sign-in is temporarily unavailable. Please try again.');const signed=await signInWithCustomToken(firebaseAuth,data.customToken);sessionStorage.setItem(`gate-pyq-welcome:${signed.user.uid}`,data.isNewUser?'new':'returning');onClose();toast.success(data.isNewUser?'Account created':'Welcome back')}catch(e){setMessage(e instanceof Error?e.message:'Could not verify the OTP.')}finally{setOtpBusy(false)}}
  const title=forgot?'Reset your password':otpMode?'Email OTP':mode==='signup'?'Build your study account':'Welcome back'
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-md" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><motion.div initial={{opacity:0,scale:.97,y:8}} animate={{opacity:1,scale:1,y:0}} className="w-full max-w-md"><Card className="relative overflow-hidden rounded-3xl"><div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-primary/20 blur-3xl"/><CardHeader className="relative p-7 pb-3"><Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={onClose}><X size={17}/></Button><div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><KeyRound size={20}/></div><Badge variant="outline" className="mt-5 w-fit text-primary">PERSONAL STUDY CLOUD</Badge><CardTitle className="mt-3 text-2xl">{title}</CardTitle><CardDescription>{forgot?'We will send a secure password reset email.':otpMode?'A 6-digit code will be sent to your email and expires in 5 minutes.':mode==='signup'?'Sync your study trail across devices.':'Your questions, reactions and streak are waiting.'}</CardDescription></CardHeader><CardContent className="relative p-7 pt-3">
    {!forgot&&!otpMode&&<><Button variant="outline" className="w-full" disabled={busy} onClick={google}><Chrome size={17}/> Continue with Google</Button><div className="my-5 flex items-center gap-3 text-[10px] text-muted-foreground"><Separator/><span>OR</span><Separator/></div></>}
    {otpMode?<div className="space-y-3">{mode==='signup'&&<label className="grid gap-1.5 text-xs font-semibold">Name<Input value={name} onChange={e=>setName(e.target.value)} placeholder="Your display name"/></label>}<label className="grid gap-1.5 text-xs font-semibold">Email<Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" disabled={otpSent}/></label>{otpSent&&<label className="grid gap-1.5 text-xs font-semibold">6-digit code<Input inputMode="numeric" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="123456" autoFocus/></label>}{!otpSent?<Button className="w-full" disabled={otpBusy} onClick={requestOtp}>{otpBusy?<><RefreshCw size={16} className="animate-spin"/> Sending…</>:<><Mail size={16}/> Send OTP</>}</Button>:<div className="grid grid-cols-2 gap-2"><Button className="w-full" disabled={otpBusy} onClick={verifyOtp}>{otpBusy?<><RefreshCw size={16} className="animate-spin"/> Checking…</>:<><Check size={16}/> Verify OTP</>}</Button><Button variant="outline" className="w-full" disabled={otpBusy||resendIn>0} onClick={()=>{setOtpSent(false);setOtp('');requestOtp()}}>{resendIn>0?`Resend ${resendIn}s`:<><RefreshCw size={15}/> Resend</>}</Button></div>}</div>:forgot?<div className="space-y-3"><label className="grid gap-1.5 text-xs font-semibold">Email<Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><Button className="w-full" disabled={busy} onClick={resetPassword}>{busy?<><RefreshCw size={16} className="animate-spin"/> Sending…</>:<><Mail size={16}/> Send reset email</>}</Button></div>:<form className="space-y-3" onSubmit={submit}>{mode==='signup'&&<label className="grid gap-1.5 text-xs font-semibold">Name<Input value={name} onChange={e=>setName(e.target.value)} placeholder="Your display name"/></label>}<label className="grid gap-1.5 text-xs font-semibold">Email<Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label className="grid gap-1.5 text-xs font-semibold">Password<Input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label><Button className="w-full" disabled={busy}>{busy?<><RefreshCw size={16} className="animate-spin"/> Working…</>:mode==='signup'?'Create account':'Sign in'}</Button></form>}
    {message&&<div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{message}</div>}
    <div className="mt-4 grid gap-2 text-center text-xs"><button className="font-semibold text-primary" onClick={()=>{setOtpMode(v=>!v);setForgot(false);setMessage('');setOtpSent(false)}}>{otpMode?'Use password instead':'Sign in / sign up with email OTP'}</button>{!otpMode&&!forgot&&mode==='login'&&<button className="font-semibold text-primary" onClick={()=>{setForgot(true);setMessage('')}}>Forgot password?</button>}{forgot&&<button className="font-semibold text-primary" onClick={()=>{setForgot(false);setMessage('')}}>← Back to sign in</button>}{!otpMode&&!forgot&&<button className="font-semibold text-primary" onClick={()=>{onModeChange(mode==='signup'?'login':'signup');setMessage('')}}>{mode==='signup'?'Already have an account? Sign in':'Need an account? Create one'}</button>}</div>
  </CardContent></Card></motion.div></div>
}
function firebaseError(error:unknown){const code=typeof error==='object'&&error&&'code'in error?String((error as {code:unknown}).code):'';const messages:Record<string,string>={'auth/email-already-in-use':'An account already exists with this email. Try Sign in.','auth/invalid-credential':'Email or password is incorrect.','auth/weak-password':'Use a stronger password.','auth/popup-closed-by-user':'Google sign-in was closed before completion.','auth/popup-blocked':'Your browser blocked the Google popup.','auth/unauthorized-domain':'Add this site domain to Firebase Authorized Domains.'};return messages[code]??'Authentication could not be completed. Please try again.'}
function ErrorFallback({resetErrorBoundary}:{error:unknown;resetErrorBoundary:()=>void}){return <div className="grid min-h-screen place-items-center bg-background p-6"><Card className="max-w-lg rounded-3xl"><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto text-destructive" size={32}/><h1 className="mt-4 text-2xl font-black">That screen hit a snag.</h1><p className="mt-2 text-sm text-muted-foreground">The app caught the crash instead of taking the whole page down.</p><Button className="mt-5" onClick={resetErrorBoundary}>Reload this screen</Button></CardContent></Card></div>}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary FallbackComponent={ErrorFallback}><QueryClientProvider client={queryClient}><App/></QueryClientProvider></ErrorBoundary></React.StrictMode>)
