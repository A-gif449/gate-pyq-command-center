import type { HTMLAttributes } from 'react'
export function Separator({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div role="separator" className={`shrink-0 bg-border h-px w-full ${className}`} {...props} /> }
