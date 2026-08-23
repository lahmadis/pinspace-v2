'use client'

import {
  MousePointer2,
  Pin,
  PenLine,
  StickyNote,
  Mic,
  ListChecks,
  ImageIcon,
} from 'lucide-react'

/**
 * The desk's tool rail.
 *
 * Every tool acts on the FOCUSED crit — the column you last clicked — rather
 * than on a selection, because a desk is a row of separate crits and there is
 * no single surface for a tool to be "armed" over. That is why the board shows
 * which column is focused and the hint at the bottom says so.
 */

export type DeskTool =
  | 'select'
  | 'pin'
  | 'trace'
  | 'note'
  | 'voice'
  | 'steps'
  | 'photo'

interface ToolDef {
  id: DeskTool
  label: string
  icon: React.ReactNode
  /** Not built yet — shown, disabled, with the reason in the tooltip. */
  unavailable?: string
}

export const DESK_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="w-4 h-4" /> },
  { id: 'pin', label: 'Pin work', icon: <Pin className="w-4 h-4" /> },
  {
    id: 'trace',
    label: 'Trace over',
    icon: <PenLine className="w-4 h-4" />,
    // Shown rather than hidden: it is part of the intended toolset, and a tool
    // that quietly does nothing is worse than one that says why. Drawing over
    // pinned work needs the annotation layer that boards already have, which
    // is the next piece of work.
    unavailable: 'Trace over is coming — it needs the annotation layer that boards use.',
  },
  { id: 'note', label: 'Note', icon: <StickyNote className="w-4 h-4" /> },
  { id: 'voice', label: 'Voice note', icon: <Mic className="w-4 h-4" /> },
  { id: 'steps', label: 'Next steps', icon: <ListChecks className="w-4 h-4" /> },
  { id: 'photo', label: 'Photo / ref', icon: <ImageIcon className="w-4 h-4" /> },
]

export default function DeskToolRail({
  active,
  recording,
  onPick,
  disabled,
  keepEnabled,
}: {
  active: DeskTool
  /** Voice shows as live rather than merely selected while it is capturing. */
  recording: boolean
  onPick: (tool: DeskTool) => void
  disabled?: boolean
  /** Tools that stay clickable even while the rail is otherwise busy. */
  keepEnabled?: DeskTool[]
}) {
  return (
    <aside className="w-[188px] shrink-0 px-4 py-5 border-r border-[#16181D]/8">
      <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8A8FA0] mb-3 px-1">
        Tools
      </div>
      <div className="space-y-1.5">
        {DESK_TOOLS.map((tool) => {
          const isActive = tool.id === active
          const isRecording = tool.id === 'voice' && recording
          const exempt = keepEnabled?.includes(tool.id) ?? false
          const isOff = (disabled && !exempt) || Boolean(tool.unavailable)
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => !isOff && onPick(tool.id)}
              disabled={isOff}
              aria-pressed={isActive}
              title={tool.unavailable ?? tool.label}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-left transition-colors ${
                isRecording
                  ? 'bg-[#D64545] text-white'
                  : isActive
                    ? 'bg-[#16181D] text-white'
                    : isOff
                      ? 'text-[#B6BAC6] cursor-default'
                      : 'text-[#5A5E6B] hover:bg-[#16181D]/5'
              }`}
            >
              <span className="shrink-0">{tool.icon}</span>
              <span className="truncate">
                {isRecording ? 'Recording…' : tool.label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-[#8A8FA0] mt-6 px-1">
        Pick a tool, then click the crit you want it to go into.
      </p>
    </aside>
  )
}
