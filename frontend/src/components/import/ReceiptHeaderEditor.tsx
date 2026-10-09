import { useState } from "react";
import { isValidDate, parseCents } from "../../review/review-state";
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
  const { t, i18n } = useTranslation();
  const { draft, updateReceipt, selectMerchant, reportError } = controller;
  const [expanded, setExpanded] = useState(false);
  const invalid = controller.issues.some((issue) =>
    ["merchant", "purchaseDate", "purchaseTime", "currency", "total"].includes(
      issue.code,
    ),
  );
  const date = isValidDate(draft.purchaseDate)
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${draft.purchaseDate}T00:00:00Z`))
    : "—";
  const cents = parseCents(draft.total);
  const total =
    cents === null
      ? "—"
      : new Intl.NumberFormat(
          i18n.language,
          /^[A-Z]{3}$/.test(draft.currency)
            ? { style: "currency", currency: draft.currency }
            : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        ).format(cents / 100);
  return (
    <details
      open={expanded || invalid || draft.merchantMatchStatus === "SUGGESTED"}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="rounded-xl border border-shell p-4"
    >
      <summary
        className="cursor-pointer space-y-2"
        onClick={(event) => {
          if (invalid) event.preventDefault();
        }}
      >
        <span className="text-sm font-semibold">
          {t("pages.import.review.receiptInfo")}
        </span>
        <span className="ml-3 text-xs text-accent">
          {t("pages.import.review.editHeader")}
        </span>
        <span className="block text-sm wrap-break-word">
          {draft.merchantName || "—"} · {date} · {total}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
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
    </details>
  );
}
