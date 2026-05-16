"use client"

/**
 * AssistantRail — the screenwriter's chat rail.
 *
 * Hoisted to AgentsLayout so it spans the full window height as a
 * top-level column: its header strip sits on the macOS-chrome line
 * rather than tucked beneath it. The rail "takes in" the top panel on
 * its side — the editor keeps its own macOS strip (AppTopBar) on the
 * left, the rail owns the band above itself.
 *
 *   ┌─ AppTopBar ───────────────┬─ rail header (drag) ─┐
 *   │  editor / project chrome  │  Assistant      ✕     │
 *   ├───────────────────────────┼──────────────────────┤
 *   │                           │                      │
 *   │  editor                   │  chat (children)     │
 *   └───────────────────────────┴──────────────────────┘
 *
 * The chat itself (the existing <ChatView />) is passed in as children.
 */

import { type ReactNode, useEffect } from "react"
import { useAtom } from "jotai"
import { Resizer } from "./resizer"
import { assistantRailOpenAtom, assistantRailWidthAtom } from "./atoms"

// The rail is drag-resizable via the handle on its left edge. It can be
// made narrower, but never wider than its default: the chat lays out
// comfortably at the default width, and a wider rail only steals canvas
// from the screenplay. So default IS the max.
const RAIL_DEFAULT_WIDTH = 420 // keep in sync with assistantRailWidthAtom
const RAIL_MIN_WIDTH = 340
const RAIL_MAX_WIDTH = RAIL_DEFAULT_WIDTH

export function AssistantRail({ children }: { children: ReactNode }) {
  const [railOpen, setRailOpen] = useAtom(assistantRailOpenAtom)
  const [railUserWidth, setRailUserWidth] = useAtom(assistantRailWidthAtom)

  // Clamp the rendered width to the current bounds, and heal any value
  // persisted under an older, wider ceiling — without this, a rail
  // dragged wide in a past session keeps rendering off the window edge.
  const railWidth = Math.min(
    RAIL_MAX_WIDTH,
    Math.max(RAIL_MIN_WIDTH, railUserWidth),
  )
  useEffect(() => {
    if (railUserWidth !== railWidth) setRailUserWidth(railWidth)
  }, [railUserWidth, railWidth, setRailUserWidth])

  // Cmd+\ (or Ctrl+\) toggles the rail. Single keystroke, mirrors
  // VS Code / Cursor's secondary-sidebar shortcut.
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

  if (!railOpen) return null

  return (
    <div className="relative flex h-full shrink-0">
      {/* Resize handle on the rail's LEFT edge — dragging left (negative
          delta) widens the rail, so subtract the delta to grow it. */}
      <Resizer
        axis="x"
        bare
        onResize={(d) =>
          setRailUserWidth((w) =>
            Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, w - d)),
          )
        }
      />

      {/* The rail card — a floating island, inset from the window edges
          to match the editor's island gutters. The chat fills it top to
          bottom: its own header IS the rail's header, with no extra chrome
          stacked above it. Closed via the assistant toggle in the editor's
          macOS strip, or Cmd+\. */}
      <aside
        className="relative my-2 mr-2 flex flex-col min-w-0 bl-island rounded-2xl overflow-hidden"
        style={{ width: railWidth }}
      >
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
      </aside>
    </div>
  )
}
