import type { ImgHTMLAttributes } from 'react'
export function Avatar({ className = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) { return <img className={`aspect-square h-9 w-9 rounded-full border object-cover ${className}`} {...props} /> }
