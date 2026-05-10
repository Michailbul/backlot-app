"use client"

/**
 * FountainEditor — Backlot's screenplay surface.
 *
 * One layout, two modes (no layout shift between them):
 *   • "preview" — typeset screenplay rendering via FountainPreview
 *     (paper page, Courier, scene caps, character indents, etc).
 *     Click anywhere → swap to edit. This is what the screenwriter
 *     sees by default.
 *   • "edit" — raw Fountain source in a Courier-styled textarea
 *     positioned EXACTLY where the rendered page sat: same outer
 *     wrapper, same flex centering, same max-width, same padding.
 *     The textarea auto-grows to its content's height so the surface
 *     doesn't suddenly expand to a hard min-height when entering
 *     edit mode (the bug we're fixing in this revision).
 *
 * The two modes are wrapped in the same `Frame` component so the
 * outer chrome stays put on the swap; only the inner content
 * (article ↔ textarea) changes. No vertical jump, no width shift.
 *
 * Why not WYSIWYG (single-pane formatted-while-typing)? Real-tool
 * WYSIWYG (Final Draft, WriterDuet) requires a custom contenteditable
 * with selection management — solvable but big surface area for v1.
 * The click-to-edit pattern gets us most of the professional feel
 * with a fraction of the code.
 */

import { memo, useCallback, useEffect, useRef } from "react"
import { FountainPreview } from "./fountain-preview"
import { cn } from "../../lib/utils"

interface FountainEditorProps {
  /** Raw fountain source. */
  value: string
  /** Mode controlled from the parent so the entity-editor can drive
   *  rendered ↔ edit transitions and reset on entity change. */
  mode: "preview" | "edit"
  /** When the user clicks the typeset page to edit, the click coords
   *  are passed through so the parent can route them into focusPoint
   *  (cursor-near-click). Plain mode flips have no coords. */
  onModeChange: (
    next: "preview" | "edit",
    coords?: { clientX: number; clientY: number },
  ) => void
  onChange: (next: string) => void
  onBlur?: () => void
  /** Click coords for cursor placement on edit entry — same idiom as
   *  the rich markdown editor; keeps the cursor near where the user
   *  clicked instead of jumping to start/end. */
  focusPoint?: { x: number; y: number } | null
  className?: string
}

export const FountainEditor = memo(function FountainEditor({
  value,
  mode,
  onModeChange,
  onChange,
  onBlur,
  focusPoint,
  className,
}: FountainEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Auto-grow the textarea so its on-screen height tracks content.
  // Without this, the textarea defaults to a fixed `rows={2}` which
  // makes it MUCH shorter than the rendered article — and adding a
  // hard `min-h-[60vh]` floor (which we used to do) caused the
  // opposite bug: clicking a short screenplay snapped the surface to
  // 60% viewport, shifting everything below. Letting it grow with
  // content keeps the swap seamless.
  const autoGrow = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${node.scrollHeight}px`
  }, [])

  // Place the cursor at the offset closest to the click point. Cheap
  // single-shot: walk the row index by Y offset, the column by char
  // width (Courier is monospace so 0.6em ≈ 1 char).
  const placeCursorNearPoint = useCallback(
    (ta: HTMLTextAreaElement, point: { x: number; y: number }) => {
      try {
        const rect = ta.getBoundingClientRect()
        if (
          point.x < rect.left - 200 ||
          point.x > rect.right + 200 ||
          point.y < rect.top - 200 ||
          point.y > rect.bottom + 200
        ) {
          ta.setSelectionRange(0, 0)
          return
        }
        const style = window.getComputedStyle(ta)
        const lineHeight = parseFloat(style.lineHeight) || 16
        const fontSize = parseFloat(style.fontSize) || 13
        const charWidth = fontSize * 0.6
        const localY = point.y - rect.top - parseFloat(style.paddingTop || "0")
        const localX = point.x - rect.left - parseFloat(style.paddingLeft || "0")
        const lineIndex = Math.max(0, Math.floor(localY / lineHeight))
        const colIndex = Math.max(0, Math.round(localX / charWidth))
        const lines = ta.value.split("\n")
        const targetLine = Math.min(lineIndex, lines.length - 1)
        const offsetBefore = lines
          .slice(0, targetLine)
          .reduce((acc, l) => acc + l.length + 1, 0)
        const colClamped = Math.min(colIndex, lines[targetLine].length)
        const pos = offsetBefore + colClamped
        ta.setSelectionRange(pos, pos)
      } catch {
        ta.setSelectionRange(0, 0)
      }
    },
    [],
  )

  // Mount-time setup — focus + cursor placement + initial auto-grow.
  const editorTextareaRefSetter = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      if (!node) return
      requestAnimationFrame(() => {
        autoGrow(node)
        node.focus()
        if (focusPoint) {
          placeCursorNearPoint(node, focusPoint)
        } else {
          node.setSelectionRange(0, 0)
        }
      })
    },
    [autoGrow, focusPoint, placeCursorNearPoint],
  )

  // Re-fit on every value change so typing past the current height
  // grows the surface instead of triggering an inner scrollbar.
  useEffect(() => {
    if (mode !== "edit") return
    autoGrow(textareaRef.current)
  }, [value, mode, autoGrow])

  // ── Shared outer frame — identical chrome for preview + edit so
  // the swap doesn't shift anything ──────────────────────────────
  const isPreview = mode === "preview"

  return (
    <div
      role={isPreview ? "button" : undefined}
      tabIndex={isPreview ? 0 : undefined}
      onClick={
        isPreview
          ? (e) => {
              e.preventDefault()
              onModeChange("edit", {
                clientX: e.clientX,
                clientY: e.clientY,
              })
            }
          : undefined
      }
      onKeyDown={
        isPreview
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onModeChange("edit")
              }
            }
          : undefined
      }
      className={cn(
        "w-full h-full pt-3",
        isPreview && [
          "cursor-text",
          "transition-[background-color] duration-150",
          "hover:bg-foreground/[0.012] dark:hover:bg-foreground/[0.02]",
          "focus:outline-none focus-visible:bg-foreground/[0.02]",
        ],
        className,
      )}
      aria-label={isPreview ? "Edit screenplay" : undefined}
    >
      {isPreview ? (
        <FountainPreview source={value} />
      ) : (
        <div className="flex justify-center px-6 pb-24">
          <textarea
            ref={editorTextareaRefSetter}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              autoGrow(e.currentTarget)
            }}
            onBlur={onBlur}
            spellCheck
            // The textarea is styled to MATCH the typeset page so the
            // visual jolt between modes is small: same width, same
            // padding, same border + paper-shadow treatment.
            className={cn(
              "block w-full max-w-[680px]",
              "px-[64px] py-[56px]",
              "bg-background border border-border/50 dark:border-border/40",
              "rounded-[2px]",
              "shadow-[0_1px_0_0_rgba(0,0,0,0.02),_0_8px_24px_-18px_rgba(0,0,0,0.12)]",
              "dark:shadow-none",
              "outline-none resize-none overflow-hidden",
              "text-foreground/90 selection:bg-primary/25 caret-primary",
            )}
            style={{
              fontFamily:
                '"Courier Prime", "Courier New", Courier, ui-monospace, monospace',
              fontSize: "13px",
              lineHeight: "1.55",
              tabSize: 4,
            }}
          />
        </div>
      )}
    </div>
  )
})
