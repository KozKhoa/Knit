import React from "react";

interface ErrorBannerProps {
  message: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/** Shared flat alert banner for tool errors and conflict warnings. */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  icon,
  className = "",
}) => {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`knit-alert-error px-3.5 py-2.5 text-sm ${icon ? "flex items-center gap-2" : ""} ${className}`}
    >
      {icon}
      <span>{message}</span>
    </div>
  );
};
