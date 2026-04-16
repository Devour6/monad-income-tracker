"use client";

export function Header() {
  return (
    <>
      <header
        className="text-center mb-10 pb-7 border-b border-cream-8 opacity-0 animate-fade-in-up"
        style={{ animationDelay: "0.08s" }}
      >
        <h1 className="font-display text-[32px] font-normal mb-2 text-cream tracking-[0.03em]">
          Monad Validator Calculator
        </h1>
        <p className="font-body text-cream-40 text-[15px] font-light">
          Estimate returns from running a Monad validator
        </p>
      </header>
    </>
  );
}
