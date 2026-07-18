import { useCallback, useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { openExternalUrl } from "../lib/desktop";
import { getSafeMarkdownImageUrl, getSafeMarkdownLinkUrl, transformMarkdownUrl } from "../lib/markdown";
import { getSafeErrorMessage } from "../lib/redaction";

export type MarkdownContentProps = {
  content: string;
  emptyText?: string;
  compact?: boolean;
  className?: string;
  onOpenExternal?: (url: string) => Promise<void> | void;
};

const remarkPlugins = [remarkGfm, remarkBreaks];
const rehypePlugins = [rehypeSanitize];

export function MarkdownContent({
  content,
  emptyText = "还没有正文内容。",
  compact = false,
  className = "",
  onOpenExternal,
}: MarkdownContentProps) {
  const [linkError, setLinkError] = useState("");
  useEffect(() => setLinkError(""), [content]);
  const openLink = useCallback((url: string) => {
    setLinkError("");
    void Promise.resolve(onOpenExternal ? onOpenExternal(url) : openExternalUrl(url)).catch((error) => {
      setLinkError(getSafeErrorMessage(error, "无法打开这个链接，请稍后重试。"));
    });
  }, [onOpenExternal]);
  const components = useMemo<Components>(() => ({
    a: ({ children, href, node: _node, ...props }) => {
      const safeHref = getSafeMarkdownLinkUrl(href);
      if (!safeHref) {
        return <span className="markdown-link-blocked" title="此链接地址不受支持">{children}</span>;
      }
      if (safeHref.startsWith("#")) {
        return <a {...props} className="markdown-link" href={safeHref}>{children}</a>;
      }
      return (
        <a
          {...props}
          className="markdown-link"
          href={safeHref}
          onClick={(event) => {
            event.preventDefault();
            openLink(safeHref);
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ node: _node, ...props }) => <MarkdownImage {...props} />,
    input: ({ node: _node, ...props }) => <input {...props} disabled readOnly />,
    table: ({ children, node: _node, ...props }) => (
      <div className="markdown-table-scroll scrollbar-thin">
        <table {...props}>{children}</table>
      </div>
    ),
  }), [openLink]);
  const trimmed = content.trim();

  if (!trimmed) {
    return <p className={`markdown-empty ${className}`.trim()}>{emptyText}</p>;
  }

  return (
    <div className={`${compact ? "markdown-body markdown-body-compact" : "markdown-body"} ${className}`.trim()}>
      <Markdown
        components={components}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        skipHtml
        urlTransform={transformMarkdownUrl}
      >
        {content}
      </Markdown>
      {linkError && <p className="markdown-link-error" role="alert">{linkError}</p>}
    </div>
  );
}

function MarkdownImage({ src, alt, title }: ImgHTMLAttributes<HTMLImageElement>) {
  const safeSrc = getSafeMarkdownImageUrl(typeof src === "string" ? src : undefined);
  const [failed, setFailed] = useState(false);
  const label = alt?.trim() || "Markdown 图片";

  useEffect(() => setFailed(false), [safeSrc]);

  if (!safeSrc || failed) {
    return (
      <span className="markdown-image-fallback" role="img" aria-label={label} title={title}>
        <span className="markdown-image-fallback-label">图片无法加载</span>
        <span className="markdown-image-fallback-alt">{label}</span>
      </span>
    );
  }

  return (
    <span className="markdown-image-frame">
      <img
        alt={label}
        decoding="async"
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={safeSrc}
        title={title}
      />
      {alt?.trim() && <span className="markdown-image-caption">{alt}</span>}
    </span>
  );
}
