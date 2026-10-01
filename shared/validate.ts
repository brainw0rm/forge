import { CHARS_PER_POINT } from "./code";

// Input rules shared by the browser forms and the API, so both agree on what's valid.

export const CLASS_SLUGS = [
  "warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid",
] as const;

export const LIMITS = {
  username: { min: 3, max: 24 },
  password: { min: 8, max: 128 },
  email: { max: 254 },
  title: { min: 3, max: 80 },
  description: { max: 2000 },
  reportDetails: 500,
  maxPoints: 51,
};

export const REPORT_REASONS = ["spam", "offensive", "misleading", "other"] as const;
export const REPORT_REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  spam: "Spam or advertising",
  offensive: "Offensive or hateful content",
  misleading: "Misleading or broken build",
  other: "Something else",
};

export type Problem = string | null;

export function checkUsername(v: string): Problem {
  if (v.length < LIMITS.username.min || v.length > LIMITS.username.max)
    return `Username must be ${LIMITS.username.min}–${LIMITS.username.max} characters.`;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return "Username can only use letters, numbers, - and _.";
  return null;
}

export function checkEmail(v: string): Problem {
  if (v.length > LIMITS.email.max || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address.";
  return null;
}

export function checkPassword(v: string): Problem {
  if (v.length < LIMITS.password.min) return `Password must be at least ${LIMITS.password.min} characters.`;
  if (v.length > LIMITS.password.max) return `Password must be at most ${LIMITS.password.max} characters.`;
  return null;
}

export function checkTitle(v: string): Problem {
  const t = v.trim();
  if (t.length < LIMITS.title.min || t.length > LIMITS.title.max)
    return `Title must be ${LIMITS.title.min}–${LIMITS.title.max} characters.`;
  return null;
}

export function checkDescription(v: string): Problem {
  return v.length > LIMITS.description.max ? `Description must be at most ${LIMITS.description.max} characters.` : null;
}


export const CODE_CHARS = CHARS_PER_POINT;

/** Share code: CODE_CHARS base64url characters per talent point. */
export function checkCode(v: string): Problem {
  if (!/^[A-Za-z0-9_-]*$/.test(v) || v.length % CODE_CHARS !== 0 || v.length > LIMITS.maxPoints * CODE_CHARS)
    return "Invalid build code.";
  if (v.length === 0) return "Spend at least one talent point before saving.";
  return null;
}

/** "31/20/0" */
export function checkSplit(v: string): Problem {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
  if (!m) return "Invalid point split.";
  const total = Number(m[1]) + Number(m[2]) + Number(m[3]);
  return total > LIMITS.maxPoints ? "Invalid point split." : null;
}

export function isClassSlug(v: string): v is (typeof CLASS_SLUGS)[number] {
  return (CLASS_SLUGS as readonly string[]).includes(v);
}
