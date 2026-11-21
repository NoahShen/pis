import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const LIMIT = 4 * 1024 * 1024;
const MAX_ARCHIVES = 64;
const FEEDS = [
  {
    kind: "EVENT_UPDATES",
    prefix: "event-updates",
    head: "event-updates.xml",
    pending: "event-updates-pending.xml",
    title: "PIS Event Updates",
    description: "PIS event and event-update publications",
  },
  {
    kind: "CURATED_CONTENT",
    prefix: "curated-content",
    head: "curated-content.xml",
    pending: "curated-content-pending.xml",
    title: "PIS Curated Content",
    description: "PIS curated knowledge publications",
  },
];
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  maxNestedTags: 100,
});
const HELP = `Usage:
  node scripts/pages-acceptance.mjs --origin <https-origin[/fixed-prefix]>
  node scripts/pages-acceptance.mjs --self-test

Options:
  --origin <url>       Public origin, optionally including its fixed directory.
  --directory <name>   Optional fixed example directory (letters, digits, _ or -).
  --timeout-ms <n>     Per-request timeout, 100..120000 (default: 10000).
  --self-test          Run anonymous loopback fixtures; no external network.
  --help               Show this help.

Only fixed keys, counts, SHA-256 hashes and status are printed. Redirects are
rejected. HTTP is accepted only for loopback testing; use HTTPS publicly.
Automatic checks do not replace reader, offline, >200-item or network acceptance.`;

class SafeError extends Error {}
const fail = (reason) => {
  throw new SafeError(reason);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  const options = { directory: "", timeoutMs: 10_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--origin", "--directory", "--timeout-ms"].includes(name))
      fail("invalid_arguments");
    const value = argv[++index];
    if (value === undefined) fail("invalid_arguments");
    if (name === "--origin") options.origin = value;
    if (name === "--directory") options.directory = value;
    if (name === "--timeout-ms") options.timeoutMs = Number(value);
  }
  if (
    !options.origin ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 120_000 ||
    !/^[A-Za-z0-9_-]{0,128}$/u.test(options.directory)
  )
    fail("invalid_arguments");
  urlFor(options);
  return options;
}

function urlFor(options) {
  let base;
  try {
    base = new URL(options.origin);
  } catch {
    fail("invalid_origin");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    /[\u0000-\u0020\u007f]/u.test(options.origin)
  )
    fail("invalid_origin");
  const prefix = `${base.pathname.replace(/\/+$/u, "")}${options.directory ? `/${options.directory}` : ""}`;
  return (key) => {
    const url = new URL(base);
    url.pathname = `${prefix}/${key}`
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return url;
  };
}

async function read(urlForKey, key, timeoutMs, optional = false) {
  let response;
  try {
    response = await fetch(urlForKey(key), {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    fail(`http_error:${key}`);
  }
  if (optional && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    fail(`http_status_${response.status}:${key}`);
  }
  if (!response.body) fail(`empty_body:${key}`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT) {
        await reader.cancel();
        fail(`response_too_large:${key}`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SafeError) throw error;
    fail(`response_read_error:${key}`);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

const text = (record, name) => {
  const value = record[name];
  if (Array.isArray(value)) fail("xml_shape");
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value["#text"] === "string")
    return value["#text"];
  fail("xml_shape");
};
const archiveKey = (feed, sequence) =>
  `archive/${feed.prefix}-${String(sequence).padStart(4, "0")}.xml`;

function parseDocument(feed, key, bytes) {
  const type =
    key === feed.head ? "head" : key === feed.pending ? "pending" : "archive";
  let channel;
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      /<!(?:DOCTYPE|ENTITY)\b/iu.test(xml) ||
      XMLValidator.validate(xml) !== true
    )
      fail("xml_invalid");
    const rss = parser.parse(xml).rss;
    if (!rss || rss["@version"] !== "2.0") fail("xml_shape");
    channel = rss.channel;
    if (
      text(channel, "title") !== feed.title ||
      text(channel, "description") !== feed.description ||
      text(channel, "link") !== key
    )
      fail("feed_identity");
    const previous = channel["atom:link"];
    if (Array.isArray(previous) || (previous && typeof previous !== "object"))
      fail("archive_link");
    const href = previous?.["@href"] ?? null;
    if (previous?.["@rel"] !== (href ? "prev-archive" : previous?.["@rel"]))
      fail("archive_link");
    const sequence = type === "archive" ? Number(key.slice(-8, -4)) : null;
    const expected =
      type === "head"
        ? feed.pending
        : type === "pending"
          ? href
          : sequence === 1
            ? null
            : archiveKey(feed, sequence - 1);
    if (type === "head" && href !== expected) fail("archive_link");
    if (type === "archive" && href !== expected) fail("archive_link");
    if (
      type === "pending" &&
      href &&
      !new RegExp(`^archive/${feed.prefix}-\\d{4}\\.xml$`, "u").test(href)
    )
      fail("archive_link");
    if ((type === "head") === "fh:archive" in channel) fail("archive_marker");
    const raw = channel.item ?? [];
    const items = Array.isArray(raw) ? raw : [raw];
    if (
      (type === "head" && items.length > 200) ||
      (type === "pending" && items.length > 199) ||
      (type === "archive" && items.length !== 200)
    )
      fail("item_limit");
    const guids = items.map((item) => {
      if (item.guid?.["@isPermaLink"] !== "false") fail("guid_identity");
      const guid = text(item, "guid");
      if (!/^pis:published:.+$/u.test(guid)) fail("guid_identity");
      return guid;
    });
    if (new Set(guids).size !== guids.length) fail("duplicate_guid");
    return { type, href, guids };
  } catch (error) {
    if (error instanceof SafeError) fail(`${error.message}:${key}`);
    fail(`xml_invalid:${key}`);
  }
}

async function inspect(options) {
  const urlForKey = urlFor(options);
  const marker = await read(urlForKey, ".nojekyll", options.timeoutMs, true);
  if (marker && marker.length !== 0) fail("nojekyll_not_empty");
  const result = {
    status: "PASS",
    scope: "automatic_only",
    nojekyll: marker
      ? { key: ".nojekyll", httpStatus: 200, bytes: 0 }
      : {
          key: ".nojekyll",
          httpStatus: 404,
          existenceCheck: "remote_git_tree_required",
        },
    feeds: [],
  };
  for (const feed of FEEDS) {
    const documents = [];
    for (const key of [feed.head, feed.pending])
      documents.push({
        key,
        bytes: await read(urlForKey, key, options.timeoutMs),
      });
    for (let sequence = 1; sequence <= MAX_ARCHIVES; sequence += 1) {
      const key = archiveKey(feed, sequence);
      const bytes = await read(urlForKey, key, options.timeoutMs, true);
      if (!bytes) break;
      documents.push({ key, bytes });
      if (sequence === MAX_ARCHIVES) fail("archive_limit");
    }
    const parsed = documents.map((document) => ({
      ...document,
      ...parseDocument(feed, document.key, document.bytes),
    }));
    const sealed = new Set();
    for (const document of parsed.slice(2))
      for (const guid of document.guids) {
        if (sealed.has(guid)) fail(`duplicate_sealed_guid:${feed.kind}`);
        sealed.add(guid);
      }
    const pending = parsed[1];
    if (
      pending.href !==
      (parsed.at(-1).type === "archive" ? parsed.at(-1).key : null)
    )
      fail(`pending_archive_link:${feed.kind}`);
    const digest = (document) => ({
      key: document.key,
      guidCount: document.guids.length,
      bytes: document.bytes.length,
      sha256: sha256(document.bytes),
    });
    result.feeds.push({
      feed: feed.kind,
      head: digest(parsed[0]),
      pending: digest(pending),
      archives: parsed.slice(2).map(digest),
      uniqueSealedGuidCount: sealed.size,
      chain: parsed.length > 2 ? "head->pending->sealed" : "head->pending",
    });
  }
  return result;
}

function fixture(feed, type, sequence = 0, duplicate = false) {
  const key =
    type === "head"
      ? feed.head
      : type === "pending"
        ? feed.pending
        : archiveKey(feed, sequence);
  const count = type === "archive" ? 200 : 1;
  const previous =
    type === "head"
      ? feed.pending
      : type === "archive"
        ? sequence === 1
          ? null
          : archiveKey(feed, sequence - 1)
        : archiveKey(feed, 1);
  const items = Array.from(
    { length: count },
    (_, index) =>
      `<item><title>fixture</title><description>fixture</description><content:encoded><![CDATA[fixture]]></content:encoded><guid isPermaLink="false">pis:published:${duplicate ? "sealed-duplicate" : `${feed.prefix}-${type}-${index}`}</guid><pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate></item>`,
  ).join("");
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:fh="http://purl.org/syndication/history/1.0"><channel><title>${feed.title}</title><link>${key}</link><description>${feed.description}</description>${previous ? `<atom:link rel="prev-archive" href="${previous}"/>` : ""}${type === "head" ? "" : "<fh:archive/>"}${items}</channel></rss>`,
  );
}

async function selfTest() {
  const files = new Map([["/.nojekyll", new Uint8Array()]]);
  for (const feed of FEEDS)
    for (const type of ["head", "pending", "archive"])
      files.set(
        `/${type === "head" ? feed.head : type === "pending" ? feed.pending : archiveKey(feed, 1)}`,
        fixture(feed, type, 1),
      );
  let mode = "normal";
  const server = createServer((request, response) => {
    if (mode === "redirect")
      return response.writeHead(302, { location: "/fixed" }).end();
    const bytes = files.get(new URL(request.url, "http://localhost").pathname);
    response.writeHead(bytes ? 200 : 404).end(bytes);
  });
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const options = {
    origin: `http://127.0.0.1:${server.address().port}`,
    timeoutMs: 1000,
  };
  const results = [];
  const reject = async (name) => {
    try {
      await inspect(options);
    } catch (error) {
      if (error instanceof SafeError) {
        results.push({ case: name, status: "EXPECTED_FAIL" });
        return;
      }
    }
    fail(`self_test_${name}`);
  };
  try {
    const valid = await inspect(options);
    if (valid.feeds.some((feed) => feed.uniqueSealedGuidCount !== 200))
      fail("self_test_counts");
    results.push({ case: "valid_201_items", status: "PASS" });
    files.delete("/.nojekyll");
    const markerMissing = await inspect(options);
    if (
      markerMissing.nojekyll.httpStatus !== 404 ||
      markerMissing.nojekyll.existenceCheck !== "remote_git_tree_required" ||
      "bytes" in markerMissing.nojekyll ||
      "sha256" in markerMissing.nojekyll
    )
      fail("self_test_nojekyll_404");
    results.push({ case: "nojekyll_404_remote_tree_required", status: "PASS" });
    for (const feed of FEEDS) files.delete(`/${archiveKey(feed, 1)}`);
    for (const feed of FEEDS) {
      const pending = fixture(feed, "pending");
      const xml = new TextDecoder()
        .decode(pending)
        .replace(/<atom:link[^>]*\/>/u, "");
      files.set(`/${feed.pending}`, new TextEncoder().encode(xml));
    }
    await inspect(options);
    results.push({ case: "valid_no_archive", status: "PASS" });
    const original = files.get(`/${FEEDS[0].head}`);
    files.set(`/${FEEDS[0].head}`, new TextEncoder().encode("<rss>"));
    await reject("malformed_xml");
    files.set(`/${FEEDS[0].head}`, original);
    mode = "redirect";
    await reject("redirect_rejected");
    mode = "normal";
    for (const feed of FEEDS) {
      files.set(`/${archiveKey(feed, 1)}`, fixture(feed, "archive", 1));
      files.set(`/${archiveKey(feed, 2)}`, fixture(feed, "archive", 2, true));
      const pending = new TextDecoder()
        .decode(fixture(feed, "pending"))
        .replace(`${feed.prefix}-0001`, `${feed.prefix}-0002`);
      files.set(`/${feed.pending}`, new TextEncoder().encode(pending));
    }
    await reject("duplicate_sealed_guid");
    for (const argv of [
      [],
      ["--unknown"],
      ["--origin", "https://user@example.invalid"],
      ["--origin", "https://example.invalid", "--timeout-ms", "0"],
    ]) {
      try {
        parseArgs(argv);
        fail("self_test_arguments");
      } catch (error) {
        if (
          !(error instanceof SafeError) ||
          error.message === "self_test_arguments"
        )
          throw error;
      }
    }
    results.push({ case: "argument_validation", status: "PASS" });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return { status: "PASS", scope: "loopback_fixture_only", results };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(HELP);
  else
    console.log(
      JSON.stringify(
        options.selfTest ? await selfTest() : await inspect(options),
        null,
        2,
      ),
    );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      reason: error instanceof SafeError ? error.message : "unexpected_error",
    }),
  );
  process.exitCode = 1;
}
