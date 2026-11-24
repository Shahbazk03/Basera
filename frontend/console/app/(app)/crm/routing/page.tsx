'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash2, Users, Workflow } from 'lucide-react';
import { ASSIGNMENT_STRATEGIES, enumLabel } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@estate/ui';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useAssignees, useLeadSources, useProjectOptions } from '@/components/crm/pickers';

interface Team {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  organization: { id: string; name: string };
  manager: { id: string; fullName: string } | null;
  members: { id: string; userId: string; isActive: boolean; openLeads: number; user: { id: string; fullName: string; email: string | null; status: string } }[];
  _count: { rules: number };
}

interface Rule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  strategy: string;
  maxOpenLeadsPerUser: number | null;
  matchProjectId: string | null;
  matchCityIds: string[];
  matchLocalityIds: string[];
  matchSourceKeys: string[];
  matchListingType: string | null;
  salesTeamId: string;
  salesTeam: { id: string; name: string; isActive: boolean };
  matchProject: { id: string; name: string } | null;
  organization: { id: string; name: string };
  _count: { assignments: number };
}

interface Locality {
  id: string;
  name: string;
}

function useLocalities() {
  return useApi<Locality[]>('/public/cities/lucknow/localities', undefined, { staleTime: 600_000 });
}

export default function RoutingPage() {
  const { workspace, activeOrgId } = useSession();
  const orgId = ['broker', 'developer', 'owner'].includes(workspace) ? activeOrgId : undefined;
  const teams = useApi<Team[]>('/crm/teams', orgId ? { organizationId: orgId } : undefined);
  const rules = useApi<Rule[]>('/crm/rules', orgId ? { organizationId: orgId } : undefined);
  const localities = useLocalities();
  const locName = new Map((localities.data ?? []).map((l) => [l.id, l.name]));
  const [teamDialog, setTeamDialog] = React.useState<Team | 'new' | null>(null);
  const [ruleDialog, setRuleDialog] = React.useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<Rule | null>(null);

  const toggleRule = useApiMutation((r: Rule) => api.patch(`/crm/rules/${r.id}`, { isActive: !r.isActive }), { success: 'Rule updated', invalidate: ['/crm/rules'] });
  const reorder = useApiMutation((ids: string[]) => api.post('/crm/rules/reorder', { ruleIds: ids }), { success: 'Rule order saved', invalidate: ['/crm/rules'] });
  const removeRule = useApiMutation((id: string) => api.delete(`/crm/rules/${id}`), { success: 'Rule deleted', invalidate: ['/crm/rules'], onSuccess: () => setDeleting(null) });
  const toggleMember = useApiMutation((v: { teamId: string; userId: string; isActive: boolean }) => api.post(`/crm/teams/${v.teamId}/members`, { userId: v.userId, isActive: v.isActive }), { invalidate: ['/crm/teams'], silent: false });

  const move = (list: Rule[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    reorder.mutate(next.map((r) => r.id));
  };

  const rulesByOrg = React.useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules.data ?? []) m.set(r.organization.name, [...(m.get(r.organization.name) ?? []), r]);
    return [...m.entries()];
  }, [rules.data]);

  return (
    <>
      <PageHeader
        title="Teams & routing"
        description="New leads go through the active rules from top to bottom. The first rule whose conditions all match picks a team member by round-robin or lowest workload."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTeamDialog('new')}>
              <Users /> New team
            </Button>
            <Button size="sm" onClick={() => setRuleDialog('new')} disabled={!teams.data?.length}>
              <Plus /> New rule
            </Button>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Assignment rules" description="Order matters — drag priority with the arrows. Leads that match no rule stay unassigned for a manager to route." />
            {rules.isLoading ? (
              <CardBody>
                <Skeleton className="h-32 w-full" />
              </CardBody>
            ) : !rules.data?.length ? (
              <EmptyState icon={<Workflow />} title="No rules yet" description="Create a team first, then a rule that routes leads to it." />
            ) : (
              rulesByOrg.map(([org, list]) => (
                <div key={org}>
                  {rulesByOrg.length > 1 ? <p className="border-b border-line bg-ink-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{org}</p> : null}
                  <ol className="divide-y divide-line">
                    {list.map((r, i) => {
                      const conditions = [
                        r.matchProject ? `Project: ${r.matchProject.name}` : null,
                        r.matchLocalityIds.length ? `Localities: ${r.matchLocalityIds.map((id) => locName.get(id) ?? 'unknown').join(', ')}` : null,
                        r.matchCityIds.length ? `${r.matchCityIds.length} city filter(s)` : null,
                        r.matchSourceKeys.length ? `Sources: ${r.matchSourceKeys.map((k) => enumLabel(k)).join(', ')}` : null,
                        r.matchListingType ? (r.matchListingType === 'RENT' ? 'Rentals' : 'Sales') : null,
                      ].filter(Boolean);
                      return (
                        <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                          <div className="flex items-center gap-1">
                            <span className="tabular grid size-7 place-items-center rounded-md bg-ink-100 text-xs font-semibold text-ink-700">{i + 1}</span>
                            <div className="flex flex-col">
                              <button type="button" className="rounded p-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30" aria-label="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(list, i, -1)}>
                                <ArrowUp className="size-3.5" />
                              </button>
                              <button type="button" className="rounded p-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30" aria-label="Move down" disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(list, i, 1)}>
                                <ArrowDown className="size-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink-900">
                              {r.name}
                              {!r.isActive ? <Badge tone="neutral" size="sm" className="ml-2">Paused</Badge> : null}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-500">{conditions.length ? conditions.join(' · ') : 'Matches every lead'}</p>
                            <p className="mt-1 text-xs text-ink-600">
                              → {r.salesTeam.name} · {r.strategy === 'WORKLOAD' ? 'lowest workload' : 'round-robin'}
                              {r.maxOpenLeadsPerUser ? ` · max ${r.maxOpenLeadsPerUser} open leads each` : ''} · {r._count.assignments} assignment(s)
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch checked={r.isActive} onCheckedChange={() => toggleRule.mutate(r)} aria-label={r.isActive ? 'Pause rule' : 'Activate rule'} />
                            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setRuleDialog(r)}>
                              <Pencil />
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                              <Trash2 />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))
            )}
          </Card>

          <Card>
            <CardHeader title="Sales teams" description="Members receive leads only while active and still members of the organisation." />
            {teams.isLoading ? (
              <CardBody>
                <Skeleton className="h-32 w-full" />
              </CardBody>
            ) : !teams.data?.length ? (
              <EmptyState icon={<Users />} title="No teams yet" action={<Button size="sm" onClick={() => setTeamDialog('new')}>Create a team</Button>} />
            ) : (
              <div className="divide-y divide-line">
                {teams.data.map((t) => (
                  <div key={t.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink-900">
                          {t.name}
                          {!t.isActive ? <Badge tone="neutral" size="sm" className="ml-2">Inactive</Badge> : null}
                        </p>
                        <p className="text-xs text-ink-500">
                          {t.organization.name} · manager {t.manager?.fullName ?? 'not set'} · used by {t._count.rules} rule(s)
                        </p>
                      </div>
                      <Button size="xs" variant="outline" onClick={() => setTeamDialog(t)}>
                        <Pencil /> Edit
                      </Button>
                    </div>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {t.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink-900">{m.user.fullName}</span>
                            <span className="text-xs text-ink-500">{m.openLeads} open lead(s)</span>
                          </span>
                          <Switch checked={m.isActive} onCheckedChange={(v) => toggleMember.mutate({ teamId: t.id, userId: m.userId, isActive: v })} aria-label={`${m.isActive ? 'Pause' : 'Resume'} lead routing for ${m.user.fullName}`} />
                        </li>
                      ))}
                      {!t.members.length ? <li className="text-sm text-ink-500">No members yet.</li> : null}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        <RoutingTester organizationId={orgId} />
      </div>

      {teamDialog ? <TeamDialog team={teamDialog === 'new' ? null : teamDialog} organizationId={orgId} onClose={() => setTeamDialog(null)} /> : null}
      {ruleDialog ? <RuleDialog rule={ruleDialog === 'new' ? null : ruleDialog} teams={teams.data ?? []} localities={localities.data ?? []} organizationId={orgId} nextPriority={((rules.data?.length ?? 0) + 1) * 10} onClose={() => setRuleDialog(null)} /> : null}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} tone="danger" title={`Delete rule “${deleting?.name}”?`} description="Past assignment history is kept; it will no longer reference this rule." confirmLabel="Delete" loading={removeRule.isPending} onConfirm={() => deleting && removeRule.mutate(deleting.id)} />
    </>
  );
}

function TeamDialog({ team, organizationId, onClose }: { team: Team | null; organizationId?: string | null; onClose: () => void }) {
  const orgId = team?.organization.id ?? organizationId ?? null;
  const people = useAssignees(orgId);
  const [name, setName] = React.useState(team?.name ?? '');
  const [description, setDescription] = React.useState(team?.description ?? '');
  const [managerId, setManagerId] = React.useState(team?.manager?.id ?? '');
  const [isActive, setIsActive] = React.useState(team?.isActive ?? true);
  const [members, setMembers] = React.useState<Set<string>>(new Set(team?.members.map((m) => m.userId) ?? []));
  const save = useApiMutation(
    () => {
      const body = { name, description: description || null, managerId: managerId || null, isActive, memberIds: [...members], ...(organizationId && !team ? { organizationId } : {}) };
      return team ? api.patch(`/crm/teams/${team.id}`, body) : api.post('/crm/teams', body);
    },
    { success: team ? 'Team updated' : 'Team created', invalidate: ['/crm/teams', '/crm/rules'], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={team ? `Edit ${team.name}` : 'New sales team'} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Team name" htmlFor="t-name" required>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Manager" htmlFor="t-mgr">
            <Select id="t-mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">No manager</option>
              {(people.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="t-desc" className="sm:col-span-2">
            <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Members" className="sm:col-span-2" hint="Only active members of the organisation who can work leads are listed.">
            <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
              {(people.data ?? []).map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm hover:border-ink-300">
                  <Checkbox
                    checked={members.has(u.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(members);
                      if (v) next.add(u.id);
                      else next.delete(u.id);
                      setMembers(next);
                    }}
                  />
                  <span className="truncate">{u.fullName}</span>
                  <span className="ml-auto text-xs text-ink-500">{u.openLeads} open</span>
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} /> Team is active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Save team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialog({ rule, teams, localities, organizationId, nextPriority, onClose }: { rule: Rule | null; teams: Team[]; localities: Locality[]; organizationId?: string | null; nextPriority: number; onClose: () => void }) {
  const sources = useLeadSources();
  const projects = useProjectOptions();
  const [name, setName] = React.useState(rule?.name ?? '');
  const [teamId, setTeamId] = React.useState(rule?.salesTeamId ?? teams[0]?.id ?? '');
  const [strategy, setStrategy] = React.useState(rule?.strategy ?? 'ROUND_ROBIN');
  const [projectId, setProjectId] = React.useState(rule?.matchProjectId ?? '');
  const [listingType, setListingType] = React.useState(rule?.matchListingType ?? '');
  const [sourceKeys, setSourceKeys] = React.useState<Set<string>>(new Set(rule?.matchSourceKeys ?? []));
  const [localityIds, setLocalityIds] = React.useState<Set<string>>(new Set(rule?.matchLocalityIds ?? []));
  const [cap, setCap] = React.useState(rule?.maxOpenLeadsPerUser ? String(rule.maxOpenLeadsPerUser) : '');
  const [error, setError] = React.useState<string | null>(null);
  const save = useApiMutation(
    () => {
      const body = {
        name,
        salesTeamId: teamId,
        strategy,
        matchProjectId: projectId || null,
        matchListingType: listingType || null,
        matchSourceKeys: [...sourceKeys],
        matchLocalityIds: [...localityIds],
        maxOpenLeadsPerUser: cap ? Number(cap) : null,
        ...(rule ? {} : { priority: nextPriority, isActive: true, ...(organizationId ? { organizationId } : {}) }),
      };
      return rule ? api.patch(`/crm/rules/${rule.id}`, body) : api.post('/crm/rules', body);
    },
    { success: rule ? 'Rule updated' : 'Rule created', invalidate: ['/crm/rules'], onSuccess: onClose, onError: (e) => setError(errorMessage(e)), silent: true },
  );
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={rule ? `Edit rule` : 'New assignment rule'} description="Leave a condition empty to match any value." size="xl">
        <div className="grid gap-4 sm:grid-cols-2">
          {error ? <Alert tone="danger" className="sm:col-span-2">{error}</Alert> : null}
          <Field label="Rule name" htmlFor="r-name" required>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gomti Nagar rentals" />
          </Field>
          <Field label="Route to team" htmlFor="r-team" required>
            <Select id="r-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams
                .filter((t) => !organizationId || t.organization.id === organizationId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.organization.name})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Pick by" htmlFor="r-strategy">
            <Select id="r-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              {ASSIGNMENT_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s === 'WORKLOAD' ? 'Lowest open-lead workload' : 'Round-robin'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Skip people with at least … open leads" htmlFor="r-cap" hint="Optional cap">
            <Input id="r-cap" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Field label="Project" htmlFor="r-project">
            <Select id="r-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Any project or none</option>
              {projects.options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Listing type" htmlFor="r-lt">
            <Select id="r-lt" value={listingType} onChange={(e) => setListingType(e.target.value)}>
              <option value="">Sale or rent</option>
              <option value="SALE">Sale</option>
              <option value="RENT">Rent</option>
            </Select>
          </Field>
          <Field label="Lead sources" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {(sources.data ?? []).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggle(sourceKeys, setSourceKeys, s.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${sourceKeys.has(s.key) ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-600 hover:border-ink-300'}`}
                  aria-pressed={sourceKeys.has(s.key)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Localities (Lucknow)" className="sm:col-span-2">
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {localities.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggle(localityIds, setLocalityIds, l.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${localityIds.has(l.id) ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-600 hover:border-ink-300'}`}
                  aria-pressed={localityIds.has(l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={name.trim().length < 2 || !teamId} onClick={() => save.mutate(undefined)}>
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RoutingResult {
  rule: { id: string; name: string; priority: number } | null;
  team: { id: string; name: string } | null;
  strategy: string | null;
  assignee: { id: string; fullName: string; openLeads: number } | null;
  candidates: { id: string; fullName: string; openLeads: number; eligible: boolean }[];
  reason: string;
}

function RoutingTester({ organizationId }: { organizationId?: string | null }) {
  const sources = useLeadSources();
  const projects = useProjectOptions();
  const [sourceKey, setSourceKey] = React.useState('WEBSITE');
  const [projectId, setProjectId] = React.useState('');
  const [listingType, setListingType] = React.useState('');
  const [result, setResult] = React.useState<RoutingResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function run() {
    setBusy(true);
    try {
      setResult(await api.post<RoutingResult>('/crm/routing/test', { sourceKey, projectId: projectId || null, listingType: listingType || null, ...(organizationId ? { organizationId } : {}) }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="h-fit">
      <CardHeader title="Test routing" description="See who would receive a lead — nothing is assigned or saved." />
      <CardBody className="grid gap-4">
        <Field label="Source" htmlFor="rt-source">
          <Select id="rt-source" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            {(sources.data ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project" htmlFor="rt-project">
          <Select id="rt-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Listing type" htmlFor="rt-lt">
          <Select id="rt-lt" value={listingType} onChange={(e) => setListingType(e.target.value)}>
            <option value="">Not specified</option>
            <option value="SALE">Sale</option>
            <option value="RENT">Rent</option>
          </Select>
        </Field>
        <Button onClick={() => void run()} loading={busy}>
          <FlaskConical /> Test
        </Button>
        {result ? (
          <div className="rounded-lg border border-line bg-ink-50/60 p-4 text-sm">
            {result.assignee ? (
              <p className="font-medium text-ink-900">
                → {result.assignee.fullName} <span className="font-normal text-ink-500">({result.assignee.openLeads} open)</span>
              </p>
            ) : (
              <p className="font-medium text-warning">Would stay unassigned</p>
            )}
            <p className="mt-1 text-xs text-ink-600">{result.reason}</p>
            {result.candidates.length ? (
              <ul className="mt-3 space-y-1 text-xs text-ink-600">
                {result.candidates.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.fullName}</span>
                    <span className={c.eligible ? '' : 'text-danger'}>
                      {c.openLeads} open{c.eligible ? '' : ' · at cap'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
