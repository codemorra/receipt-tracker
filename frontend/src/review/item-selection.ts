/**
 * Returns the ID of the currently selected item if it exists in the list, otherwise null.
 * @param items - The list of items to check against.
 * @param selected - The ID of the currently selected item.
 * @returns The ID of the selected item if it exists in the list, otherwise null.
 */
export function selectedItemId(
  items: readonly { id: string }[],
  selected: string | null,
): string | null {
  return items.some((item) => item.id === selected) ? selected : null;
}

/**
 * Toggles the selection of an item.
 * @param selected - The ID of the currently selected item.
 * @param clicked - The ID of the item that was clicked.
 * @returns The ID of the newly selected item, or null if the selection was cleared.
 */
export function toggleItemSelection(
  selected: string | null,
  clicked: string,
): string | null {
  return selected === clicked ? null : clicked;
}

/**
 * Determines the selection after an item has been removed from the list.
 * @param items - The list of items before removal.
 * @param selected - The ID of the currently selected item.
 * @param removed - The ID of the item that was removed.
 * @returns The ID of the newly selected item, or null if no suitable selection exists.
 */
export function selectionAfterRemoval(
  items: readonly { id: string }[],
  selected: string | null,
  removed: string,
): string | null {
  const index = items.findIndex((item) => item.id === removed);
  if (index === -1 || selected !== removed)
    return selectedItemId(items, selected);
  return items[index + 1]?.id ?? items[index - 1]?.id ?? null;
}
