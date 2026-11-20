import React from "react";

interface ViewHeaderProps {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}

/** Standard tool page header with title, subtitle, and top-right CTA slot. */
export const ViewHeader: React.FC<ViewHeaderProps> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 className="text-xl font-bold text-[#212529]">{title}</h1>
      <p className="text-sm text-[#6C757D]">{subtitle}</p>
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);
