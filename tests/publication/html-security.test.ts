import { describe, expect, it } from "vitest";

import { escapeAttribute, escapeHtml } from "../../src/publication/html.js";
import { TemplatePublicationRenderer } from "../../src/publication/template-renderer.js";
import { createPublicationEventContext } from "../fixtures/publication.js";

describe("publication HTML security", () => {
  it("PUB-13_ESCAPE escapes executable markup as inert text", () => {
    expect(escapeHtml("& < > \" '")).toBe("&amp; &lt; &gt; &quot; &#39;");
    expect(escapeHtml("<script>alert('x')</script>")).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
    );
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
    expect(escapeHtml("\"outer 'inner'\"")).toBe(
      "&quot;outer &#39;inner&#39;&quot;",
    );
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("<img onload='alert(1)'>")).toBe(
      "&lt;img onload=&#39;alert(1)&#39;&gt;",
    );

    const draft = new TemplatePublicationRenderer().render(
      createPublicationEventContext({
        title: "<script>title</script>",
        entityName: '<img onload="entity">',
        subject: "onerror=alert(1)",
        scope: "& < > \" '",
        description: "<script>description</script>",
      }),
    );

    expect(draft.title).toBe("<script>title</script>");
    expect(draft.body).not.toContain("<script>");
    expect(draft.body).not.toContain("<img");
    expect(draft.body).toContain("&lt;script&gt;title&lt;/script&gt;");
    expect(draft.body).toContain("&lt;img onload=&quot;entity&quot;&gt;");
    expect(draft.body).toContain("onerror=alert(1)");
    expect(draft.body).toContain("&amp; &lt; &gt; &quot; &#39;");
    expect(draft.body).toContain("&lt;script&gt;description&lt;/script&gt;");
  });

  it("PUB-13_ATTR applies the same safe mapping to attribute values", () => {
    expect(
      escapeAttribute(
        "https://synthetic.example.test/a?q=\"x\"&next=<tag>&quote='q'",
      ),
    ).toBe(
      "https://synthetic.example.test/a?q=&quot;x&quot;&amp;next=&lt;tag&gt;&amp;quote=&#39;q&#39;",
    );
    expect(escapeAttribute("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
