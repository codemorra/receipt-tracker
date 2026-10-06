import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Chart as ChartJS,
  BarElement,
  BarController,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { SpendingDto } from "../../api/analytics-api";

// Register Chart.js components for the bar chart.
ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
);

/**
 * Reads the current CSS custom properties for the chart colors.
 * @returns An object containing the resolved color values.
 */
function readColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue("--accent").trim(),
    text: style.getPropertyValue("--muted").trim(),
    grid: style.getPropertyValue("--border").trim(),
    surface: style.getPropertyValue("--surface").trim(),
    foreground: style.getPropertyValue("--text").trim(),
  };
}

/**
 * Component for rendering a spending chart using Chart.js.
 * @param data The spending data to display in the chart.
 */
export default function SpendingChart({ data }: { data: SpendingDto }) {
  const { t, i18n } = useTranslation();
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => observer.disconnect();
  }, []);
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: data.currency ?? "EUR",
  });
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        ticks: { color: colors.text, maxTicksLimit: 10 },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
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
          label: (context) => money.format(Number(context.raw) / 100),
          afterLabel: (context) =>
            t("pages.analytics.spending.receiptCount", {
              count: data.timeline[context.dataIndex].receiptCount,
            }),
        },
      },
    },
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {t(`pages.analytics.spending.granularity.${data.granularity}`)}
      </p>
      <div className="relative h-72 min-w-0">
        <Bar
          options={options}
          data={{
            labels: data.timeline.map((row) =>
              date.format(new Date(`${row.period}T00:00:00Z`)),
            ),
            datasets: [
              {
                label: t("pages.analytics.spending.total"),
                data: data.timeline.map((row) => row.totalCents),
                backgroundColor: colors.accent,
                maxBarThickness: 40,
              },
            ],
          }}
          role="img"
          aria-label={t("pages.analytics.spending.chartLabel")}
        />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer rounded text-accent">
          {t("pages.analytics.spending.timelineData")}
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {t("pages.analytics.spending.chartLabel")}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-2">
                  {t("pages.analytics.spending.period")}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t("pages.analytics.spending.receipts")}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t("pages.analytics.spending.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((row) => (
                <tr key={row.period} className="border-t border-shell">
                  <td className="py-2">
                    <time dateTime={row.period}>
                      {date.format(new Date(`${row.period}T00:00:00Z`))}
                    </time>
                  </td>
                  <td className="py-2 text-right">{row.receiptCount}</td>
                  <td className="py-2 text-right tabular-nums">
                    {money.format(row.totalCents / 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
