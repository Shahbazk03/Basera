import { z } from 'zod';

/**
 * Hostname utilities for project microsites (main-domain paths, platform subdomains, custom domains).
 * IDN → punycode conversion uses the WHATWG URL parser (available in browsers, Node and edge runtimes).
 */

function domainToASCII(value: string): string {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return '';
  }
}

/** Subdomain labels that can never be assigned to a project. */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'console',
  'dashboard',
  'staff',
  'broker',
  'brokers',
  'developer',
  'developers',
  'mail',
  'email',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'img',
  'images',
  'media',
  'files',
  'uploads',
  'auth',
  'login',
  'account',
  'accounts',
  'support',
  'help',
  'status',
  'blog',
  'docs',
  'dev',
  'staging',
  'test',
  'internal',
  'ns1',
  'ns2',
]);

export class HostnameError extends Error {}

/**
 * Normalises user input into a bare, lower-case, punycode hostname without scheme, port, path or
 * trailing dot. Throws HostnameError for anything that is not a valid public DNS hostname.
 */
export function normalizeHostname(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  value = value.split('/')[0].split('?')[0].split('#')[0];
  if (value.includes('@')) throw new HostnameError('Hostnames cannot contain credentials');
  value = value.replace(/:\d+$/, ''); // port
  value = value.replace(/\.$/, ''); // trailing dot
  if (!value) throw new HostnameError('Hostname is required');
  const ascii = domainToASCII(value);
  if (!ascii) throw new HostnameError('Hostname is not a valid domain name');
  if (ascii.length > 253) throw new HostnameError('Hostname is too long');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ascii) || ascii.includes(':')) throw new HostnameError('IP addresses cannot be used as project domains');
  const labels = ascii.split('.');
  if (labels.length < 2) throw new HostnameError('Use a fully-qualified domain such as www.example.in');
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new HostnameError(`Invalid label "${label}" in hostname`);
  }
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(labels[labels.length - 1])) throw new HostnameError('Hostname must end in a valid top-level domain');
  return ascii;
}

/** Normalises the Host header of an incoming request (keeps localhost style hosts). */
export function normalizeRequestHost(host: string | null | undefined): string {
  if (!host) return '';
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export function isSubdomainOf(hostname: string, rootDomain: string): boolean {
  return hostname.endsWith(`.${rootDomain}`) && hostname.length > rootDomain.length + 1;
}

/** Label part of a platform subdomain ("green-valley" for green-valley.brand.in), or null. */
export function platformSubdomainLabel(hostname: string, rootDomain: string): string | null {
  if (!isSubdomainOf(hostname, rootDomain)) return null;
  const label = hostname.slice(0, -(rootDomain.length + 1));
  return label.includes('.') ? null : label;
}

export function validateSubdomainLabel(label: string): string | null {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return 'Use 1–63 lowercase letters, numbers or hyphens';
  if (RESERVED_SUBDOMAINS.has(label)) return `"${label}" is reserved`;
  return null;
}

/** DNS TXT record name the domain owner must create to prove control. */
export function verificationRecordName(hostname: string): string {
  return `_estate-verify.${hostname}`;
}

export const domainCreateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SUBDOMAIN'), label: z.string().trim().toLowerCase().min(1).max(63) }),
  z.object({ type: z.literal('CUSTOM'), hostname: z.string().trim().min(4).max(253) }),
]);
