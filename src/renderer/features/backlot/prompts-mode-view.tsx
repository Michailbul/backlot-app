"use client"

/**
 * PromptsModeView — the "Prompts" pipeline stage, completely different
 * surface from the screenwriting editor.
 *
 *   ┌── Project ──┬── Screenplay ref (left) ──┬── Prompt blocks (center) ──┬── Chat ──┐
 *   │             │  read-only display of     │  free-text blocks, the     │          │
 *   │             │  the active scene's       │  user and the agent both   │          │
 *   │             │  fountain — reference     │  edit each one as plain    │          │
 *   │             │  for the prompt work      │  text, no structured form  │          │
 *   └─────────────┴───────────────────────────┴────────────────────────────┴──────────┘
 *
 * The user explicitly asked for:
 *   - "minimize the input section" — no big name field, no type/status
 *     selectors, no rigid form. Each prompt is a single text block, free
 *     to edit.
 *   - the agent writes to the same blocks (drafts variations, iterates)
 *
 * Metadata (id, type, status, parent, generation refs) is still tracked
 * in markdown frontmatter on disk — the UI just doesn't surface it as
 * fields. A tiny corner shows v-id + status dot; a hover-row gives the
 * iterate / generate / more actions.
 *
 * V1 uses MOCK_PROMPTS. E1.9 wires real `<scene>/shots/<id>/prompts/v*.md`.
 */

import { useAtomValue } from "jotai"
import {
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react"
import { useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Mock data — same shape as scene-prompts-panel.tsx. Backed by real
// files in E1.9.
// ────────────────────────────────────────────────────────────────────────

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface MockPrompt {
  id: string
  shotId: string
  type: PromptType
  status: PromptStatus
  parent: string | null
  body: string
  hasGeneration: boolean
}

const MOCK_PROMPTS: MockPrompt[] = [
  {
    id: "v1-wide-establishing",
    shotId: "shot-01",
    type: "keyframe",
    status: "approved",
    parent: null,
    body: `A wide establishing shot of an empty forest road at dawn. Warm amber light grazes the asphalt, mist hugs the treeline, anamorphic flare on the horizon. 35mm film stock feel, slight grain. The road stretches into a vanishing point lit gold. Low atmospheric haze.`,
    hasGeneration: true,
  },
  {
    id: "v2-warmer-light",
    shotId: "shot-01",
    type: "keyframe",
    status: "generated",
    parent: "v1-wide-establishing",
    body: `Same composition as v1 but with the camera dropped almost to ground level — asphalt detail dominates the foreground. Push the warmth: golden hour at peak, almost overripe. The road still vanishes into gold but now we feel the weight of its surface.`,
    hasGeneration: true,
  },
  {
    id: "v3-medium-pushed-in",
    shotId: "shot-01",
    type: "keyframe",
    status: "draft",
    parent: "v2-warmer-light",
    body: `Medium shot, tighter framing. Asphalt textured detail in the foreground, treeline blurred. Cooler grade — feels uncertain rather than romantic. Slight camera tilt. Mist still present but deeper, more clinical.`,
    hasGeneration: false,
  },
  {
    id: "v1-dolly-tracking",
    shotId: "shot-02",
    type: "multi-shot",
    status: "generated",
    parent: null,
    body: `Three-shot continuous sequence.\n\nShot 1 (3s): static wide on the empty road.\nShot 2 (4s): dolly forward, two cars enter frame from background.\nShot 3 (3s): cars pass camera left-to-right, mist disturbed by their wake.\n\nContinuity rules: amber light constant, lens choice locked, no cuts within shots.`,
    hasGeneration: true,
  },
  {
    id: "v1-color-grade",
    shotId: "shot-01",
    type: "workflow",
    status: "approved",
    parent: null,
    body: `Reusable color-grade transfer template.\n\nInput: a reference still with the desired grade + a generated frame that needs grading to match.\n\nProcess:\n1. Extract LUT from reference (DaVinci or local node).\n2. Apply LUT to generated frame at 0.7 strength.\n3. Pull selective chroma adjustments on skin tones if humans present.\n\nUse this whenever a Nano Banana output needs grade-matching to a reference.`,
    hasGeneration: false,
  },
]

// Status dot color
const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

// ────────────────────────────────────────────────────────────────────────
// Mock screenplay reference — replaced by real fountain content from
// the active scene's `scene.fountain` in E1.4.
// ────────────────────────────────────────────────────────────────────────

const MOCK_SCREENPLAY = `EXT. DESERT MOUNTAIN PASS - SUNSET

Two cars idle at a starting line painted across asphalt. Beyond
them, the road snakes into foothills. The sky burns amber and rust.

A REFEREE in a dark jacket stands between the vehicles, arm raised.

In CAR 1, ALEX (late 20s, focused, hands tight on the wheel) stares
ahead. Jaw clenched.

In CAR 2, JORDAN (same age, confident but tense) grips their own
wheel. They don't look sideways. Both engines rumble low.

The REFEREE drops their arm.

Both cars LAUNCH forward. Tires scream. Dust kicks up.

INT. CAR 1 - CONTINUOUS

Alex's eyes flick to the speedometer. Then forward. Then to a
photograph taped to the dashboard — younger versions of themselves.
Jordan and Alex. Laughing.

Alex tightens their grip.

INT. CAR 2 - CONTINUOUS

Jordan's jaw clenches. One hand comes off the wheel for half a
second. They reach toward the dashboard — a worn photograph taped
there. Younger versions of themselves. Jordan and Alex. Laughing.
Before this.

Their hand drops back to the wheel. The moment fractures.`

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function PromptsModeView() {
  const active = useAtomValue(activeEntityAtom)

  // Filter prompts to the active entity. Scene → all its prompts;
  // shot → just that shot's prompts. For now (mock data) shotId is
  // synthetic; real backend resolves via frontmatter sceneId/shotId.
  const filterShotId = active?.kind === "shot" ? active.id : null
  const filteredPrompts = filterShotId
    ? MOCK_PROMPTS.filter((p) => p.shotId === filterShotId)
    : MOCK_PROMPTS

  const sceneLabel =
    active?.kind === "scene"
      ? active.label
      : active?.kind === "shot"
        ? `Scene of ${active.label}`
        : "Scene"

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Left — screenplay reference */}
      <div className="w-[40%] min-w-[320px] max-w-[560px] flex flex-col border-r border-border">
        <ScreenplayReferenceHeader sceneLabel={sceneLabel} />
        <div className="flex-1 min-h-0 overflow-auto bg-card/20">
          <pre className={cn(
            "whitespace-pre-wrap break-words font-mono text-[12px] leading-7",
            "text-foreground/85 px-6 py-6 max-w-[60ch]",
          )}>
            {MOCK_SCREENPLAY}
          </pre>
        </div>
      </div>

      {/* Center — prompt blocks */}
      <div className="flex-1 min-w-0 flex flex-col">
        <PromptBlocksHeader
          count={filteredPrompts.length}
          shotFilter={
            active?.kind === "shot" ? active.label : null
          }
        />
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[800px] mx-auto px-6 py-4 space-y-3">
            {filteredPrompts.length === 0 ? (
              <EmptyPrompts />
            ) : (
              filteredPrompts.map((p) => (
                <PromptBlock key={p.id} prompt={p} />
              ))
            )}
            {/* Add-prompt affordance */}
            <button
              type="button"
              className={cn(
                "w-full flex items-center justify-center gap-2 py-4",
                "border border-dashed border-border rounded-md",
                "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
                "transition-colors text-sm font-medium",
              )}
              title="Add a new prompt — or ask the agent in chat to draft one"
            >
              <Plus className="h-4 w-4" />
              Add prompt
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Headers
// ────────────────────────────────────────────────────────────────────────

function ScreenplayReferenceHeader({ sceneLabel }: { sceneLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          Screenplay
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-xs text-foreground/85 truncate">{sceneLabel}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/50 font-mono ml-1">
          read-only
        </span>
      </div>
    </div>
  )
}

function PromptBlocksHeader({
  count,
  shotFilter,
}: {
  count: number
  shotFilter: string | null
}) {
  return (
    <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          Prompts
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono">
          {count}
        </span>
        {shotFilter && (
          <span className="text-[10px] font-mono text-muted-foreground/70 ml-1">
            · {shotFilter}
          </span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// PromptBlock — the centerpiece. Just text. No name field, no type
// selector, no status pill in the form. The user types freely. The
// agent edits the same text in chat-driven turns.
//
// What's visible by default:
//   · the body text (auto-expanding textarea)
//   · a tiny corner badge: v-id + status dot
// What's revealed on focus / hover:
//   · action row at the bottom (Iterate / Generate / More)
//   · iteration parent indicator
//   · generation thumbnail (if any)
// ────────────────────────────────────────────────────────────────────────

function PromptBlock({ prompt }: { prompt: MockPrompt }) {
  const [text, setText] = useState(prompt.body)
  const [focused, setFocused] = useState(false)

  return (
    <div
      className={cn(
        "group relative rounded-md transition-all",
        "bg-card border",
        focused
          ? "border-primary shadow-sm ring-1 ring-primary/15"
          : "border-border hover:border-foreground/30",
      )}
    >
      {/* Body — the only thing prominent */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={Math.max(3, text.split("\n").length)}
        className={cn(
          "w-full px-4 py-3 bg-transparent",
          "font-mono text-[13px] leading-relaxed text-foreground",
          "border-0 outline-none resize-none",
          "placeholder:text-muted-foreground/50",
        )}
        placeholder="Type the prompt, or ask the agent to draft one in chat…"
      />

      {/* Tiny corner badge — v-id + status dot. Stays subtle. */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 select-none pointer-events-none">
        {prompt.parent && (
          <span title={`Iteration of ${prompt.parent}`}>
            ↳ {prompt.parent.replace(/^v\d+-/, "")}
          </span>
        )}
        <span>{prompt.id.split("-")[0]}</span>
        <span
          className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[prompt.status])}
          title={prompt.status}
        />
      </div>

      {/* Generation — small thumbnail anchored to the bottom-left, only
          when present. Not a hero. */}
      {prompt.hasGeneration && (
        <div className="px-4 pb-3 flex items-center gap-2">
          <div
            className="w-24 h-14 rounded shrink-0"
            style={{
              background:
                "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
            }}
            title="Latest generation"
          />
          <div className="text-[10px] text-muted-foreground/70 font-mono leading-tight">
            <div>nano-banana-pro</div>
            <div className="text-muted-foreground/50">2h ago</div>
          </div>
        </div>
      )}

      {/* Action row — appears on focus or hover. Subtle when not. */}
      <div
        className={cn(
          "flex items-center justify-end gap-1 px-3 pb-2 pt-0",
          "transition-opacity",
          focused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <ActionButton icon={Wand2} label="Compose" title="Compose with character + location + world locks" />
        <ActionButton icon={RotateCcw} label="Iterate" title="Ask the agent for a variation of this prompt" />
        <ActionButton
          icon={Sparkles}
          label={prompt.hasGeneration ? "Re-generate" : "Generate"}
          primary
          title={prompt.hasGeneration ? "Run the model again" : "Run the model with this prompt"}
        />
        <button
          type="button"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
          title="More"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  title,
  primary,
}: {
  icon: typeof Wand2
  label: string
  title: string
  primary?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
        "transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-background hover:bg-secondary",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

function EmptyPrompts() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <Sparkles className="h-6 w-6 text-muted-foreground/50" />
      <div className="text-sm text-foreground/80 font-medium">
        No prompts yet for this scene.
      </div>
      <div className="text-xs text-muted-foreground/70 max-w-[40ch]">
        Click <strong>Add prompt</strong> below, or ask the agent in chat —
        e.g. "draft 3 keyframe variations for this scene."
      </div>
    </div>
  )
}

// Small icon mock used by ActionButton typing
const _ImageIcon = ImageIcon
void _ImageIcon
