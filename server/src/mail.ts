import nodemailer from 'nodemailer';
import type { Config } from './config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Dev mailbox (only populated without SMTP). */
  outbox: (Mail & { at: string })[];
}

export function createMailer(cfg: Config, log: (msg: string) => void = console.log): Mailer {
  const outbox: (Mail & { at: string })[] = [];
  if (!cfg.smtpUrl) {
    return {
      outbox,
      async send(mail) {
        outbox.push({ ...mail, at: new Date().toISOString() });
        if (outbox.length > 200) outbox.shift();
        log(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
      },
    };
  }
  const transport = nodemailer.createTransport(cfg.smtpUrl);
  return {
    outbox,
    async send(mail) {
      await transport.sendMail({ from: cfg.mailFrom, ...mail });
    },
  };
}

export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${cta.label}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;padding:24px;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;border:1px solid #e5e7eb">
<div style="font-weight:700;color:#4f46e5;margin-bottom:16px">Pinpoint</div>
<h1 style="font-size:18px;margin:0 0 12px">${title}</h1>${bodyHtml}${button}
<p style="color:#6b7280;font-size:12px;margin-top:28px">You receive this because you are a member of a Pinpoint workspace. Change notification settings in the extension or web app.</p>
</div></body></html>`;
}
