'use client';

import * as React from 'react';
import { Check, Copy, ExternalLink, Globe, MoreHorizontal, RefreshCw, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { formatDateTime, formatRelative } from '@estate/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Segmented,
  StatusBadge,
  toast,
} from '@estate/ui';
import { errorMessage } from '@estate/api-client';
import { api } from '@/lib/api';
import { applyServerErrors, useApi, useApiMutation } from '@/lib/hooks';
import { QueryState } from '@/components/query-state';
import type { DomainRow, ManageProject } from './types';

interface DomainsResponse {
  rootDomain: string;
  tlsProvider: string;
  cnameTarget: string | null;
  aRecord: string | null;
  domains: DomainRow[];
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-900">{value}</code>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error('Copy failed — select the text and copy it manually');
            }
          }}
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function DomainCard({ domain, onAction }: { domain: DomainRow; onAction: (action: 'verify' | 'enable' | 'disable' | 'primary' | 'check-ssl' | 'remove', d: DomainRow) => void }) {
  const ins = domain.instructions;
  const pending = domain.type === 'CUSTOM' && ['PENDING_VERIFICATION', 'FAILED'].includes(domain.status);
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="size-4 text-ink-400" />
            <a href={domain.url} target="_blank" rel="noreferrer" className="truncate font-medium text-ink-900 hover:underline">
              {domain.hostname}
            </a>
            {domain.isPrimary ? (
              <Badge tone="brand" size="sm">
                Primary
              </Badge>
            ) : null}
            <Badge tone="outline" size="sm">
              {domain.type === 'SUBDOMAIN' ? 'Platform subdomain' : 'Custom domain'}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <StatusBadge status={domain.status} size="sm" />
            <span>
              SSL: <StatusBadge status={domain.sslStatus} size="sm" />
            </span>
            {domain.type === 'CUSTOM' ? <span>DNS target: {domain.dnsTargetOk ? 'pointing to the platform' : 'not pointing yet'}</span> : null}
            {domain.lastCheckedAt ? <span>Checked {formatRelative(domain.lastCheckedAt)}</span> : null}
            {domain.verifiedAt ? <span>Verified {formatDateTime(domain.verifiedAt)}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pending ? (
            <Button size="sm" onClick={() => onAction('verify', domain)}>
              <RefreshCw /> Verify now
            </Button>
          ) : null}
          {domain.status === 'VERIFIED' || (domain.status === 'DISABLED' && domain.verifiedAt) ? (
            <Button size="sm" onClick={() => onAction('enable', domain)}>
              Enable
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label={`Actions for ${domain.hostname}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {domain.status === 'ACTIVE' && !domain.isPrimary ? (
                <DropdownMenuItem onSelect={() => onAction('primary', domain)}>
                  <Star /> Make primary address
                </DropdownMenuItem>
              ) : null}
              {domain.status === 'ACTIVE' ? (
                <DropdownMenuItem onSelect={() => onAction('check-ssl', domain)}>
                  <ShieldCheck /> Check HTTPS certificate
                </DropdownMenuItem>
              ) : null}
              {domain.type === 'CUSTOM' && domain.status !== 'PENDING_VERIFICATION' ? (
                <DropdownMenuItem onSelect={() => onAction('verify', domain)}>
                  <RefreshCw /> Re-check DNS
                </DropdownMenuItem>
              ) : null}
              {domain.status === 'ACTIVE' ? (
                <DropdownMenuItem onSelect={() => onAction('disable', domain)}>Disable</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <a href={domain.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => onAction('remove', domain)}>
                <Trash2 /> Remove domain
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {domain.lastError ? (
        <div className="border-t border-line px-4 py-3">
          <Alert tone={domain.status === 'ACTIVE' ? 'warning' : 'danger'} title="Last check">
            {domain.lastError}
          </Alert>
        </div>
      ) : null}
      {pending && ins.type === 'CUSTOM' ? (
        <div className="grid gap-4 border-t border-line bg-ink-50/50 px-4 py-4">
          <p className="text-sm font-medium text-ink-900">DNS records to create</p>
          <div className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)] md:items-end">
            <CopyValue label="Type" value="TXT" />
            <CopyValue label="Name / host" value={ins.txt.name} />
            <CopyValue label="Value" value={ins.txt.value} />
          </div>
          {ins.cname ? (
            <div className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)] md:items-end">
              <CopyValue label="Type" value="CNAME" />
              <CopyValue label="Name / host" value={ins.cname.name} />
              <CopyValue label="Points to" value={ins.cname.target} />
            </div>
          ) : null}
          {ins.a ? (
            <div className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.4fr)] md:items-end">
              <CopyValue label="Type" value="A" />
              <CopyValue label="Name / host" value={ins.a.name} />
              <CopyValue label="Value" value={ins.a.value} />
            </div>
          ) : null}
          <ul className="grid gap-1 text-[12.5px] text-ink-600">
            {ins.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function DomainsTab({ project }: { project: ManageProject }) {
  const q = useApi<DomainsResponse>(project.permissions.canManageDomains ? `/projects/${project.id}/domains` : null);
  const [type, setType] = React.useState<'SUBDOMAIN' | 'CUSTOM'>('SUBDOMAIN');
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<DomainRow | null>(null);
  const add = useApiMutation(() => api.post<DomainRow>(`/projects/${project.id}/domains`, type === 'SUBDOMAIN' ? { type, label: value.trim().toLowerCase() } : { type, hostname: value.trim() }), {
    success: (d) => (d.status === 'ACTIVE' ? `${d.hostname} is live` : `${d.hostname} added — create the DNS records shown below`),
    invalidate: [`/projects/${project.id}/domains`, '/projects'],
    silent: true,
    onSuccess: () => {
      setValue('');
      setError(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const action = useApiMutation(
    async (v: { action: 'verify' | 'enable' | 'disable' | 'primary' | 'check-ssl' | 'remove'; d: DomainRow }) =>
      v.action === 'remove' ? api.delete(`/project-domains/${v.d.id}`) : api.post<DomainRow & { warning?: string | null; check?: { txtOk: boolean } }>(`/project-domains/${v.d.id}/${v.action}`),
    {
      invalidate: [`/projects/${project.id}/domains`, '/projects'],
      onSuccess: (r, v) => {
        const row = r as (DomainRow & { warning?: string | null }) | undefined;
        if (v.action === 'verify') {
          if (row?.status === 'VERIFIED' || row?.status === 'ACTIVE') toast.success(`${v.d.hostname} ownership verified`);
          else toast.error(`Verification not complete: ${row?.lastError ?? 'records not found yet'}`);
        } else if (v.action === 'enable') {
          toast.success(`${v.d.hostname} enabled`);
          if (row?.warning) toast.warning(row.warning);
        } else if (v.action === 'check-ssl') {
          if (row?.sslStatus === 'ACTIVE') toast.success('A valid HTTPS certificate is being served');
          else toast.error(row?.lastError ?? 'HTTPS check failed');
        } else if (v.action === 'remove') {
          toast.success(`${v.d.hostname} removed`);
          setRemoving(null);
        } else toast.success('Domain updated');
      },
    },
  );

  if (!project.permissions.canManageDomains) {
    return <Alert tone="info">Domains for this project are managed by the platform team. Contact them to connect a subdomain or your own domain.</Alert>;
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Connect a domain" description="The project page is always available on the main site. A subdomain or your own domain shows it as a standalone microsite." />
        <CardBody className="grid gap-4">
          <Segmented
            value={type}
            onChange={(t) => {
              setType(t);
              setError(null);
            }}
            options={[
              { value: 'SUBDOMAIN', label: 'Platform subdomain' },
              { value: 'CUSTOM', label: 'Your own domain' },
            ]}
          />
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) add.mutate(undefined);
            }}
          >
            <Field className="flex-1" htmlFor="domain" error={error} hint={type === 'SUBDOMAIN' ? 'Lowercase letters, numbers and hyphens — live immediately.' : 'e.g. www.yourproject.in — you will add two DNS records to prove ownership.'}>
              <Input
                id="domain"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === 'SUBDOMAIN' ? project.slug : 'www.yourproject.in'}
                trailing={type === 'SUBDOMAIN' && q.data ? <span className="text-xs text-ink-500">.{q.data.rootDomain}</span> : undefined}
                aria-invalid={Boolean(error)}
              />
            </Field>
            <Button type="submit" loading={add.isPending} disabled={!value.trim()}>
              Add domain
            </Button>
          </form>
          {q.data && type === 'CUSTOM' && !q.data.cnameTarget && !q.data.aRecord ? (
            <Alert tone="warning">The platform ingress target (CUSTOM_DOMAIN_CNAME_TARGET / CUSTOM_DOMAIN_A_RECORD) is not configured in this environment, so custom domains can be verified but visitors cannot be routed to them yet.</Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Domains" description={q.data ? `HTTPS: ${q.data.tlsProvider === 'caddy-on-demand' ? 'issued automatically on first visit (Caddy on-demand TLS)' : 'provided by your hosting/CDN configuration'}` : undefined} />
        <QueryState query={q} isEmpty={(d) => d.domains.length === 0} empty={{ icon: <Globe />, title: 'No domains connected', description: `The project is reachable at /projects/${project.slug} on the main site.` }}>
          {(d) => {
            const active = d.domains.filter((x) => x.status === 'ACTIVE');
            const primary = active.find((x) => x.isPrimary);
            return (
              <CardBody className="grid gap-3">
                {active.length ? (
                  <p className="text-sm text-ink-600">
                    {primary ? (
                      <>
                        Search engines are told that <span className="font-medium text-ink-900">{primary.hostname}</span> is this project&apos;s canonical address — the main-site page and any other domains point to it.
                      </>
                    ) : (
                      <>
                        No primary address yet: search engines treat the main-site page <span className="font-medium text-ink-900">/projects/{project.slug}</span> as canonical and the domains below as copies of it. Use “Make primary address” to make a domain the canonical one.
                      </>
                    )}
                  </p>
                ) : null}
                {d.domains.map((dom) => (
                  <DomainCard key={dom.id} domain={dom} onAction={(a, row) => (a === 'remove' ? setRemoving(row) : action.mutate({ action: a, d: row }))} />
                ))}
              </CardBody>
            );
          }}
        </QueryState>
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="danger"
        title={`Remove ${removing?.hostname}?`}
        description="Visitors to this address will no longer reach the project. You can add it again later (custom domains need re-verification)."
        confirmLabel="Remove"
        loading={action.isPending}
        onConfirm={() => removing && action.mutate({ action: 'remove', d: removing })}
      />
      {project.isPublished ? null : <Alert tone="info">Domains only serve the microsite while the project is published.</Alert>}
    </div>
  );
}
