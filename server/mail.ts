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
        from: env.MAIL_FROM ?? "Forever Forge <noreply@wow-forever-forge.com>",
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
