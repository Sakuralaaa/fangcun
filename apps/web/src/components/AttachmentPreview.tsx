import type { Attachment } from "@fangcun/core";
import clsx from "clsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  File,
  FileCode2,
  FileImage,
  FileText,
  Film,
  Music,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui";

export type AttachmentKind = "pdf" | "image" | "text" | "video" | "audio" | "other";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const TEXT_EXT = new Set(["txt", "md", "markdown", "json", "csv", "xml", "yaml", "yml", "log", "ini", "conf", "pem", "crt", "cer", "key", "pub", "html", "htm", "svg", "css", "js", "ts", "sh", "toml"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a"]);

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function attachmentKind(f: Pick<Attachment, "name" | "mime">): AttachmentKind {
  const ext = fileExt(f.name);
  const mime = (f.mime ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (IMAGE_EXT.has(ext) || (mime.startsWith("image/") && !mime.includes("svg"))) return "image";
  if (VIDEO_EXT.has(ext) || mime.startsWith("video/")) return "video";
  if (AUDIO_EXT.has(ext) || mime.startsWith("audio/")) return "audio";
  if (TEXT_EXT.has(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") return "text";
  return "other";
}

export const canPreviewAttachment = (f: Pick<Attachment, "name" | "mime">) => attachmentKind(f) !== "other";

export function attachmentUrls(assetId: string, name: string) {
  const base = `/api/assets/${encodeURIComponent(assetId)}/attachments/${encodeURIComponent(name)}`;
  return { download: base, inline: `${base}?inline=1` };
}

export function AttachmentBadge({ file }: { file: Pick<Attachment, "name" | "mime"> }) {
  const kind = attachmentKind(file);
  const ext = fileExt(file.name).toUpperCase();
  const cfg = {
    pdf: { icon: FileText, cls: "bg-crit-soft text-crit", label: "PDF" },
    image: { icon: FileImage, cls: "bg-t-domain-soft text-t-domain", label: ext || "图片" },
    text: { icon: FileCode2, cls: "bg-t-server-soft text-t-server", label: ext || "文本" },
    video: { icon: Film, cls: "bg-t-mail-soft text-t-mail", label: ext || "视频" },
    audio: { icon: Music, cls: "bg-t-account-soft text-t-account", label: ext || "音频" },
    other: { icon: File, cls: "bg-field text-muted", label: ext || "文件" },
  }[kind];
  const Icon = cfg.icon;
  return (
    <span className={clsx("grid size-7 shrink-0 place-items-center rounded-[7px]", cfg.cls)} title={cfg.label}>
      <Icon size={14} strokeWidth={1.9} />
    </span>
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes > 102400 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sample text returned in ?demo=1 mode so users can test inline document viewing without a backend. */
const DEMO_CONTENT: Record<string, string> = {
  "域名转移授权说明.md": `# 域名转移授权说明

- 域名：starbridge.example
- 转移锁状态：已开启（转移前需在注册商控制台解锁）
- 授权码获取位置：注册商控制台 → 域名安全 → 获取 EPP / Auth Code
- 联系人：sak@starbridge.example

> 演示模式下展示示例文本内容；连接方寸服务端后，支持直接在线预览 PDF、图片、文本、JSON、CSV、证书与音视频附件。`,
};

export function AttachmentPreviewModal({
  assetId,
  files,
  index,
  demo,
  onIndex,
  onClose,
}: {
  assetId: string;
  files: Attachment[];
  index: number;
  demo?: boolean;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const file = files[index];
  const [zoom, setZoom] = useState(1);
  const [text, setText] = useState<string | null>(null);
  const [textErr, setTextErr] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prettyJson, setPrettyJson] = useState(true);

  const kind = file ? attachmentKind(file) : "other";
  const urls = file ? attachmentUrls(assetId, file.name) : { download: "", inline: "" };
  const hasMany = files.length > 1;

  useEffect(() => {
    setZoom(1);
    setCopied(false);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (hasMany && e.key === "ArrowLeft") onIndex((index - 1 + files.length) % files.length);
      else if (hasMany && e.key === "ArrowRight") onIndex((index + 1) % files.length);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, hasMany, index, files.length, onIndex]);

  useEffect(() => {
    if (!file || kind !== "text") {
      setText(null);
      setTextErr(null);
      setLoadingText(false);
      return;
    }
    if (demo) {
      setText(DEMO_CONTENT[file.name] ?? `演示附件：${file.name}\n\n（演示模式不含真实服务端文件；正式部署后可直接在线预览文件内容。）`);
      setTextErr(null);
      setLoadingText(false);
      return;
    }
    const ctrl = new AbortController();
    setLoadingText(true);
    setTextErr(null);
    fetch(urls.inline, { credentials: "same-origin", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载失败 (${res.status})`);
        return res.text();
      })
      .then((content) => {
        setText(content);
        setLoadingText(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setTextErr((e as Error).message);
        setLoadingText(false);
      });
    return () => ctrl.abort();
  }, [file, kind, urls.inline, demo]);

  if (!file) return null;

  const isJson = fileExt(file.name) === "json" || file.mime === "application/json";
  const displayText = (() => {
    if (text === null) return "";
    if (isJson && prettyJson) {
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    }
    return text;
  })();

  const copyText = () => {
    if (!displayText) return;
    navigator.clipboard?.writeText(displayText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${file.name}`}
        className="fc-animate-pop flex h-[min(88vh,860px)] w-full max-w-[1040px] flex-col overflow-hidden rounded-lg border border-line bg-panel"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {/* Top Toolbar */}
        <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2">
          <AttachmentBadge file={file} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold" title={file.name}>{file.name}</h2>
            <p className="text-[11.5px] text-subtle tnum">
              {formatFileSize(file.size)} · {file.addedAt.slice(0, 10)}
              {hasMany && ` · 第 ${index + 1} / ${files.length} 个附件`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {hasMany && (
              <div className="mr-1 inline-flex items-center rounded-sm border border-line bg-bg p-0.5">
                <button
                  type="button"
                  onClick={() => onIndex((index - 1 + files.length) % files.length)}
                  title="上一个 (←)"
                  aria-label="上一个附件"
                  className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-field hover:text-ink"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => onIndex((index + 1) % files.length)}
                  title="下一个 (→)"
                  aria-label="下一个附件"
                  className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-field hover:text-ink"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}

            {kind === "image" && (
              <div className="mr-1 inline-flex items-center rounded-sm border border-line bg-bg p-0.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}
                  title="缩小"
                  className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-field hover:text-ink"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="px-1.5 text-xs text-muted tnum">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                  title="放大"
                  className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-field hover:text-ink"
                >
                  <ZoomIn size={14} />
                </button>
                {zoom !== 1 && (
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    title="重置缩放"
                    className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-field hover:text-ink"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            )}

            {kind === "text" && text !== null && (
              <>
                {isJson && (
                  <Button className="h-8 px-2.5 text-xs" onClick={() => setPrettyJson((v) => !v)}>
                    {prettyJson ? "原始" : "格式化"}
                  </Button>
                )}
                <Button className="h-8 px-2.5 text-xs" icon={copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />} onClick={copyText}>
                  {copied ? "已复制" : "复制"}
                </Button>
              </>
            )}

            {!demo && canPreviewAttachment(file) && (
              <a
                href={urls.inline}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-panel px-2.5 text-xs font-medium text-ink transition-colors hover:bg-field"
              >
                <ExternalLink size={13} />
                <span className="max-sm:hidden">新标签页打开</span>
              </a>
            )}

            {!demo && (
              <a
                href={urls.download}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-2.5 text-xs font-medium text-on-accent transition-[filter] hover:brightness-110"
              >
                <Download size={13} />
                <span>下载</span>
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭预览"
              className="grid size-8 cursor-pointer place-items-center rounded-sm text-muted transition-colors hover:bg-field hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Preview Stage */}
        <div className="relative min-h-0 flex-1 overflow-auto bg-bg">
          {kind === "pdf" && (
            demo ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-crit-soft text-crit">
                  <FileText size={22} />
                </span>
                <p className="text-[14px] font-semibold">{file.name}</p>
                <p className="mt-1 max-w-md text-[13px] text-muted">
                  正式环境中会直接在此处内嵌 PDF 阅读器，也可点击右上角「新标签页打开」全屏阅读。
                </p>
              </div>
            ) : (
              <iframe
                src={`${urls.inline}#view=FitH`}
                title={file.name}
                className="h-full w-full border-0 bg-field"
              />
            )
          )}

          {kind === "image" && (
            <div className="grid min-h-full place-items-center p-6">
              <img
                src={urls.inline}
                alt={file.name}
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                className="max-h-full max-w-full rounded-sm object-contain shadow-sm transition-transform duration-150"
              />
            </div>
          )}

          {kind === "text" && (
            <div className="h-full overflow-auto p-5">
              {loadingText ? (
                <p className="py-12 text-center text-[13px] text-subtle">正在加载文件内容…</p>
              ) : textErr ? (
                <p className="rounded-sm bg-crit-soft px-4 py-3 text-[13px] text-crit">{textErr}</p>
              ) : (
                <pre className="m-0 rounded-md border border-line bg-panel p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-ink">
                  {displayText}
                </pre>
              )}
            </div>
          )}

          {kind === "video" && (
            <div className="grid h-full place-items-center p-6">
              <video src={urls.inline} controls className="max-h-full max-w-full rounded-md bg-black shadow-lg" />
            </div>
          )}

          {kind === "audio" && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
              <span className="grid size-14 place-items-center rounded-2xl bg-t-account-soft text-t-account">
                <Music size={26} />
              </span>
              <p className="text-[14px] font-semibold">{file.name}</p>
              <audio src={urls.inline} controls className="w-full max-w-md" />
            </div>
          )}

          {kind === "other" && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-field text-muted">
                <File size={26} />
              </span>
              <p className="text-[14px] font-semibold">{file.name}</p>
              <p className="mt-1 max-w-sm text-[13px] text-muted">
                该文件格式暂不支持浏览器内直接预览，你可以下载到本地查看。
              </p>
              {!demo && (
                <a
                  href={urls.download}
                  className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-[13px] font-medium text-on-accent hover:brightness-110"
                >
                  <Download size={14} />下载文件
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
