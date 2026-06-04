/**
 * Make item-list rows fully clickable. A click anywhere on a `.lottery-item`
 * row that has a view button opens the item detail — except when the click
 * lands on an interactive control (button, input, link, quantity stepper).
 *
 * Implemented by delegating to the row's existing `[data-action=view-item]`
 * button, so each app's own view handler stays the single source of truth and
 * we don't duplicate the (app-specific) item-resolution logic.
 *
 * @param {HTMLElement} root The application root (or any container) to scan.
 */
export function bindRowClicks(root) {
  if (!root) return;
  root.querySelectorAll(".lottery-item").forEach((row) => {
    const viewBtn = row.querySelector("[data-action=view-item]");
    if (!viewBtn) return; // stub / non-viewable rows have nothing to open
    row.classList.add("clickable");
    row.addEventListener("click", (e) => {
      // Let genuine controls handle their own clicks.
      if (e.target.closest("button, input, a, select, textarea, label, .item-qty-control")) return;
      viewBtn.click();
    });
  });
}
