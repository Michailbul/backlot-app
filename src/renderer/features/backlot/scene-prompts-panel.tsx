"use client"

/**
 * ScenePromptsPanel — bottom-of-pane prompts surface.
 *
 * Sits below the screenplay editor when the active entity is a scene
 * or a shot. The whole point: write the scene at the top, see the
 * prompts that bring it to visual life at the bottom, in parallel. No
 * mode switching.
 *
 *   ┌── Scene editor ────────────────────────────┐
 *   │ INT. WAREHOUSE - NIGHT                     │
 *   │ Lana steps into the doorway…               │
 *   │ ...                                        │
 *   ├── ⇕ resizable divider ─────────────────────┤
 *   │ PROMPTS · scene 02 — warehouse · 6 cards   │  ← this component
 *   │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
 *   │ │ kf  │ │ kf  │ │ ms  │ │ wf  │  …         │
 *   │ └─────┘ └─────┘ └─────┘ └─────┘            │
 *   └────────────────────────────────────────────┘
 *
 * When a shot is the active entity, this panel filters its cards to
 * just that shot's prompts (chip "Showing prompts for Shot 01 [×]" at
 * top — click × to clear back to all scene prompts).
 *
 * V1 uses MOCK_PROMPTS. E1.9 wires real `<scene>/shots/<id>/prompts/v*.md`
 * file reads through the entities router.
 */

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Image as ImageIcon,
  Plus,
  Sparkles,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../../lib/utils"
import {
  activeEntityAtom,
  promptsPanelOpenAtom,
  type ActiveEntity,
} from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Mock data — same shape as `shot-prompts-surface.tsx`. E1.9 replaces
// both with `entities.read({ chatId, entityPath })` calls walking the
// real `<scene>/shots/<id>/prompts/v*.md` files.
// ────────────────────────────────────────────────────────────────────────

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface MockPrompt {
  id: string
  shotId: string
  title: string
  type: PromptType
  status: PromptStatus
  parent: string | null
  body: string
  hasGeneration: boolean
  references: number
}

const MOCK_PROMPTS: MockPrompt[] = [
  {
    id: "v1-wide-establishing",
    shotId: "shot-01",
    title: "Wide establishing — warm dawn",
    type: "keyframe",
    status: "approved",
    parent: null,
    body:
      "A wide establishing shot of an empty forest road at dawn. Warm amber light grazes the asphalt, mist hugs the treeline.",
    hasGeneration: true,
    references: 3,
  },
  {
    id: "v2-warmer-light",
    shotId: "shot-01",
    title: "Wide — warmer light, lower angle",
    type: "keyframe",
    status: "generated",
    parent: "v1-wide-establishing",
    body:
      "Same composition, lower camera angle (almost ground level). Push the warmth — golden hour at peak.",
    hasGeneration: true,
    references: 2,
  },
  {
    id: "v3-medium-pushed-in",
    shotId: "shot-01",
    title: "Medium — pushed-in version",
    type: "keyframe",
    status: "draft",
    parent: "v2-warmer-light",
    body:
      "Medium shot. Tighter framing, asphalt textured detail in foreground, treeline blurred. Cooler grade.",
    hasGeneration: false,
    references: 1,
  },
  {
    id: "v1-dolly-tracking",
    shotId: "shot-02",
    title: "Multi-shot — dolly tracking through the road",
    type: "multi-shot",
    status: "generated",
    parent: null,
    body:
      "Shot 1 (3s): static wide. Shot 2 (4s): dolly forward, cars enter frame. Shot 3 (3s): cars pass camera.",
    hasGeneration: true,
    references: 4,
  },
  {
    id: "v2-handheld-energy",
    shotId: "shot-02",
    title: "Multi-shot — handheld, more kinetic",
    type: "multi-shot",
    status: "draft",
    parent: "v1-dolly-tracking",
    body:
      "Same beats but handheld. Slight breathing in the camera. Less precious, more documentary feel.",
    hasGeneration: false,
    references: 2,
  },
  {
    id: "v1-color-grade",
    shotId: "shot-01",
    title: "Workflow — color grade transfer template",
    type: "workflow",
    status: "approved",
    parent: null,
    body:
      "Reusable template: extract LUT from reference still, apply to shot. Use this for grade-matching.",
    hasGeneration: false,
    references: 0,
  },
]

const TYPE_ABBR: Record<PromptType, string> = {
  keyframe: "KEY",
  "multi-shot": "MULTI",
  "start-end-frame": "S/E",
  workflow: "WF",
}
const TYPE_COLORS: Record<PromptType, string> = {
  keyframe: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "multi-shot": "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "start-end-frame": "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  workflow: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
}
const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

// ────────────────────────────────────────────────────────────────────────
// Public API: returns true when the active entity is one the panel
// should render for. Workspace uses this to gate rendering.
// ────────────────────────────────────────────────────────────────────────

export function shouldShowPromptsPanel(active: ActiveEntity | null): boolean {
  return active?.kind === "scene" || active?.kind === "shot"
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function ScenePromptsPanel() {
  const active = useAtomValue(activeEntityAtom)
  const setActive = useSetAtom(activeEntityAtom)
  const [panelOpen, setPanelOpen] = useAtom(promptsPanelOpenAtom)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (!shouldShowPromptsPanel(active)) return null

  // Resolve scene context. If the active entity is a shot, surface its
  // parent scene's id for the panel header; the cards filter to that
  // shot. If a scene is active, show all its prompts.
  const sceneLabel =
    active?.kind === "scene"
      ? active.label
      : active?.kind === "shot"
        ? `Scene of ${active.label}`
        : ""
  const filterShotId = active?.kind === "shot" ? active.id : null
  const filterShotLabel = active?.kind === "shot" ? active.label : null

  // For the demo (synthetic scene), all mock prompts are "in this scene".
  // Real backend (E1.9) will filter by sceneId from prompt frontmatter.
  const visiblePrompts = filterShotId
    ? MOCK_PROMPTS.filter((p) => p.shotId === filterShotId)
    : MOCK_PROMPTS

  const onClearShotFilter = () => {
    if (active?.kind !== "shot") return
    // Move active to the parent scene — derive a synthetic scene entity
    // from the shot's sceneId. Real E1.9 wiring resolves this from the
    // entities router instead of synthesizing.
    setActive({
      kind: "scene",
      id: active.sceneId,
      label: `Scene ${active.sceneId.replace(/^\d+-/, "")}`,
      path: `scenes/${active.sceneId}/scene.fountain`,
    } as ActiveEntity)
  }

  return (
    <section className="flex flex-col h-full bg-background border-t border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground p-0.5"
            title={panelOpen ? "Collapse prompts panel" : "Expand prompts panel"}
          >
            {panelOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Prompts
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-foreground/85 truncate">
            {sceneLabel}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono">
            {visiblePrompts.length}
          </span>
          {filterShotId && filterShotLabel && (
            <button
              type="button"
              onClick={onClearShotFilter}
              className={cn(
                "ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono",
                "bg-primary/10 text-primary hover:bg-primary/20 transition-colors",
              )}
              title="Clear shot filter, show all scene prompts"
            >
              {filterShotLabel}
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
              "text-muted-foreground hover:text-foreground hover:bg-secondary",
              "transition-colors",
            )}
            title="Filter by type / status (coming in E1.9)"
          >
            <Filter className="h-3 w-3" />
            Filter
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
              "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
            )}
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      {/* Body — only when open */}
      {panelOpen && (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 overflow-auto">
            {visiblePrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-2 text-xs">
                <Sparkles className="h-5 w-5 text-muted-foreground/50" />
                <div className="text-muted-foreground/80">
                  No prompts for this {filterShotId ? "shot" : "scene"} yet.
                </div>
                <div className="text-muted-foreground/60">
                  Click <strong>+ New</strong> above, or ask the agent to draft a few in chat.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 p-3">
                {visiblePrompts.map((p) => (
                  <PromptCard
                    key={p.id}
                    prompt={p}
                    selected={p.id === selectedId}
                    onSelect={() => setSelectedId(p.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Detail rail — slides in beside cards when one is selected */}
          {selectedId && (
            <PromptDetailRail
              prompt={visiblePrompts.find((p) => p.id === selectedId) ?? null}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Card — compact, no hero thumb. Generation = tiny corner indicator only.
// ────────────────────────────────────────────────────────────────────────

interface PromptCardProps {
  prompt: MockPrompt
  selected: boolean
  onSelect: () => void
}

function PromptCard({ prompt, selected, onSelect }: PromptCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col gap-1.5 p-2.5 text-left rounded-md transition-all",
        "border bg-card",
        selected
          ? "border-primary shadow-sm ring-1 ring-primary/20"
          : "border-border hover:border-foreground/40 hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-1.5 justify-between">
        <span
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider",
            TYPE_COLORS[prompt.type],
          )}
        >
          {TYPE_ABBR[prompt.type]}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span
            className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[prompt.status])}
          />
          {prompt.status}
        </span>
      </div>
      <div className="text-[12px] font-medium text-foreground leading-snug line-clamp-2">
        {prompt.title}
      </div>
      <div className="text-[10.5px] text-muted-foreground/85 font-mono leading-relaxed line-clamp-2">
        {prompt.body}
      </div>
      <div className="flex items-center gap-2 mt-auto pt-1 text-[10px] text-muted-foreground/70 font-mono">
        {prompt.parent ? (
          <span className="truncate flex-1" title={`Iteration of ${prompt.parent}`}>
            ↳ {prompt.parent.replace(/^v\d+-/, "")}
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground/40">root</span>
        )}
        {prompt.hasGeneration && (
          <span
            className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 shrink-0"
            title="Generation available"
          >
            <ImageIcon className="h-2.5 w-2.5" />
          </span>
        )}
        {prompt.references > 0 && (
          <span
            className="text-muted-foreground/60 shrink-0"
            title={`${prompt.references} references`}
          >
            ▢{prompt.references}
          </span>
        )}
      </div>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Detail rail — opens on click, doesn't block the cards beside it.
// Slim version of the full surface's drawer (we already have a fuller
// one in shot-prompts-surface.tsx). Compact body editor only — full
// editing happens elsewhere in E1.9.
// ────────────────────────────────────────────────────────────────────────

function PromptDetailRail({
  prompt,
  onClose,
}: {
  prompt: MockPrompt | null
  onClose: () => void
}) {
  if (!prompt) return null
  return (
    <aside
      className="w-[360px] shrink-0 border-l border-border bg-card flex flex-col overflow-hidden"
      style={{ minWidth: 320 }}
    >
      <div className="flex items-center justify-between gap-2 h-9 px-3 border-b border-border bg-card/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider",
              TYPE_COLORS[prompt.type],
            )}
          >
            {TYPE_ABBR[prompt.type]}
          </span>
          <span className="text-xs font-mono text-foreground/90 truncate">
            {prompt.id}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="Close detail"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        <input
          type="text"
          defaultValue={prompt.title}
          className={cn(
            "w-full px-2 py-1.5 rounded border border-border bg-background",
            "text-sm font-medium text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-primary",
          )}
        />
        <textarea
          defaultValue={prompt.body}
          rows={6}
          className={cn(
            "w-full px-2 py-2 rounded border border-border bg-background",
            "font-mono text-[12px] leading-relaxed text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-primary",
            "resize-y",
          )}
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border bg-background hover:bg-secondary"
            title="Compose with character + location + world locks"
          >
            ✦ Compose
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-border bg-background hover:bg-secondary"
          >
            ↻ Iterate
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            <Sparkles className="h-3 w-3" />
            {prompt.hasGeneration ? "Re-generate" : "Generate"}
          </button>
        </div>
        {prompt.hasGeneration && (
          <div className="flex items-center gap-2">
            <div
              className="w-20 h-12 rounded shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
              }}
            />
            <div className="text-[10px] text-muted-foreground font-mono leading-tight">
              <div>nano-banana-pro</div>
              <div className="text-muted-foreground/60">2h ago</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

// Re-exported for the workspace to read inline if needed.
export { promptsPanelOpenAtom }
