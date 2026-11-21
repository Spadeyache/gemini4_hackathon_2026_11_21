import { describe, expect, it } from "vitest";
import {
  extractHtmlContent,
  fetchUrlContent,
  validateFetchableUrl,
} from "./fetchUrl";

describe("fetch_url tool", () => {
  it("blocks private, loopback, metadata, and non-http URLs", () => {
    expect(validateFetchableUrl("http://localhost:3001/api").ok).toBe(false);
    expect(validateFetchableUrl("http://127.0.0.1/secret").ok).toBe(false);
    expect(validateFetchableUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(
      false
    );
    expect(validateFetchableUrl("http://192.168.1.5/admin").ok).toBe(false);
    expect(validateFetchableUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateFetchableUrl("https://studio.example.com/about").ok).toBe(true);
  });

  it("extracts title, meta description, cleaned body text, and resolved absolute image URLs", () => {
    const html = `<!doctype html>
      <html>
        <head>
          <title>Kestrel &amp; Clay — Studio</title>
          <meta name="description" content="Small-batch cone 10 ceramics." />
          <meta property="og:image" content="/images/kiln-hero.jpg" />
          <style>body { color: red; }</style>
        </head>
        <body>
          <script>console.log("ignore me");</script>
          <h1>Cone 10 Reduction Studio</h1>
          <p>Hand-thrown stoneware &amp; woodblock prints.</p>
          <img src="gallery/vessel.png" />
          <img src="data:image/png;base64,AAAA" />
        </body>
      </html>`;

    const extracted = extractHtmlContent(html, "https://kestrel.example.com/work/index.html");
    expect(extracted.title).toBe("Kestrel & Clay — Studio");
    expect(extracted.description).toBe("Small-batch cone 10 ceramics.");
    expect(extracted.text).toContain("Cone 10 Reduction Studio");
    expect(extracted.text).toContain("Hand-thrown stoneware & woodblock prints.");
    expect(extracted.text).not.toContain("ignore me");
    expect(extracted.image_urls).toEqual([
      "https://kestrel.example.com/images/kiln-hero.jpg",
      "https://kestrel.example.com/work/gallery/vessel.png",
    ]);
  });

  it("handles mocked fetch responses and HTTP errors gracefully", async () => {
    const okFetch = (async () =>
      new Response("<html><title>Harbor</title><body><p>Hello sea</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;

    const okRes = await fetchUrlContent(
      "https://harbor.example.com",
      undefined,
      okFetch
    );
    expect(okRes.ok).toBe(true);
    expect(okRes.title).toBe("Harbor");
    expect(okRes.text).toContain("Hello sea");

    const errFetch = (async () =>
      new Response("Not found", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;

    const errRes = await fetchUrlContent(
      "https://harbor.example.com/missing",
      undefined,
      errFetch
    );
    expect(errRes.ok).toBe(false);
    expect(errRes.status).toBe(404);
  });
});
