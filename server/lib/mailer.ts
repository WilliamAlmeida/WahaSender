import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../logger';
import { enqueueEmail } from '../queue';

/**
 * Transactional e-mail abstraction. Uses SMTP via nodemailer when MAIL_HOST is
 * configured; otherwise falls back to logging the message (dev/test friendly,
 * so signup/reset flows are exercisable without a real mail server).
 */

let transporter: Transporter | null = null;
let resolved = false;

function getTransporter(): Transporter | null {
  if (resolved) return transporter;
  resolved = true;
  if (!config.MAIL_HOST) {
    logger.warn('[Mailer] MAIL_HOST not set — e-mails will be logged, not sent');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.MAIL_HOST,
    port: config.MAIL_PORT,
    secure: config.MAIL_SECURE,
    auth: config.MAIL_USER ? { user: config.MAIL_USER, pass: config.MAIL_PASSWORD } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    logger.info({ to: msg.to, subject: msg.subject }, '[Mailer] (dev) e-mail not sent — preview below');
    logger.info({ text: msg.text || stripHtml(msg.html) }, '[Mailer] (dev) body');
    return;
  }
  try {
    await tx.sendMail({
      from: config.MAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text || stripHtml(msg.html),
    });
    logger.info({ to: msg.to, subject: msg.subject }, '[Mailer] sent');
  } catch (err: any) {
    logger.error({ err: err.message, to: msg.to }, '[Mailer] send failed');
    throw err;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wrap(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1e293b">
    <h2 style="color:#4f46e5;margin:0 0 16px">WahaSender</h2>
    <h3 style="margin:0 0 12px">${title}</h3>
    ${bodyHtml}
    <p style="margin-top:24px;font-size:12px;color:#94a3b8">Se você não solicitou este e-mail, ignore-o com segurança.</p>
  </div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${href}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${label}</a></p>
    <p style="font-size:12px;color:#64748b;word-break:break-all">Ou copie e cole este link: ${href}</p>`;
}

export async function sendVerificationEmail(to: string, link: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Confirme seu e-mail — WahaSender',
    html: wrap(
      'Confirme seu endereço de e-mail',
      `<p>Bem-vindo(a)! Confirme seu e-mail para ativar sua conta.</p>${button(link, 'Confirmar e-mail')}`,
    ),
  });
}

export async function sendPasswordResetEmail(to: string, link: string): Promise<void> {
  await sendMail({
    to,
    subject: 'Redefinição de senha — WahaSender',
    html: wrap(
      'Redefinir sua senha',
      `<p>Recebemos um pedido para redefinir sua senha. O link expira em 1 hora.</p>${button(link, 'Redefinir senha')}`,
    ),
  });
}

export async function queueVerificationEmail(to: string, link: string): Promise<void> {
  await enqueueEmail({
    to,
    subject: 'Confirme seu e-mail — WahaSender',
    html: wrap(
      'Confirme seu endereço de e-mail',
      `<p>Bem-vindo(a)! Confirme seu e-mail para ativar sua conta.</p>${button(link, 'Confirmar e-mail')}`,
    ),
  });
}

export async function queuePasswordResetEmail(to: string, link: string): Promise<void> {
  await enqueueEmail({
    to,
    subject: 'Redefinição de senha — WahaSender',
    html: wrap(
      'Redefinir sua senha',
      `<p>Recebemos um pedido para redefinir sua senha. O link expira em 1 hora.</p>${button(link, 'Redefinir senha')}`,
    ),
  });
}
