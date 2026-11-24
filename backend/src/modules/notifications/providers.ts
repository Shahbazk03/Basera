import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { escapeHtml } from './templates';

export interface DeliveryResult {
  providerMessageId?: string;
}

export interface ChannelProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Human-readable reason shown in the console when not configured */
  configurationHint(): string;
  send(to: string, subject: string | null, body: string): Promise<DeliveryResult>;
}

/** SMTP email (any provider: SES, SendGrid SMTP, Postmark, Mailpit in development). */
@Injectable()
export class EmailProvider implements ChannelProvider {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(env().SMTP_HOST);
  }

  configurationHint(): string {
    return 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM';
  }

  private client(): Transporter {
    if (!this.transporter) {
      const e = env();
      this.transporter = nodemailer.createTransport({
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        secure: e.SMTP_SECURE,
        auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }

  async send(to: string, subject: string | null, body: string): Promise<DeliveryResult> {
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`;
    const info = await this.client().sendMail({ from: env().MAIL_FROM, to, subject: subject ?? '(no subject)', text: body, html });
    return { providerMessageId: info.messageId };
  }

  describe(): string {
    const e = env();
    return this.isConfigured() ? `${e.SMTP_HOST}:${e.SMTP_PORT}` : 'not configured';
  }
}

/** SMS through Twilio's Messages REST API. */
@Injectable()
export class SmsProvider implements ChannelProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger('SmsProvider');

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM_NUMBER);
  }

  configurationHint(): string {
    return 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER';
  }

  async send(to: string, _subject: string | null, body: string): Promise<DeliveryResult> {
    const e = env();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.TWILIO_ACCOUNT_SID!)}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: e.TWILIO_FROM_NUMBER!, Body: body.slice(0, 1500) }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? 'request failed'}${json.code ? ` (code ${json.code})` : ''}`);
    this.logger.debug(`SMS accepted ${json.sid}`);
    return { providerMessageId: json.sid };
  }
}

/**
 * WhatsApp Business Cloud API (Meta). Free-form text is only delivered inside the 24-hour customer
 * service window; business-initiated messages require approved templates — failures are recorded
 * with the provider's error, never reported as sent.
 */
@Injectable()
export class WhatsAppProvider implements ChannelProvider {
  readonly name = 'whatsapp-cloud';

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.WHATSAPP_CLOUD_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID);
  }

  configurationHint(): string {
    return 'Set WHATSAPP_CLOUD_TOKEN and WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Business Cloud API)';
  }

  async send(to: string, _subject: string | null, body: string): Promise<DeliveryResult> {
    const e = env();
    const url = `https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${encodeURIComponent(e.WHATSAPP_PHONE_NUMBER_ID!)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body: body.slice(0, 4000) } }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${json.error?.message ?? 'request failed'}${json.error?.code ? ` (code ${json.error.code})` : ''}`);
    return { providerMessageId: json.messages?.[0]?.id };
  }
}
