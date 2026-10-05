import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Component for displaying a receipt archive image with error handling.
 * @param url - The URL of the receipt archive image.
 * @param alt - The alt text for the image.
 * @param className - Additional CSS classes for the image element.
 */
export default function ReceiptArchiveImage({
  url,
  alt,
  className = "",
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return failedUrl === url ? (
    <p
      role="status"
      className="rounded-xl border border-shell bg-canvas/30 p-4 text-xs text-muted"
    >
      {t("pages.import.saved.imageMissing")}
    </p>
  ) : (
    <img
      src={url}
      alt={alt}
      onError={() => setFailedUrl(url)}
      className={`w-full rounded-lg object-contain shadow-soft ${className}`}
    />
  );
}
