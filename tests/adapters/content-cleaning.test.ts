import { describe, expect, it } from "vitest";

import {
  cleanHtmlValue,
  cleanSourceText,
  cleanTextValue,
  normalizeCleanText,
} from "../../src/adapters/content-cleaning.js";

describe("content cleaning", () => {
  it("normalizes TEXT CRLF, entities and runs of whitespace", () => {
    expect(normalizeCleanText("  first\r\nsecond\t place  \rthird  ")).toBe(
      "first\nsecond place\nthird",
    );
    expect(cleanSourceText({ value: " a &amp; b ", format: "TEXT" })).toBe(
      "a &amp; b",
    );
    expect(cleanTextValue(" \r\n\t ")).toBeNull();
  });

  it("collects visible block text, decodes entities and removes page chrome", () => {
    const html = `<!doctype html><html><head><style>.x{}</style><script>ignored()</script><template>template</template></head><body><nav>navigation</nav><header>header</header><main><h1>Title &amp; more</h1><p>First <strong>paragraph</strong>.</p><p>Second paragraph.</p><img src="photo.jpg" alt="image"></main><footer>footer</footer><form>form</form><noscript>noscript</noscript><div hidden>hidden attr</div><div aria-hidden="true">hidden aria</div></body></html>`;
    expect(cleanHtmlValue(html)).toBe(
      "Title & more\nFirst paragraph.\nSecond paragraph.",
    );
  });

  it("treats image-only HTML as empty without loading resources", () => {
    expect(
      cleanHtmlValue(
        '<html><body><img src="https://images.example.test/only.jpg"><canvas></canvas></body></html>',
      ),
    ).toBeNull();
  });
});
