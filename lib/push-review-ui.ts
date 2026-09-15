const OPEN_EVENT = "pay-tracker:open-push-review";

export const PUSH_REVIEW_BANNER_ID = "push-review-banner";
export const PUSH_REVIEW_SLOT_ID = "push-review-slot";

export function requestOpenPushReview() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function onOpenPushReview(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = () => handler();
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function scrollToPushReviewBanner() {
  if (typeof document === "undefined") return;
  document.getElementById(PUSH_REVIEW_BANNER_ID)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
