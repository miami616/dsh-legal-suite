/**
 * Image preview context (DSH port).
 *
 * Replaces the previous no-op stub so clicking an image in DirectoryPanel
 * actually opens an in-app overlay: scroll-wheel zoom, drag to pan, click /
 * Esc / × to close. Rendered via createPortal into document.body, theme-aware
 * through dsw tokens with neutral fallbacks.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut } from 'lucide-react'

interface ImagePreviewState {
  src: string
  name: string
}

export interface ImagePreviewApi {
  openPreview(src: string, name: string): void
  closePreview(): void
}

const ImagePreviewContext = createContext<ImagePreviewApi>({
  openPreview: () => {},
  closePreview: () => {},
})

export function useImagePreview(): ImagePreviewApi {
  return useContext(ImagePreviewContext)
}

function clampScale(next: number): number {
  return Math.min(6, Math.max(0.2, next))
}

export function ImagePreviewProvider({ children }: { children: ReactNode }): ReactNode {
  const [preview, setPreview] = useState<ImagePreviewState | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const openPreview = useCallback((src: string, name: string) => {
    setPreview({ src, name })
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const closePreview = useCallback(() => setPreview(null), [])

  useEffect(() => {
    if (preview === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, closePreview])

  return (
    <ImagePreviewContext.Provider value={{ openPreview, closePreview }}>
      {children}
      {preview !== null &&
        createPortal(
          <div
            className="fixed inset-0 z-[210] flex flex-col"
            style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(2px)' }}
            onClick={closePreview}
            data-agentlex-image-preview
          >
            <div className="flex h-11 flex-shrink-0 items-center gap-2 px-4 text-xs text-white/85">
              <span className="min-w-0 flex-1 truncate">{preview.name}</span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="缩小"
                title="缩小"
                onClick={(e) => { e.stopPropagation(); setScale((s) => clampScale(s / 1.2)) }}
              >
                <ZoomOut size={15} />
              </button>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="放大"
                title="放大"
                onClick={(e) => { e.stopPropagation(); setScale((s) => clampScale(s * 1.2)) }}
              >
                <ZoomIn size={15} />
              </button>
              <span className="w-12 text-right tabular-nums">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="关闭预览"
                title="关闭预览"
                onClick={(e) => { e.stopPropagation(); closePreview() }}
              >
                <X size={15} />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-hidden"
              style={{ cursor: 'grab', touchAction: 'none' }}
              onWheel={(e) => {
                setScale((s) => clampScale(s * (e.deltaY > 0 ? 0.9 : 1.1)))
              }}
              onPointerDown={(e) => {
                const start = { x: e.clientX - offset.x, y: e.clientY - offset.y }
                const onMove = (ev: PointerEvent): void => {
                  setOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y })
                }
                const onUp = (): void => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
            >
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
              >
                <img
                  src={preview.src}
                  alt={preview.name}
                  className="max-h-full max-w-full object-contain shadow-2xl"
                  draggable={false}
                  style={{ transform: `scale(${scale})`, transition: 'transform 120ms ease' }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </ImagePreviewContext.Provider>
  )
}