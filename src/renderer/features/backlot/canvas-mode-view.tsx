"use client"

import { ImageIcon, Minus, Plus, Sparkles, Type } from "lucide-react"
import { useTheme } from "next-themes"
import type { PointerEvent, ReactNode } from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

interface CanvasModeViewProps {
  worktreeId: string | null
}

type CanvasNodeKind = "prompt" | "image" | "imageGeneration"

interface CanvasNodeView {
  id: string
  type: CanvasNodeKind
  x: number
  y: number
  width: number
  height: number
  dataJson: Record<string, unknown>
}

interface CanvasEdgeView {
  id: string
  sourceNodeId: string
  sourceHandle: string
  targetNodeId: string
  targetHandle: string
}

interface Viewport {
  x: number
  y: number
  zoom: number
}

interface PendingConnection {
  nodeId: string
  handle: "text" | "image"
  point: { x: number; y: number }
}

interface ViewportSize {
  width: number
  height: number
}

type CanvasTheme = {
  bg: string
  dot: string
  toolbar: string
  node: string
  muted: string
  label: string
  edge: string
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.8
const VIEWPORT_CULL_PADDING = 900

export function CanvasModeView({ worktreeId }: CanvasModeViewProps) {
  const { resolvedTheme } = useTheme()
  const isLight = resolvedTheme === "light"
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewportStateRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const viewportFrameRef = useRef<number | null>(null)
  const pointerWorldFrameRef = useRef<number | null>(null)
  const pointerWorldRef = useRef<{ x: number; y: number } | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [viewportSize, setViewportSize] = useState<ViewportSize | null>(null)
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection | null>(null)
  const [pointerWorld, setPointerWorld] = useState<{ x: number; y: number } | null>(null)

  const canvas = trpc.canvas.read.useQuery(
    { worktreeId: worktreeId ?? "" },
    {
      enabled: Boolean(worktreeId),
      refetchOnWindowFocus: false,
    },
  )
  const utils = trpc.useUtils()

  useEffect(() => {
    viewportStateRef.current = viewport
  }, [viewport])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const updateSize = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current)
      }
      if (pointerWorldFrameRef.current !== null) {
        cancelAnimationFrame(pointerWorldFrameRef.current)
      }
    }
  }, [])

  const scheduleViewport = useCallback((next: Viewport) => {
    viewportStateRef.current = next
    if (viewportFrameRef.current !== null) return
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null
      setViewport(viewportStateRef.current)
    })
  }, [])

  const setViewportNow = useCallback((next: Viewport) => {
    viewportStateRef.current = next
    if (viewportFrameRef.current !== null) {
      cancelAnimationFrame(viewportFrameRef.current)
      viewportFrameRef.current = null
    }
    setViewport(next)
  }, [])

  const schedulePointerWorld = useCallback((next: { x: number; y: number }) => {
    pointerWorldRef.current = next
    if (pointerWorldFrameRef.current !== null) return
    pointerWorldFrameRef.current = requestAnimationFrame(() => {
      pointerWorldFrameRef.current = null
      setPointerWorld(pointerWorldRef.current)
    })
  }, [])

  const refresh = useCallback(() => {
    if (worktreeId) void utils.canvas.read.invalidate({ worktreeId })
  }, [utils, worktreeId])

  const ensure = trpc.canvas.ensure.useMutation({ onSuccess: refresh })
  const createNode = trpc.canvas.createNode.useMutation({
    onSuccess: (created, variables) => {
      if (!variables) {
        refresh()
        return
      }
      const cacheWorktreeId = variables.worktreeId
      if (!cacheWorktreeId) {
        refresh()
        return
      }
      let updatedCache = false
      utils.canvas.read.setData({ worktreeId: cacheWorktreeId }, (current) => {
        if (!current) return current
        updatedCache = true
        return {
          ...current,
          nodes: [
            ...current.nodes,
            {
              ...created,
              dataJson: parseCanvasData(created.data),
            },
          ],
        }
      })
      if (!updatedCache) refresh()
    },
  })
  const updateNode = trpc.canvas.updateNode.useMutation({
    onMutate: (variables) => {
      if (!variables) return
      const cacheWorktreeId = variables.worktreeId
      if (!cacheWorktreeId || !variables.nodeId) return
      utils.canvas.read.setData({ worktreeId: cacheWorktreeId }, (current) => {
        if (!current) return current
        return {
          ...current,
          nodes: current.nodes.map((node) => {
            if (node.id !== variables.nodeId) return node
            const dataJson = variables.data
              ? variables.replaceData
                ? variables.data
                : { ...node.dataJson, ...variables.data }
              : node.dataJson
            return {
              ...node,
              ...(variables.x !== undefined ? { x: variables.x } : {}),
              ...(variables.y !== undefined ? { y: variables.y } : {}),
              ...(variables.width !== undefined ? { width: variables.width } : {}),
              ...(variables.height !== undefined ? { height: variables.height } : {}),
              ...(variables.locked !== undefined ? { locked: variables.locked } : {}),
              dataJson,
              data: JSON.stringify(dataJson),
            }
          }),
        }
      })
    },
    onError: refresh,
  })
  const connect = trpc.canvas.connect.useMutation({
    onSuccess: (created, variables) => {
      if (variables) {
        const cacheWorktreeId = variables.worktreeId
        if (cacheWorktreeId) {
          utils.canvas.read.setData({ worktreeId: cacheWorktreeId }, (current) => {
            if (!current) return current
            if (current.edges.some((edge) => edge.id === created.id)) return current
            return { ...current, edges: [...current.edges, created] }
          })
        }
      }
      setPendingConnection(null)
    },
  })

  const nodes = (canvas.data?.nodes ?? []) as CanvasNodeView[]
  const edges = (canvas.data?.edges ?? []) as CanvasEdgeView[]
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const visibleNodes = useMemo(
    () => cullNodesToViewport(nodes, viewport, viewportSize),
    [nodes, viewport, viewportSize],
  )
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  )
  const visibleEdges = useMemo(
    () =>
      viewportSize
        ? edges.filter((edge) => visibleNodeIds.has(edge.sourceNodeId) || visibleNodeIds.has(edge.targetNodeId))
        : edges,
    [edges, viewportSize, visibleNodeIds],
  )

  const addPrompt = useCallback(() => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 84, y: 96 }, viewportStateRef.current)
    createNode.mutate({
      worktreeId,
      type: "prompt",
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: 520,
      height: 320,
      data: { label: "Prompt", text: "PROMPT" },
    })
  }, [createNode, worktreeId])

  const addGeneration = useCallback(() => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 700, y: 116 }, viewportStateRef.current)
    createNode.mutate({
      worktreeId,
      type: "imageGeneration",
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: 560,
      height: 320,
      data: { model: "gpt-image-2", status: "idle" },
    })
  }, [createNode, worktreeId])

  const zoomBy = useCallback((delta: number) => {
    const current = viewportStateRef.current
    setViewportNow({
      ...current,
      zoom: clampZoom(current.zoom + delta),
    })
  }, [setViewportNow])

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const current = viewportStateRef.current
    const nextZoom = clampZoom(current.zoom - event.deltaY * 0.001)
    if (nextZoom === current.zoom) return

    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) {
      scheduleViewport({ ...current, zoom: nextZoom })
      return
    }
    const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const before = screenToWorld(mouse, current)
    scheduleViewport({
      zoom: nextZoom,
      x: mouse.x - before.x * nextZoom,
      y: mouse.y - before.y * nextZoom,
    })
  }, [scheduleViewport])

  const onBoardPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!pendingConnection) return
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    schedulePointerWorld(
      screenToWorld(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        viewportStateRef.current,
      ),
    )
  }, [pendingConnection, schedulePointerWorld])

  const onBoardPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest("[data-canvas-node]")) return
    const startViewport = viewportStateRef.current
    const start = { x: event.clientX, y: event.clientY, vx: startViewport.x, vy: startViewport.y }
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
      scheduleViewport({
        ...viewportStateRef.current,
        x: start.vx + moveEvent.clientX - start.x,
        y: start.vy + moveEvent.clientY - start.y,
      })
    }

    const onUp = () => {
      element.releasePointerCapture(event.pointerId)
      element.removeEventListener("pointermove", onMove as unknown as EventListener)
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("pointercancel", onUp)
    }

    element.addEventListener("pointermove", onMove as unknown as EventListener)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("pointercancel", onUp)
  }, [scheduleViewport])

  const startConnection = useCallback((node: CanvasNodeView, handle: "text" | "image") => {
    setPendingConnection({
      nodeId: node.id,
      handle,
      point:
        handle === "text"
          ? { x: node.x + node.width, y: node.y + node.height / 2 }
          : { x: node.x + node.width, y: node.y + node.height / 2 },
    })
    pointerWorldRef.current = null
    setPointerWorld(null)
  }, [])

  const finishConnection = useCallback((
    target: CanvasNodeView,
    targetHandle: "prompt" | "referenceImage",
  ) => {
    if (!worktreeId || !pendingConnection) return
    if (pendingConnection.nodeId === target.id) return
    connect.mutate({
      worktreeId,
      sourceNodeId: pendingConnection.nodeId,
      sourceHandle: pendingConnection.handle,
      targetNodeId: target.id,
      targetHandle,
    })
  }, [connect, pendingConnection, worktreeId])

  const resetViewport = useCallback(() => {
    setViewportNow({ x: 0, y: 0, zoom: 1 })
  }, [setViewportNow])

  const boardVars = useMemo<CanvasTheme>(
    () =>
      isLight
        ? {
            bg: "#f7f3ee",
            dot: "rgba(58, 58, 58, 0.18)",
            toolbar: "border-black/10 bg-white/86 text-zinc-800",
            node: "border-black/10 bg-white text-zinc-900 shadow-xl",
            muted: "text-zinc-500",
            label: "text-zinc-600",
            edge: "#3b82f6",
          }
        : {
            bg: "#111315",
            dot: "rgba(148, 163, 184, 0.18)",
            toolbar: "border-white/10 bg-[#1b1d20]/85 text-zinc-100",
            node: "border-white/10 bg-[#1b1d20] text-zinc-100 shadow-2xl",
            muted: "text-zinc-500",
            label: "text-zinc-400",
            edge: "#6ea8ff",
          },
    [isLight],
  )

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: boardVars.bg,
        backgroundImage: `radial-gradient(circle at 1px 1px, ${boardVars.dot} 1px, transparent 0)`,
        backgroundSize: `${18 * viewport.zoom}px ${18 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onWheel={onWheel}
      onPointerMove={onBoardPointerMove}
      onPointerDown={onBoardPointerDown}
    >
      <div className={cn("absolute left-4 top-4 z-30 flex items-center gap-2 rounded-md border px-2 py-1.5 shadow-2xl backdrop-blur", boardVars.toolbar)}>
        <CanvasToolButton
          icon={<Type className="h-3.5 w-3.5" />}
          label="Prompt"
          disabled={!worktreeId}
          onClick={addPrompt}
        />
        <CanvasToolButton
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Generate"
          disabled={!worktreeId}
          onClick={addGeneration}
        />
        <CanvasToolButton
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          label="Image"
          disabled
          onClick={() => undefined}
        />
      </div>

      <div className={cn("absolute right-4 top-4 z-30 flex items-center gap-1 rounded-md border px-1.5 py-1.5 shadow-2xl backdrop-blur", boardVars.toolbar)}>
        <IconButton label="Zoom out" onClick={() => zoomBy(-0.1)}>
          <Minus className="h-3.5 w-3.5" />
        </IconButton>
        <button
          type="button"
          onClick={resetViewport}
          className="press h-7 rounded px-2 text-[11px] font-medium tabular-nums hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => zoomBy(0.1)}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {pendingConnection && (
        <div className={cn("absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border px-3 py-1.5 text-[11px] shadow-2xl backdrop-blur", boardVars.toolbar)}>
          Select an image generation input handle
        </div>
      )}

      {worktreeId && !canvas.data && !canvas.isLoading && (
        <button
          type="button"
          onClick={() => ensure.mutate({ worktreeId })}
          className={cn(
            "press absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border px-3 py-2 text-xs font-medium shadow-2xl",
            boardVars.toolbar,
          )}
        >
          Open Canvas
        </button>
      )}

      <div
        className="absolute left-0 top-0 h-[4000px] w-[4000px] origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          willChange: "transform",
        }}
      >
        <CanvasEdges
          edges={visibleEdges}
          nodesById={nodesById}
          pendingConnection={pendingConnection}
          pointerWorld={pointerWorld}
          color={boardVars.edge}
        />
        {visibleNodes.map((node) => (
          <CanvasNodeShell
            key={node.id}
            worktreeId={worktreeId}
            node={node}
            zoom={viewport.zoom}
            theme={boardVars}
            updateNode={updateNode.mutate}
            onStartConnection={startConnection}
            onFinishConnection={finishConnection}
            pendingConnection={pendingConnection}
          />
        ))}
      </div>
    </div>
  )
}

function CanvasToolButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium",
        "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100",
      )}
      title={label}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex h-7 w-7 items-center justify-center rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

const CanvasNodeShell = memo(function CanvasNodeShell({
  worktreeId,
  node,
  zoom,
  theme,
  updateNode,
  onStartConnection,
  onFinishConnection,
  pendingConnection,
}: {
  worktreeId: string | null
  node: CanvasNodeView
  zoom: number
  theme: {
    node: string
    muted: string
    label: string
  }
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    x?: number
    y?: number
  }) => void
  onStartConnection: (node: CanvasNodeView, handle: "text" | "image") => void
  onFinishConnection: (
    target: CanvasNodeView,
    targetHandle: "prompt" | "referenceImage",
  ) => void
  pendingConnection: PendingConnection | null
}) {
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const renderedX = dragPosition?.x ?? node.x
  const renderedY = dragPosition?.y ?? node.y
  const label =
    typeof node.dataJson.label === "string"
      ? node.dataJson.label
      : node.type === "imageGeneration"
        ? "Image Generation"
        : node.type === "image"
          ? "Image"
          : "Prompt"

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
      }
    }
  }, [])

  const scheduleDragPosition = useCallback((next: { x: number; y: number }) => {
    dragPositionRef.current = next
    if (dragFrameRef.current !== null) return
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null
      setDragPosition(dragPositionRef.current)
    })
  }, [])

  const finishDrag = useCallback(() => {
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    dragPositionRef.current = null
    setDragPosition(null)
  }, [])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!worktreeId || event.button !== 0) return
    if ((event.target as HTMLElement).closest("[data-canvas-handle]")) return

    event.stopPropagation()
    const start = {
      x: event.clientX,
      y: event.clientY,
      nodeX: renderedX,
      nodeY: renderedY,
    }
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)

    const onUp = () => {
      const next = dragPositionRef.current
      element.releasePointerCapture(event.pointerId)
      element.removeEventListener("pointermove", trackedMove as unknown as EventListener)
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("pointercancel", onUp)
      if (next && worktreeId) {
        updateNode({
          worktreeId,
          nodeId: node.id,
          x: next.x,
          y: next.y,
        })
      }
      finishDrag()
    }

    const trackedMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
      const dx = (moveEvent.clientX - start.x) / zoom
      const dy = (moveEvent.clientY - start.y) / zoom
      const next = {
        x: Math.round(start.nodeX + dx),
        y: Math.round(start.nodeY + dy),
      }
      scheduleDragPosition(next)
    }

    element.addEventListener("pointermove", trackedMove as unknown as EventListener)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("pointercancel", onUp)
  }, [finishDrag, node.id, renderedX, renderedY, scheduleDragPosition, updateNode, worktreeId, zoom])

  return (
    <div
      data-canvas-node
      className={cn(
        "absolute cursor-grab rounded-lg border active:cursor-grabbing",
        theme.node,
        node.type === "prompt" && "border-blue-500/85",
      )}
      style={{
        left: 0,
        top: 0,
        width: node.width,
        height: node.height,
        transform: `translate3d(${renderedX}px, ${renderedY}px, 0)`,
        willChange: dragPosition ? "transform" : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      <div className={cn("absolute -top-6 left-3 flex items-center gap-1.5 text-[11px] font-medium", theme.label)}>
        {node.type === "prompt" ? (
          <Type className="h-3 w-3" />
        ) : (
          <ImageIcon className="h-3 w-3" />
        )}
        <span>{label}</span>
      </div>

      {(node.type === "prompt" || node.type === "image") && (
        <CanvasHandle
          side="right"
          active={pendingConnection?.nodeId === node.id}
          label={node.type === "prompt" ? "Text output" : "Image output"}
          icon={node.type === "image" ? <ImageIcon className="h-3 w-3" /> : undefined}
          onClick={() =>
            onStartConnection(node, node.type === "prompt" ? "text" : "image")
          }
        />
      )}

      {node.type === "imageGeneration" && (
        <>
          <CanvasHandle
            side="left"
            offset={0.46}
            active={pendingConnection?.handle === "text"}
            label="Prompt input"
            onClick={() => onFinishConnection(node, "prompt")}
          />
          <CanvasHandle
            side="left"
            offset={0.62}
            active={pendingConnection?.handle === "image"}
            label="Reference image input"
            icon={<ImageIcon className="h-3 w-3" />}
            onClick={() => onFinishConnection(node, "referenceImage")}
          />
        </>
      )}

      {node.type === "prompt" ? (
        <div className="p-5 text-sm font-medium">
          {typeof node.dataJson.text === "string" ? node.dataJson.text : "PROMPT"}
        </div>
      ) : node.type === "imageGeneration" ? (
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-black/[0.06] px-3 py-1 text-xs font-semibold dark:bg-white/[0.08]">
              {typeof node.dataJson.status === "string"
                ? node.dataJson.status
                : "idle"}
            </span>
            <span className={cn("rounded-full bg-black/[0.06] px-3 py-1 text-xs font-semibold dark:bg-white/[0.08]", theme.muted)}>
              {typeof node.dataJson.model === "string"
                ? node.dataJson.model
                : "gpt-image-2"}
            </span>
          </div>
          <div className="min-h-0 flex-1 rounded-md border border-black/[0.06] bg-black/[0.03] dark:border-white/[0.06] dark:bg-black/10" />
        </div>
      ) : (
        <div className={cn("flex h-full items-end rounded-lg bg-black/[0.04] p-3 text-[11px] dark:bg-black/20", theme.muted)}>
          {typeof node.dataJson.projectRelativePath === "string"
            ? node.dataJson.projectRelativePath
            : label}
        </div>
      )}
    </div>
  )
})

function CanvasHandle({
  side,
  offset = 0.5,
  active,
  label,
  icon,
  onClick,
}: {
  side: "left" | "right"
  offset?: number
  active?: boolean
  label: string
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      data-canvas-handle
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "absolute z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] shadow-lg",
        "border-white/20 bg-zinc-700 text-white hover:bg-blue-500",
        "dark:border-white/20 dark:bg-zinc-700",
        active && "bg-blue-500 ring-2 ring-blue-400/40",
        side === "left" ? "-left-3.5" : "-right-3.5",
      )}
      style={{ top: `${offset * 100}%` }}
      title={label}
      aria-label={label}
    >
      {icon ?? <span>{side === "left" ? "T" : "T"}</span>}
    </button>
  )
}

const CanvasEdges = memo(function CanvasEdges({
  edges,
  nodesById,
  pendingConnection,
  pointerWorld,
  color,
}: {
  edges: CanvasEdgeView[]
  nodesById: Map<string, CanvasNodeView>
  pendingConnection: PendingConnection | null
  pointerWorld: { x: number; y: number } | null
  color: string
}) {
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-[4000px] w-[4000px] overflow-visible"
      width={4000}
      height={4000}
    >
      {edges.map((edge) => {
        const source = nodesById.get(edge.sourceNodeId)
        const target = nodesById.get(edge.targetNodeId)
        if (!source || !target) return null
        const start = outputPoint(source)
        const end = inputPoint(target, edge.targetHandle)
        return (
          <path
            key={edge.id}
            d={bezierPath(start, end)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.86}
          />
        )
      })}
      {pendingConnection && pointerWorld && (
        <path
          d={bezierPath(pendingConnection.point, pointerWorld)}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="7 7"
          strokeLinecap="round"
          opacity={0.65}
        />
      )}
    </svg>
  )
})

function outputPoint(node: CanvasNodeView): { x: number; y: number } {
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

function inputPoint(
  node: CanvasNodeView,
  targetHandle: string,
): { x: number; y: number } {
  const offset = targetHandle === "referenceImage" ? 0.62 : 0.46
  return { x: node.x, y: node.y + node.height * offset }
}

function bezierPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
): string {
  const distance = Math.max(120, Math.abs(end.x - start.x) * 0.5)
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`
}

function screenToWorld(
  point: { x: number; y: number },
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))))
}

function parseCanvasData(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function cullNodesToViewport(
  nodes: CanvasNodeView[],
  viewport: Viewport,
  viewportSize: ViewportSize | null,
): CanvasNodeView[] {
  if (!viewportSize) return nodes

  const left = -viewport.x / viewport.zoom - VIEWPORT_CULL_PADDING
  const top = -viewport.y / viewport.zoom - VIEWPORT_CULL_PADDING
  const right = (viewportSize.width - viewport.x) / viewport.zoom + VIEWPORT_CULL_PADDING
  const bottom = (viewportSize.height - viewport.y) / viewport.zoom + VIEWPORT_CULL_PADDING

  return nodes.filter((node) => {
    const nodeRight = node.x + node.width
    const nodeBottom = node.y + node.height
    return nodeRight >= left && node.x <= right && nodeBottom >= top && node.y <= bottom
  })
}
