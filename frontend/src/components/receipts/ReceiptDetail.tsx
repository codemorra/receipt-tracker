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
}: {
  receipt: SavedReceipt;
  status?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <Card className="min-w-0 p-5 sm:p-6">
        <h3 className="mb-5 text-lg font-semibold">
          {t("pages.receiptDetail.archive")}
        </h3>
        <ReceiptArchiveImage
          url={receipt.imageUrl}
          alt={t("pages.receiptDetail.imageAlt")}
        />
      </Card>
      <ReceiptSummary
        receipt={savedReceiptToSummary(receipt)}
        status={status}
      />
    </div>
  );
}
