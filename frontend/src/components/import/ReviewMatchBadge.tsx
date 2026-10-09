import { useTranslation } from "react-i18next";
import type { MatchStatus } from "../../review/review-state";

/**
 * Renders a badge indicating the match status of a review item.
 * @param status - The match status of the item.
 * @param selected - Whether the item is currently selected.
 * @param applicable - Whether the match status is applicable.
 */
export default function ReviewMatchBadge({
  status,
  selected,
  applicable = true,
}: {
  status: MatchStatus | null;
  selected: boolean;
  applicable?: boolean;
}) {
  const { t } = useTranslation();
  const key = !applicable ? "none" : (status ?? (selected ? "manual" : "NEW"));
  const accented =
    key === "NEW" || (selected && key !== "MATCHED" && key !== "none");
  return (
    <span
      className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${accented ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}
    >
      {t(`pages.import.review.match.${key}`)}
    </span>
  );
}
