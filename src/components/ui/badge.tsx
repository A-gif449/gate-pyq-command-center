import type { HTMLAttributes } from 'react'
export function Badge({ className = '', variant = 'default', ...props }: HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'secondary' | 'outline' }) {
 const v={default:'bg-primary text-primary-foreground',secondary:'bg-secondary text-secondary-foreground',outline:'border text-foreground'}
 return <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${v[variant]} ${className}`} {...props} />
}
