import type { CSSProperties } from 'react'
import train from '../assets/mobile-layer-icons/train-front.svg'
import bus from '../assets/mobile-layer-icons/bus-front.svg'
import ship from '../assets/mobile-layer-icons/ship.svg'
import school from '../assets/mobile-layer-icons/school.svg'
import arrowUpRight from '../assets/mobile-layer-icons/arrow-up-right.svg'
import arrowLeft from '../assets/mobile-layer-icons/arrow-left.svg'
import plus from '../assets/mobile-layer-icons/plus.svg'
import check from '../assets/mobile-layer-icons/check.svg'
import plane from '../assets/mobile-layer-icons/plane.svg'
import mapPin from '../assets/mobile-layer-icons/map-pin.svg'
import clock from '../assets/mobile-layer-icons/clock.svg'
import chevronDown from '../assets/mobile-layer-icons/chevron-down.svg'
import tram from '../assets/mobile-layer-icons/tram-front.svg'

// Official Lucide SVG assets: https://github.com/lucide-icons/lucide/tree/main/icons
// ISC / MIT attribution: public/licenses/lucide-icons.txt.
const sources = { train, bus, ship, school, arrowUpRight, arrowLeft, plus, check, plane, mapPin, clock, chevronDown, tram }

export function MobileLayerIcon({ name, size = 22 }: { name: keyof typeof sources; size?: number }) {
  return <span className="mm-mobile-asset-icon" aria-hidden="true"
    style={{ '--icon-source': `url("${sources[name]}")`, width: size, height: size } as CSSProperties} />
}
