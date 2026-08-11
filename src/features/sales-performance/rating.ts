import type { SalesRating } from "./types";

export function getSalesRating(score: number): SalesRating {
  if (score >= 95) {
    return {
      label: "Excellent",
      stars: 5,
      guidance: "Incentive + appreciation",
      tone: "excellent",
    };
  }
  if (score >= 85) {
    return {
      label: "Very good",
      stars: 4,
      guidance: "Normal incentive",
      tone: "veryGood",
    };
  }
  if (score >= 75) {
    return { label: "Good", stars: 3, guidance: "Coaching & guidance", tone: "good" };
  }
  if (score >= 60) {
    return {
      label: "Needs improvement",
      stars: 2,
      guidance: "Written warning + daily review",
      tone: "needsImprovement",
    };
  }
  return {
    label: "Poor",
    stars: 1,
    guidance: "Performance improvement plan",
    tone: "poor",
  };
}
