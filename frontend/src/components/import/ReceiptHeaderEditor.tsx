import { useTranslation } from "react-i18next";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import { TextField } from "../ui/FormField";
import LookupField from "../ui/LookupField";
import ReviewMatchBadge from "./ReviewMatchBadge";

/**
 * Renders the editor for the receipt header, allowing the user to edit merchant information, purchase date and time, currency, and total amount.
 * @param controller - The controller for handling receipt review actions.
 */
export default function ReceiptHeaderEditor({
  controller,
}: {
  controller: ReturnType<typeof useReceiptReview>;
}) {
  const { t } = useTranslation();
  const { draft, updateReceipt, selectMerchant, reportError } = controller;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t("pages.import.review.receiptInfo")}
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <TextField
            label={t("pages.import.review.merchantName")}
            value={draft.merchantName}
            disabled={draft.merchantId !== null}
            onChange={(event) =>
              updateReceipt({
                merchantName: event.target.value,
                merchantMatchStatus: null,
              })
            }
          />
          <TextField
            label={t("pages.import.review.merchantRawName")}
            value={draft.merchantRawName}
            onChange={(event) =>
              updateReceipt({ merchantRawName: event.target.value })
            }
          />
        </div>
        <LookupField
          label={t("pages.import.review.existingMerchant")}
          kind="merchants"
          selectedId={draft.merchantId}
          selectedName={draft.merchantName}
          initialOptions={draft.merchantCandidates.map((option) => ({
            id: option.merchantId,
            name: option.name,
          }))}
          onSelect={selectMerchant}
          onError={reportError}
          footer={
            <ReviewMatchBadge
              status={draft.merchantMatchStatus}
              selected={draft.merchantId !== null}
            />
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField
          label={t("pages.import.review.purchaseDate")}
          type="date"
          value={draft.purchaseDate}
          onChange={(event) =>
            updateReceipt({ purchaseDate: event.target.value })
          }
        />
        <TextField
          label={t("pages.import.review.purchaseTime")}
          type="time"
          value={draft.purchaseTime}
          onChange={(event) =>
            updateReceipt({ purchaseTime: event.target.value })
          }
        />
        <TextField
          label={t("pages.import.review.currency")}
          maxLength={3}
          value={draft.currency}
          onChange={(event) =>
            updateReceipt({ currency: event.target.value.toUpperCase() })
          }
        />
        <TextField
          label={t("pages.import.review.total")}
          inputMode="decimal"
          value={draft.total}
          onChange={(event) => updateReceipt({ total: event.target.value })}
        />
      </div>
    </div>
  );
}
