import { describe, expect, it } from "vitest";
import { canonicalUrl, forSource, isAboutForever, newsTopics, NEWS_SOURCES, parseFeed, plainText } from "./news";

const wowhead = NEWS_SOURCES.find((s) => s.id === "wowhead")!;

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[Blizzard Confirms Crit Nerf is a Bug in WoW: Forever]]></title>
  <link>https://www.wowhead.com/news=1/crit?utm_source=rss&amp;utm_medium=feed</link>
  <description><![CDATA[<p>Long article text that must never be stored.</p><img src="x.jpg">]]></description>
  <category>Forever</category><pubDate>Mon, 28 Sep 2026 22:37:51 -0500</pubDate></item>
<item><title>Cat Form Druid Quest Bug Should Be Resolved</title><link>https://www.wowhead.com/news=2</link>
  <category>Forever</category><pubDate>Mon, 28 Sep 2026 16:54:00 -0500</pubDate></item>
<item><title>Weekly Bonus Rolls Start Next Week</title><link>https://www.wowhead.com/news=3</link>
  <description>Mentions WoW Forever in passing.</description><category>Live</category></item>
<item><title>Tom &amp;amp; Jerry&#8217;s WoW Forever guide</title><link>https://evil.example/news=4</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">World of Warcraft: Forever &lt;b&gt;beta&lt;/b&gt; extended</title>
<link rel="alternate" href="https://www.wowhead.com/news=9"/><link rel="enclosure" href="https://www.wowhead.com/img.jpg"/>
<updated>2026-09-27T10:00:00Z</updated><category term="News"/></entry></feed>`;

describe("news feeds", () => {
  it("parses RSS items, unwrapping CDATA and decoding entities", () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ title: "Blizzard Confirms Crit Nerf is a Bug in WoW: Forever", categories: ["Forever"] });
    expect(items[0].published).toBe(Date.parse("2026-09-29T03:37:51Z"));
    expect(items[3].title).toBe("Tom & Jerry’s WoW Forever guide");
    expect(items[2].published).toBeNull();
  });

  it("parses Atom entries and strips markup from titles", () => {
    const [item] = parseFeed(ATOM);
    expect(item).toMatchObject({ title: "World of Warcraft: Forever beta extended", url: "https://www.wowhead.com/news=9", categories: ["News"] });
  });

  it("keeps items whose headline or category is about WoW Forever", () => {
    const [crit, cat, weekly] = parseFeed(RSS);
    expect(isAboutForever(crit)).toBe(true);
    expect(isAboutForever(cat)).toBe(true); // category only
    expect(isAboutForever(weekly)).toBe(false); // a passing mention in the text doesn't count
    expect(isAboutForever({ title: "Forever young: a Classic retrospective", url: "", published: null, categories: [] })).toBe(false);
    expect(isAboutForever({ title: "WoW Forever: Neuer Dungeon", url: "", published: null, categories: [] })).toBe(true);
  });

  it("stores only headline, link, source and date, on the source's own host", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    const out = forSource(wowhead, parseFeed(RSS), now);
    expect(out.map((i) => i.url)).toEqual(["https://www.wowhead.com/news=1/crit", "https://www.wowhead.com/news=2"]);
    for (const item of out) expect(Object.keys(item).sort()).toEqual(["published", "source", "title", "url"]);
    expect(JSON.stringify(out)).not.toContain("Long article text");
  });

  it("canonicalizes links and rejects foreign hosts", () => {
    expect(canonicalUrl("http://www.wowhead.com/news=1?utm_campaign=x&id=2#top", wowhead)).toBe("https://www.wowhead.com/news=1?id=2");
    expect(canonicalUrl("https://www.wowhead.com.evil.example/news=1", wowhead)).toBeNull();
    expect(canonicalUrl("javascript:alert(1)", wowhead)).toBeNull();
  });

  it("tags headlines by topic", () => {
    expect(newsTopics("Blizzard Confirms Crit Nerf in PvP is a Bug in WoW: Forever")).toEqual(["pvp", "bugs"]);
    expect(newsTopics("WoW Forever Tipp: Liste aller Kochrezepte")).toEqual(["professions"]);
    expect(newsTopics("WoW Forever: Betaserver erneut aufgestockt")).toEqual(["beta"]);
    expect(plainText("  a <i>b</i>\n c ")).toBe("a b c");
  });
});
