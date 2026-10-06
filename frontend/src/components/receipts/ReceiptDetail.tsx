import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SavedReceipt } from "../../api/receipt-api";
import { savedReceiptToSummary } from "../../receipts/receipt-summary";
import Card from "../ui/Card";
import ReceiptArchiveImage from "./ReceiptArchiveImage";
import ReceiptSummary from "./ReceiptSummary";

/**
 * Shared saved-receipt content for the post-save page and archive detail modal.
 * @param receipt The saved receipt to display.
 * @param status Optional status content to display alongside the receipt summary.
 */
export default function ReceiptDetail({
  receipt,
  status,
  panel = false,
}: {
  receipt: SavedReceipt;
  status?: ReactNode;
  panel?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] ${panel ? "h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-1" : "items-start"}`}
    >
      <Card
        className={`min-w-0 p-5 sm:p-6 ${panel ? "min-h-0 overflow-y-auto overscroll-contain scrollbar-gutter-stable" : ""}`}
      >
        <h3 className="mb-5 text-lg font-semibold">
          {t("pages.receiptDetail.archive")}
        </h3>
        <ReceiptArchiveImage
          url={receipt.imageUrl}
          alt={t("pages.receiptDetail.imageAlt")}
        />
      </Card>
      <div
        className={`min-w-0 ${panel ? "min-h-0 overflow-y-auto overscroll-contain pr-3 scrollbar-gutter-stable" : ""}`}
      >
        <ReceiptSummary
          receipt={savedReceiptToSummary(receipt)}
          status={status}
        />
      </div>
    </div>
  );
}
