// Small DOM + text helpers shared by the views.

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Tooltip text as HTML: escaped, with requirement lines ("Requires Cat Form") marked like the game's red text. */
export function gameText(s: string): string {
  return markRequirements(esc(s));
}

/** Wraps whole lines starting with "Requires " (and free of diff markup) in the red requirement style. */
const markRequirements = (html: string) => html.replace(/^(Requires [^\n<]+)$/gm, '<span class="tt-req">$1</span>');

export function $(sel: string, root: ParentNode = document) {
  return root.querySelector(sel) as HTMLElement | null;
}

/** Word-level diff of two tooltips, returned as HTML with <del>/<ins> runs. */
export function diffWords(before: string, after: string): { before: string; after: string } {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  // Walk the LCS, tagging each token as kept or changed on its side.
  const ta: [string, boolean][] = [];
  const tb: [string, boolean][] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ta.push([a[i++], false]);
      tb.push([b[j++], false]);
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) ta.push([a[i++], true]);
    else tb.push([b[j++], true]);
  }
  return { before: markRequirements(runs(ta, "del")), after: markRequirements(runs(tb, "ins")) };
}

/** Join tokens, wrapping consecutive changed tokens (and the spaces between them) in one tag. */
function runs(tokens: [string, boolean][], tag: string): string {
  let out = "";
  let open = false;
  tokens.forEach(([tok, changed], k) => {
    const space = !tok.trim();
    // Whitespace stays inside a run only when changed words sit on both sides of it.
    const inRun = space ? open && tokens.slice(k + 1).find(([t]) => t.trim())?.[1] === true : changed;
    if (inRun && !open && !space) {
      out += `<${tag}>`;
      open = true;
    } else if (!inRun && open) {
      out += `</${tag}>`;
      open = false;
    }
    out += esc(tok);
  });
  return open ? out + `</${tag}>` : out;
}

export function toast(message: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 1800);
}

export async function copy(text: string, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt("Copy this:", text);
  }
}

export function setTitle(title: string, description?: string) {
  document.title = title ? `${title} · Forever Forge` : "Forever Forge · WoW Forever theorycrafting";
  if (description) document.querySelector('meta[name="description"]')?.setAttribute("content", description);
}
