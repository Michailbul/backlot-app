"use client"

/**
 * ScreenplayWorkspace — Backlot's two-column desktop layout.
 *
 * Replaces the upstream 1code "single-column chat" arrangement with
 * the screenwriter shape: the screenplay artifact dominates the
 * canvas, the assistant lives in a narrow right rail.
 *
 *   ┌─────────────────────────────────────────┬──────────────┐
 *   │                                         │              │
 *   │  ScreenplayPane                         │  Assistant   │
 *   │  (the artifact — what you're writing)   │  (chat,      │
 *   │                                         │   children)  │
 *   │                                         │              │
 *   └─────────────────────────────────────────┴──────────────┘
 *
 * The right column accepts the existing 1code <ChatView /> as
 * children — every existing tRPC stream, mention, and slash command
 * keeps working untouched. The left column is the new screenplay
 * surface (placeholder for now; CodeMirror in Phase D2).
 */

import { type ReactNode, useEffect } from "react"
import { useAtom, useAtomValue } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react"
import { ScreenplayPane } from "./screenplay-pane"
import {
  detailsSidebarOpenAtom,
  detailsSidebarWidthAtom,
} from "../details-sidebar/atoms"
import { cn } from "../../lib/utils"

const ASSISTANT_RAIL_OPEN_ATOM = atomWithStorage("backlot:assistant-rail-open", true)

const RAIL_BASE_WIDTH = 420 // px — wide enough for chat bubbles + tool chips, narrow enough that the screenplay still breathes
const DETAILS_FALLBACK_WIDTH = 500 // matches detailsSidebarWidthAtom default in case the atom isn't initialised yet

interface ScreenplayWorkspaceProps {
  chatId: string | null
  directionName?: string | null
  /** The existing 1code <ChatView /> goes here. */
  assistant: ReactNode
}

export function ScreenplayWorkspace({
  chatId,
  directionName,
  assistant,
}: ScreenplayWorkspaceProps) {
  const [railOpen, setRailOpen] = useAtom(ASSISTANT_RAIL_OPEN_ATOM)

  // When the chat opens its inline DetailsSidebar (Workspace / Branch /
  // Path / Changes / MCP), it demands ~500px of its own. With the rail
  // pinned at 420px the details column overflows the right edge of the
  // window. Subscribe to both atoms so the rail grows when details opens
  // and shrinks back when it closes — same behaviour as 1code's original
  // single-column layout, just driven by the atoms instead of being
  // implicit in the flex tree.
  const isDetailsOpen = useAtomValue(detailsSidebarOpenAtom)
  const detailsWidth = useAtomValue(detailsSidebarWidthAtom) ?? DETAILS_FALLBACK_WIDTH
  const railWidth = isDetailsOpen
    ? RAIL_BASE_WIDTH + detailsWidth
    : RAIL_BASE_WIDTH

  // Cmd+\ (or Ctrl+\) toggles the assistant rail. Single keystroke, mirrors
  // VS Code / Cursor's secondary-sidebar shortcut. Saves the user from
  // having to hunt for the tiny edge chevron when the rail is collapsed.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC")
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key === "\\") {
        e.preventDefault()
        setRailOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [setRailOpen])

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Center — screenplay artifact */}
      <div className="flex-1 min-w-0 relative">
        <ScreenplayPane chatId={chatId} directionName={directionName} />

        {/* Show-assistant pill — vertical label on the right edge. Big enough
            to find without hunting; clickable across the whole pill. */}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 right-0 z-30",
              "flex flex-col items-center justify-center gap-2",
              "w-9 py-4 rounded-l-lg border border-r-0 border-border",
              "bg-primary text-primary-foreground hover:opacity-90",
              "shadow-lg transition-opacity",
            )}
            title="Show assistant (Cmd+\\)"
            aria-label="Show assistant"
          >
            <MessageSquare className="h-4 w-4" />
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-mono"
              style={{ writingMode: "vertical-rl" }}
            >
              Assistant
            </span>
            <ChevronLeft className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Right rail — assistant. Width grows when the chat's inline Details
          panel is open so it doesn't overflow off the right edge of the window. */}
      {railOpen && (
        <aside
          className="border-l border-border bg-background/40 relative shrink-0 flex flex-col transition-[width] duration-150 ease-out"
          style={{ width: railWidth }}
        >
          {/* Rail header */}
          <div className="flex items-center justify-between h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                "text-muted-foreground hover:text-foreground hover:bg-secondary",
                "transition-colors",
              )}
              title="Hide assistant (Cmd+\\)"
              aria-label="Hide assistant"
            >
              Hide
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Chat — existing 1code ChatView, unchanged. */}
          <div className="flex-1 min-h-0 overflow-hidden">{assistant}</div>
        </aside>
      )}
    </div>
  )
}
