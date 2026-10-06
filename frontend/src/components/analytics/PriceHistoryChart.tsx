import { useTranslation } from "react-i18next";
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { PriceHistoryDto } from "../../api/analytics-api";
import {
  DAY_MS,
  priceChartPoints,
  type PricePoint,
} from "../../analytics/price-history";
import { useChartColors } from "../../hooks/useChartColors";

// Register necessary Chart.js components for the line chart.
ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
);

/**
 * Component for rendering a price history chart for a specific product.
 * @param data The price history data to display.
 * @returns A JSX element containing the chart.
 */
export default function PriceHistoryChart({ data }: { data: PriceHistoryDto }) {
  const { t, i18n } = useTranslation();
  const colors = useChartColors();
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: data.currency ?? "EUR",
  });
  const points = priceChartPoints(data.history);
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        type: "linear",
        ticks: {
          color: colors.text,
          maxTicksLimit: 6,
          precision: 0,
          callback: (value) => date.format(new Date(Number(value) * DAY_MS)),
        },
        grid: { display: false },
      },
      y: {
        ticks: {
          color: colors.text,
          callback: (value) => money.format(Number(value) / 100),
        },
        grid: { color: colors.grid },
      },
    },
    plugins: {
      tooltip: {
        backgroundColor: colors.surface,
        titleColor: colors.foreground,
        bodyColor: colors.foreground,
        borderColor: colors.grid,
        borderWidth: 1,
        callbacks: {
          title: (contexts) => {
            const point = contexts[0]?.raw as PricePoint | undefined;
            return point
              ? `${date.format(new Date(point.x * DAY_MS))}${point.purchase.purchaseTime ? ` · ${point.purchase.purchaseTime}` : ""}`
              : "";
          },
          label: (context) => money.format((context.raw as PricePoint).y / 100),
          afterLabel: (context) => {
            const row = (context.raw as PricePoint).purchase;
            return [
              row.merchantName,
              t("pages.analytics.priceHistory.receiptId", {
                id: row.receiptId,
              }),
            ];
          },
        },
      },
    },
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {t("pages.analytics.priceHistory.priceBasis")}
      </p>
      <div className="relative h-72 min-w-0">
        <Line
          options={options}
          data={{
            datasets: [
              {
                label: t("pages.analytics.priceHistory.unitPrice"),
                data: points,
                borderColor: colors.accent,
                backgroundColor: colors.accent,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointHitRadius: 10,
                borderWidth: 2,
                tension: 0,
              },
            ],
          }}
          role="img"
          aria-label={t("pages.analytics.priceHistory.chartLabel")}
        />
      </div>
    </div>
  );
}
