"use client";

export function Footer() {
  return (
    <footer
      className="text-center mt-12 pt-6 border-t border-cream-8 text-xs text-cream-20 font-light pb-6 opacity-0 animate-fade-in-up"
      style={{ animationDelay: "0.48s" }}
    >
      <span className="font-display font-normal text-cream-40">Phase</span>
      {" "}&mdash; Monad Validator Evaluation Tool &mdash; March 2026
    </footer>
  );
}
