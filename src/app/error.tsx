"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="bg-cream-5 border border-cream-8 rounded-2xl p-8 max-w-md text-center">
        <h2 className="font-display text-lg text-cream mb-3">
          Something went wrong
        </h2>
        <p className="text-cream-40 text-sm mb-6 font-body">
          The calculator encountered an unexpected error. Please try refreshing.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-cream-12 border border-cream-20 rounded-lg text-cream text-sm font-body font-medium hover:bg-cream-20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-40"
          aria-label="Try loading the calculator again"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
