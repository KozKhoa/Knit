import React from "react";
import {
  Crop,
  PenTool,
  RotateCw,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import type {
  AnnotationLayer,
  CropRect,
  PageDraft,
  StrokeAnnotation,
  TextAnnotation,
} from "../types/ipc";

interface ImageCanvasEditorModalProps {
  draft: PageDraft;
  imageSrc: string;
  onSave: (updated: PageDraft) => void;
  onClose: () => void;
}

type EditorTool = "crop" | "draw" | "text";

const PALETTE = ["#DC3545", "#007BFF", "#28A745", "#FFC107", "#212529", "#FFFFFF"];

export const ImageCanvasEditorModal: React.FC<ImageCanvasEditorModalProps> = ({
  draft,
  imageSrc,
  onSave,
  onClose,
}) => {
  const { t } = useI18n();

  const [tool, setTool] = React.useState<EditorTool>("draw");
  const [rotationDeg, setRotationDeg] = React.useState(draft.rotation_deg);
  const [crop, setCrop] = React.useState<CropRect | null>(draft.crop);
  const [annotations, setAnnotations] = React.useState<AnnotationLayer>(draft.annotations);

  const [colorHex, setColorHex] = React.useState("#DC3545");
  const [strokeWidthRatio, setStrokeWidthRatio] = React.useState(0.008);
  const [fontSizeRatio, setFontSizeRatio] = React.useState(0.05);
  const [textInput, setTextInput] = React.useState(t.canvasEditor.defaultText);

  const [imgEl, setImgEl] = React.useState<HTMLImageElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const [activeStroke, setActiveStroke] = React.useState<[number, number][] | null>(null);
  const [cropDragStart, setCropDragStart] = React.useState<[number, number] | null>(null);
  const [cropDragCurr, setCropDragCurr] = React.useState<[number, number] | null>(null);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = imageSrc;
  }, [imageSrc]);

  const drawPreview = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const showFullForCrop = tool === "crop";
    const srcX = !showFullForCrop && crop ? crop.x * imgEl.width : 0;
    const srcY = !showFullForCrop && crop ? crop.y * imgEl.height : 0;
    const srcW = !showFullForCrop && crop ? crop.width * imgEl.width : imgEl.width;
    const srcH = !showFullForCrop && crop ? crop.height * imgEl.height : imgEl.height;

    const rot = ((rotationDeg % 360) + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const logicalW = showFullForCrop ? imgEl.width : swapped ? srcH : srcW;
    const logicalH = showFullForCrop ? imgEl.height : swapped ? srcW : srcH;

    const maxW = 780;
    const maxH = 520;
    const scale = Math.min(maxW / logicalW, maxH / logicalH, 1.5);
    const cw = Math.max(100, Math.round(logicalW * scale));
    const ch = Math.max(100, Math.round(logicalH * scale));
    canvas.width = cw;
    canvas.height = ch;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);

    if (showFullForCrop) {
      ctx.drawImage(imgEl, 0, 0, cw, ch);
      const rect =
        cropDragStart && cropDragCurr
          ? normalizeRect(cropDragStart, cropDragCurr)
          : crop;
      if (rect) {
        ctx.fillStyle = "rgba(33, 37, 41, 0.45)";
        ctx.fillRect(0, 0, cw, ch);
        const rx = rect.x * cw;
        const ry = rect.y * ch;
        const rw = rect.width * cw;
        const rh = rect.height * ch;
        ctx.drawImage(
          imgEl,
          rect.x * imgEl.width,
          rect.y * imgEl.height,
          rect.width * imgEl.width,
          rect.height * imgEl.height,
          rx,
          ry,
          rw,
          rh,
        );
        ctx.strokeStyle = "#007BFF";
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
      }
      return;
    }

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rot * Math.PI) / 180);
    const drawW = swapped ? ch : cw;
    const drawH = swapped ? cw : ch;
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    const minDim = Math.min(cw, ch);
    const allStrokes: { points: [number, number][]; color: string; ratio: number }[] = [
      ...annotations.strokes.map((s) => ({
        points: s.points,
        color: s.color_hex,
        ratio: s.stroke_width_ratio,
      })),
    ];
    if (activeStroke && activeStroke.length > 0) {
      allStrokes.push({ points: activeStroke, color: colorHex, ratio: strokeWidthRatio });
    }

    for (const s of allStrokes) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = Math.max(2, minDim * s.ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.points.length === 1) {
        ctx.beginPath();
        ctx.arc(s.points[0][0] * cw, s.points[0][1] * ch, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(s.points[0][0] * cw, s.points[0][1] * ch);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i][0] * cw, s.points[i][1] * ch);
        }
        ctx.stroke();
      }
    }

    for (const item of annotations.texts) {
      const px = Math.max(10, ch * item.font_size_ratio);
      ctx.fillStyle = item.color_hex;
      ctx.font = `600 ${px}px Lora, serif`;
      ctx.textBaseline = "top";
      item.text.split("\n").forEach((line, idx) => {
        ctx.fillText(line, item.x * cw, item.y * ch + idx * (px * 1.15));
      });
    }
  }, [
    imgEl,
    tool,
    crop,
    rotationDeg,
    annotations,
    activeStroke,
    cropDragStart,
    cropDragCurr,
    colorHex,
    strokeWidthRatio,
  ]);

  React.useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [nx, ny];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toNorm(e);
    if (tool === "crop") {
      setCropDragStart(pt);
      setCropDragCurr(pt);
    } else if (tool === "draw") {
      setActiveStroke([pt]);
    } else if (tool === "text") {
      const content = textInput.trim();
      if (!content) return;
      const newText: TextAnnotation = {
        id: crypto.randomUUID(),
        text: content,
        x: pt[0],
        y: pt[1],
        font_size_ratio: fontSizeRatio,
        color_hex: colorHex,
      };
      setAnnotations((prev) => ({ ...prev, texts: [...prev.texts, newText] }));
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = toNorm(e);
    if (tool === "crop" && cropDragStart) {
      setCropDragCurr(pt);
    } else if (tool === "draw" && activeStroke) {
      setActiveStroke((prev) => (prev ? [...prev, pt] : [pt]));
    }
  };

  const handlePointerUp = () => {
    if (tool === "crop" && cropDragStart && cropDragCurr) {
      const next = normalizeRect(cropDragStart, cropDragCurr);
      if (next.width >= 0.03 && next.height >= 0.03) {
        setCrop(next);
      }
      setCropDragStart(null);
      setCropDragCurr(null);
    } else if (tool === "draw" && activeStroke && activeStroke.length > 0) {
      const stroke: StrokeAnnotation = {
        id: crypto.randomUUID(),
        points: activeStroke,
        stroke_width_ratio: strokeWidthRatio,
        color_hex: colorHex,
      };
      setAnnotations((prev) => ({ ...prev, strokes: [...prev.strokes, stroke] }));
      setActiveStroke(null);
    }
  };

  const handleUndoAnnotation = () => {
    if (tool === "text" && annotations.texts.length > 0) {
      setAnnotations((prev) => ({ ...prev, texts: prev.texts.slice(0, -1) }));
    } else if (annotations.strokes.length > 0) {
      setAnnotations((prev) => ({ ...prev, strokes: prev.strokes.slice(0, -1) }));
    } else if (annotations.texts.length > 0) {
      setAnnotations((prev) => ({ ...prev, texts: prev.texts.slice(0, -1) }));
    }
  };

  const handleSave = () => {
    onSave({
      ...draft,
      rotation_deg: rotationDeg,
      crop,
      annotations,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[4px] border border-[#CED4DA] bg-white">
        <div className="flex items-center justify-between border-b border-[#DEE2E6] px-4 py-2.5">
          <div>
            <div className="text-base font-bold text-[#212529]">
              {t.canvasEditor.title(draft.label)}
            </div>
            <div className="text-xs text-[#6C757D]">{t.canvasEditor.subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] p-1 text-[#6C757D] hover:bg-[#F8F9FA] hover:text-[#212529]"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2">
          <button
            type="button"
            onClick={() => setTool("crop")}
            className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-xs font-semibold ${
              tool === "crop"
                ? "bg-[#007BFF] text-white"
                : "border border-[#CED4DA] bg-white text-[#343A40]"
            }`}
          >
            <Crop className="h-3.5 w-3.5" />
            {t.canvasEditor.cropTool}
          </button>
          <button
            type="button"
            onClick={() => setTool("draw")}
            className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-xs font-semibold ${
              tool === "draw"
                ? "bg-[#007BFF] text-white"
                : "border border-[#CED4DA] bg-white text-[#343A40]"
            }`}
          >
            <PenTool className="h-3.5 w-3.5" />
            {t.canvasEditor.drawTool}
          </button>
          <button
            type="button"
            onClick={() => setTool("text")}
            className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-xs font-semibold ${
              tool === "text"
                ? "bg-[#007BFF] text-white"
                : "border border-[#CED4DA] bg-white text-[#343A40]"
            }`}
          >
            <Type className="h-3.5 w-3.5" />
            {t.canvasEditor.textTool}
          </button>

          <div className="h-5 w-px bg-[#DEE2E6]" />

          <button
            type="button"
            onClick={() => setRotationDeg((r) => (r + 90) % 360)}
            className="flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-3 py-1.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t.canvasEditor.rotate90(rotationDeg)}
          </button>

          {crop && (
            <button
              type="button"
              onClick={() => setCrop(null)}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-3 py-1.5 text-xs text-[#6C757D] hover:bg-[#E9ECEF]"
            >
              {t.canvasEditor.clearCrop}
            </button>
          )}

          <div className="h-5 w-px bg-[#DEE2E6]" />

          <div className="flex items-center gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColorHex(c)}
                className={`h-5 w-5 rounded-[4px] border ${
                  colorHex === c ? "ring-2 ring-[#007BFF] border-white" : "border-[#CED4DA]"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          {tool === "draw" && (
            <label className="flex items-center gap-1.5 text-xs text-[#495057]">
              {t.canvasEditor.strokeLabel}
              <input
                type="range"
                min={0.003}
                max={0.025}
                step={0.001}
                value={strokeWidthRatio}
                onChange={(e) => setStrokeWidthRatio(Number(e.target.value))}
              />
            </label>
          )}

          {tool === "text" && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={t.canvasEditor.textPlaceholder}
                className="w-56 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs"
              />
              <label className="flex items-center gap-1 text-xs text-[#495057]">
                {t.canvasEditor.fontSizeLabel}
                <input
                  type="range"
                  min={0.02}
                  max={0.14}
                  step={0.005}
                  value={fontSizeRatio}
                  onChange={(e) => setFontSizeRatio(Number(e.target.value))}
                />
              </label>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndoAnnotation}
              className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs text-[#343A40] hover:bg-[#E9ECEF]"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t.canvasEditor.undoAnnotation}
            </button>
            <button
              type="button"
              onClick={() => setAnnotations({ texts: [], strokes: [] })}
              className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.canvasEditor.clearAnnotations}
            </button>
          </div>
        </div>

        {/* Canvas Workspace */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[#E9ECEF] p-4">
          {!imgEl ? (
            <div className="text-sm text-[#6C757D]">{t.canvasEditor.loadingPreview}</div>
          ) : (
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="cursor-crosshair border border-[#CED4DA] bg-white"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#DEE2E6] px-4 py-3">
          <div className="text-xs text-[#6C757D]">
            {tool === "crop"
              ? t.canvasEditor.cropHint
              : tool === "text"
                ? t.canvasEditor.textHint
                : t.canvasEditor.drawHint}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-4 py-1.5 text-sm font-semibold text-[#343A40] hover:bg-[#F8F9FA]"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-[4px] bg-[#007BFF] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0069D9]"
            >
              {t.common.applyChanges}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function normalizeRect(a: [number, number], b: [number, number]): CropRect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const width = Math.abs(b[0] - a[0]);
  const height = Math.abs(b[1] - a[1]);
  return { x, y, width, height };
}
