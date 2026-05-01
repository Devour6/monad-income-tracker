import type { Metadata } from "next";

/**
 * Swagger UI for the public API. Loads the OpenAPI spec from
 * /api/openapi.json and renders an interactive explorer.
 *
 * Hosted under /api-explorer (rather than /api/docs) to avoid
 * colliding with the existing /docs marketing page.
 */

export const metadata: Metadata = {
  title: "API Explorer | Monad Income Tracker",
  description: "Interactive API reference for the Monad Income Tracker public API.",
};

export default function ApiExplorerPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
      />
      <div id="swagger-ui" />
      <script
        src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"
        defer
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            window.addEventListener('load', function () {
              if (window.SwaggerUIBundle) {
                window.SwaggerUIBundle({
                  url: '/api/openapi.json',
                  dom_id: '#swagger-ui',
                  deepLinking: true,
                  layout: 'BaseLayout',
                  tryItOutEnabled: true,
                });
              }
            });
          `,
        }}
      />
    </div>
  );
}
