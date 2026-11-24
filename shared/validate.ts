// Input rules shared by the browser forms and the API, so both agree on what's valid.

export const LIMITS = {
  email: { max: 254 },
};

export type Problem = string | null;

export function checkEmail(v: string): Problem {
  if (v.length > LIMITS.email.max || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address.";
  return null;
}
