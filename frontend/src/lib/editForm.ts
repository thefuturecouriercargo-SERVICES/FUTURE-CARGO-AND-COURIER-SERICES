/**
 * After tapping "Edit" on a table row, the form it fills sits at the top of the
 * page — often far above the row. This scrolls that form into view, focuses its
 * first editable field and flashes a gold outline so the change is obvious.
 */
export function revealEditForm(id: string) {
  // Wait for React to render the "Edit …" state before moving.
  window.setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 88; // clear the sticky header
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    el.classList.remove("edit-flash");
    void el.offsetWidth; // restart the animation if it is already applied
    el.classList.add("edit-flash");
    window.setTimeout(() => el.classList.remove("edit-flash"), 1600);
    const field = el.querySelector<HTMLElement>(
      "input:not([type=hidden]):not([disabled]):not([type=checkbox]), select:not([disabled]), textarea:not([disabled])"
    );
    // preventScroll so the focus doesn't fight the smooth scroll.
    // Skipped on phones, where it would pop the keyboard over the form.
    if (!window.matchMedia("(pointer: coarse)").matches) field?.focus({ preventScroll: true });
  }, 60);
}
