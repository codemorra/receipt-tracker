import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Component for displaying detailed information about a saved receipt, including its items, discounts, and warranties.
interface SavedReceipt {
  id: number;
  merchantName: string;
  merchantRawName: string | null;
  purchaseDate: string;
  purchaseTime: string | null;
  totalCents: number;
  currency: string;
  imageUrl: string;
  items: {
    id: number;
    position: number;
    rawName: string;
    quantity: number;
    unit: string | null;
    unitPriceCents: number | null;
    totalPriceCents: number;
    lineType: string;
    product: null | {
      id: number;
      name: string;
      brandName: string | null;
      productGroupName: string | null;
      categoryName: string | null;
      packageAmount: number | null;
      packageUnit: string | null;
    };
    warranties: {
      id: number;
      type: string;
      startDate: string;
      endDate: string;
      notes: string | null;
    }[];
  }[];
  discounts: {
    id: number;
    receiptItemId: number | null;
    description: string | null;
    amountCents: number;
  }[];
}

// Component for displaying detailed information about a saved receipt.
function SavedReceiptDetail({ receiptId }: { receiptId: number }) {
  const { t, i18n } = useTranslation();
  const [receipt, setReceipt] = useState<SavedReceipt | null>(null);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/receipts/${receiptId}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Receipt detail failed");
        return response.json() as Promise<SavedReceipt>;
      })
      .then((saved) => {
        setReceipt(saved);
        setError("");
        setImageError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("detail.loadFailed");
      });
    return () => controller.abort();
  }, [receiptId]);

  if (error)
    return (
      <p role="alert" className="mt-8 text-red-700">
        {t(error)}
      </p>
    );
  if (!receipt)
    return (
      <p role="status" className="mt-8">
        {t("detail.loading")}
      </p>
    );

  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: receipt.currency,
    }).format(cents / 100);
  const categoryLabel = (name: string) =>
    i18n.exists(`review.categories.${name}`)
      ? t(`review.categories.${name}`)
      : name;
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00.000Z`));

  return (
    <section
      aria-labelledby="saved-receipt-heading"
      className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header>
        <h2 id="saved-receipt-heading" className="text-2xl font-semibold">
          {t("detail.heading", { id: receipt.id })}
        </h2>
        <p className="mt-2 text-lg">{receipt.merchantName}</p>
        {receipt.merchantRawName &&
          receipt.merchantRawName !== receipt.merchantName && (
            <p className="text-sm text-slate-600">
              {t("detail.receiptMerchant")}: {receipt.merchantRawName}
            </p>
          )}
        <p className="text-slate-700">
          {date(receipt.purchaseDate)} {receipt.purchaseTime ?? ""}
        </p>
        <p className="text-xl font-semibold">{money(receipt.totalCents)}</p>
        <p className="text-sm text-slate-600">
          {t("detail.currency")}: {receipt.currency}
        </p>
      </header>
      {imageError ? (
        <p role="alert" className="text-red-700">
          {t("detail.imageMissing")}
        </p>
      ) : (
        <img
          src={receipt.imageUrl}
          alt={t("detail.imageAlt")}
          onError={() => setImageError(true)}
          className="mx-auto max-h-192 max-w-full rounded-lg border border-slate-200 object-contain"
        />
      )}
      <section aria-labelledby="saved-items-heading" className="space-y-3">
        <h3 id="saved-items-heading" className="text-lg font-semibold">
          {t("detail.items")}
        </h3>
        {receipt.items.map((item) => (
          <article
            key={item.id}
            className="rounded-lg border border-slate-200 p-4"
          >
            <div className="flex justify-between gap-4">
              <p className="font-semibold">{item.rawName}</p>
              <p className="font-semibold">{money(item.totalPriceCents)}</p>
            </div>
            <p className="text-sm text-slate-700">
              {t("detail.quantity")}: {item.quantity} {item.unit ?? ""} ·{" "}
              {t("detail.unitPrice")}:{" "}
              {item.unitPriceCents === null ? "—" : money(item.unitPriceCents)}
            </p>
            <p className="text-sm text-slate-600">
              {t("detail.lineType")}: {t(`review.lineTypes.${item.lineType}`)}
            </p>
            {item.product && (
              <div className="mt-2 text-sm text-slate-700">
                <p>
                  {t("detail.product")}: {item.product.name}
                </p>
                {item.product.brandName && (
                  <p>
                    {t("detail.brand")}: {item.product.brandName}
                  </p>
                )}
                {item.product.productGroupName && (
                  <p>
                    {t("detail.productGroup")}: {item.product.productGroupName}
                  </p>
                )}
                {item.product.categoryName && (
                  <p>
                    {t("detail.category")}:{" "}
                    {categoryLabel(item.product.categoryName)}
                  </p>
                )}
                {item.product.packageAmount !== null && (
                  <p>
                    {t("detail.package")}: {item.product.packageAmount}{" "}
                    {item.product.packageUnit ?? ""}
                  </p>
                )}
              </div>
            )}
            {item.warranties.length > 0 && (
              <div className="mt-3 space-y-1 text-sm">
                <h4 className="font-semibold">{t("detail.warranties")}</h4>
                {item.warranties.map((warranty) => (
                  <p key={warranty.id}>
                    {t(`review.warrantyTypes.${warranty.type}`)}:{" "}
                    {date(warranty.startDate)} – {date(warranty.endDate)}
                    {warranty.notes ? ` · ${warranty.notes}` : ""}
                  </p>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      {receipt.discounts.length > 0 && (
        <section
          aria-labelledby="saved-discounts-heading"
          className="space-y-2"
        >
          <h3 id="saved-discounts-heading" className="text-lg font-semibold">
            {t("detail.discounts")}
          </h3>
          {receipt.discounts.map((discount) => {
            const item = receipt.items.find(
              (entry) => entry.id === discount.receiptItemId,
            );
            return (
              <p key={discount.id}>
                {discount.description ?? t("detail.discount")} ·{" "}
                {item?.rawName ?? t("detail.wholeReceipt")} · −
                {money(discount.amountCents)}
              </p>
            );
          })}
        </section>
      )}
    </section>
  );
}

export default SavedReceiptDetail;
