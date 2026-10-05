import { createClient } from '@supabase/supabase-js'
import { firebaseAuth } from './firebase'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT'))

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => {
        const user = firebaseAuth?.currentUser
        return user ? await user.getIdToken() : null
      },
    })
  : null
