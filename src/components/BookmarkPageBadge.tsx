import React from "react";
import { Bookmark } from "lucide-react";

interface BookmarkPageBadgeProps {
  titles?: string[];
  tooltipText?: string;
  className?: string;
}

export const BookmarkPageBadge: React.FC<BookmarkPageBadgeProps> = ({
  titles,
  tooltipText,
  className = "",
}) => {
  if (!titles || titles.length === 0) return null;
  const primary = titles[0];
  const extra = titles.length > 1 ? ` +${titles.length - 1}` : "";
  const titleAttr = tooltipText ?? titles.join(" · ");

  return (
    <span
      title={titleAttr}
      data-testid="page-bookmark-badge"
      className={`inline-flex max-w-[140px] items-center gap-1 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#0056B3] ${className}`}
    >
      <Bookmark className="h-2.5 w-2.5 shrink-0 fill-current text-[#007BFF]" />
      <span className="truncate">{primary}</span>
      {extra && <span className="shrink-0 font-mono-code">{extra}</span>}
    </span>
  );
};
