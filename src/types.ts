export type Status = 'unsolved' | 'solved' | 'wrong' | 'redo' | 'important'
export type Reaction = 'like' | 'dislike' | null

export interface Segment {
  pdf?: 'v1' | 'v2' | 'v3'
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface Question {
  id: string
  displayId?: string
  volume: 'v1' | 'v2' | 'v3'
  subject: string
  topic: string
  source: string
  tags: string
  answer?: string | null
  qrUrl?: string | null
  segments: Segment[]
}

export interface ProgressRow {
  question_id: string
  status: Status
  notes?: string | null
  updated_at?: string
}

export interface ReactionRow {
  question_id: string
  reaction: Exclude<Reaction, null>
}
