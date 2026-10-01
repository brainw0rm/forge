// Outgoing email: Resend in production, a D1 "outbox" table in local development.

import type { Env } from "./http";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class MailNotConfigured extends Error {}

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? "Forever Forge <noreply@forever-forge.com>",
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    return;
  }
  if (env.DEV_MAIL_OUTBOX === "1") {
    await env.DB.prepare("INSERT INTO dev_outbox (to_addr, subject, text, created_at) VALUES (?, ?, ?, ?)")
      .bind(mail.to, mail.subject, mail.text, Date.now())
      .run();
    console.log(`[dev mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  throw new MailNotConfigured("Email sending is not configured (set RESEND_API_KEY).");
}

export interface AlertSection {
  title: string;
  url: string;
  changes: { name: string; what: string }[];
}

export function alertMail(
  to: string,
  username: string,
  build: string,
  sections: AlertSection[],
  changesUrl: string,
  unsubscribeUrl: string,
): Mail {
  const count = sections.reduce((n, s) => n + s.changes.length, 0);
  const text = [
    `Hi ${username},`,
    "",
    `Game build ${build} changed ${count} talent${count === 1 ? "" : "s"} you're watching.`,
    "",
    ...sections.flatMap((s) => [s.title, ...s.changes.map((c) => `  • ${c.name}: ${c.what}`), `  ${s.url}`, ""]),
    `Full changelog: ${changesUrl}`,
    "",
    `Stop these emails: ${unsubscribeUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#0b1530;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f5e5cf">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:560px;background:#0f1830;border:1px solid rgba(136,158,208,.22);border-radius:12px">
      <tr><td style="padding:28px">
        ${brand(changesUrl)}
        <h1 style="margin:0 0 8px;font-size:20px">Talents you watch changed</h1>
        <p style="margin:0 0 20px;color:#b9c3dc">Game build ${escape(build)} changed ${count} talent${count === 1 ? "" : "s"} you're watching, ${escape(username)}.</p>
        ${sections
          .map(
            (s) => `<h2 style="margin:18px 0 8px;font-size:16px"><a href="${escape(s.url)}" style="color:#f7b90a;text-decoration:none">${escape(s.title)}</a></h2>
          <ul style="margin:0;padding-left:18px;color:#b9c3dc;line-height:1.6">${s.changes
            .map((c) => `<li><b style="color:#f5e5cf">${escape(c.name)}</b> — ${escape(c.what)}</li>`)
            .join("")}</ul>`,
          )
          .join("")}
        <p style="margin:24px 0"><a href="${escape(changesUrl)}" style="background:#f5e5cf;color:#0b1530;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;display:inline-block">See the full changelog</a></p>
        <p style="margin:0;color:#7f8cb4;font-size:12px">You get these because you watch classes or builds on Forever Forge.
          <a href="${escape(unsubscribeUrl)}" style="color:#7f8cb4">Stop all change alerts</a>.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { to, subject: `Build ${build}: ${count} talent change${count === 1 ? "" : "s"} you're watching`, text, html };
}

/** Logo lockup for email headers; the crest is a PNG (public/logo-email.png) because email clients don't show SVG. */
function brand(anyLink: string) {
  const origin = escape(new URL(anyLink).origin);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>
          <td style="padding-right:12px;vertical-align:middle"><img src="${origin}/logo-email.png" width="40" height="40" alt="" style="display:block;border:0"></td>
          <td style="vertical-align:middle;line-height:1">
            <div style="font-size:9px;letter-spacing:5px;color:#d8b88b;font-weight:600">FOREVER</div>
            <div style="font-size:21px;letter-spacing:4px;color:#f5e5cf;font-family:Georgia,'Times New Roman',serif;padding-top:3px">FORGE</div>
          </td></tr></table>`;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(heading: string, paragraphs: string[], button: { label: string; href: string }, footer: string) {
  const text = [heading, "", ...paragraphs, "", `${button.label}: ${button.href}`, "", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#0b1530;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f5e5cf">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:520px;background:#0f1830;border:1px solid rgba(136,158,208,.22);border-radius:12px">
      <tr><td style="padding:28px">
        ${brand(button.href)}
        <h1 style="margin:0 0 16px;font-size:20px">${escape(heading)}</h1>
        ${paragraphs.map((p) => `<p style="margin:0 0 14px;color:#b9c3dc;line-height:1.55">${escape(p)}</p>`).join("")}
        <p style="margin:24px 0"><a href="${escape(button.href)}" style="background:#f5e5cf;color:#0b1530;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;display:inline-block">${escape(button.label)}</a></p>
        <p style="margin:0;color:#7f8cb4;font-size:12px;line-height:1.5">${escape(footer)}<br>Or paste this link into your browser: ${escape(button.href)}</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { text, html };
}

export function verifyMail(to: string, username: string, link: string): Mail {
  return {
    to,
    subject: "Confirm your email for Forever Forge",
    ...layout(
      `Welcome, ${username}!`,
      ["Confirm your email address to publish builds and rate the community's builds. The link is valid for 48 hours."],
      { label: "Confirm email", href: link },
      "If you didn't create a Forever Forge account, you can ignore this email.",
    ),
  };
}

export function resetMail(to: string, username: string, link: string): Mail {
  return {
    to,
    subject: "Reset your Forever Forge password",
    ...layout(
      "Reset your password",
      [`Someone asked to reset the password for ${username}. The link is valid for 1 hour and can be used once.`],
      { label: "Choose a new password", href: link },
      "If you didn't ask for this, ignore this email. Your password won't change.",
    ),
  };
}
