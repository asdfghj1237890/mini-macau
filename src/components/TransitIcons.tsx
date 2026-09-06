// Tabler Icons: outline/train.svg and outline/bus.svg (MIT).
// Copyright (c) 2020-2026 Paweł Kuna.
// Source: https://github.com/tabler/tabler-icons
// License: public/licenses/tabler-icons.txt

interface IconProps {
  size?: number
  className?: string
}

export function LrtIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true" focusable="false">
      <path d="M21 13c0 -3.87 -3.37 -7 -10 -7h-8" />
      <path d="M3 15h16a2 2 0 0 0 2 -2" />
      <path d="M3 6v5h17.5" />
      <path d="M3 11v4" />
      <path d="M8 11v-5" />
      <path d="M13 11v-4.5" />
      <path d="M3 19h18" />
    </svg>
  )
}

export function BusIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden="true" focusable="false">
      <path d="M4 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M16 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M4 17h-2v-11a1 1 0 0 1 1 -1h14a5 7 0 0 1 5 7v5h-2m-4 0h-8" />
      <path d="M16 5l1.5 7l4.5 0" />
      <path d="M2 10l15 0" />
      <path d="M7 5l0 5" />
      <path d="M12 5l0 5" />
    </svg>
  )
}
