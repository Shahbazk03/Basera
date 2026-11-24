'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { grantsAllow, type PermissionKey, type SessionUser, type WorkspaceKey } from '@estate/shared';
import { api } from './api';

interface SessionContextValue {
  user: SessionUser;
  /** UI hint only — the API re-checks every permission. */
  can: (permission: PermissionKey, organizationId?: string | null) => boolean;
  canAny: (permissions: PermissionKey[]) => boolean;
  workspace: WorkspaceKey;
  setWorkspace: (ws: WorkspaceKey) => void;
  /** Organisation the user is currently acting for (partners) or the platform organisation (staff). */
  activeOrgId: string | null;
  activeOrg: SessionUser['memberships'][number] | null;
  setActiveOrgId: (id: string) => void;
  isPlatformUser: boolean;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const WS_KEY = 'console.workspace';
const ORG_KEY = 'console.activeOrg';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionUser>('/auth/me'),
    staleTime: 60_000,
    retry: false,
  });
}

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const qc = useQueryClient();
  const defaultWorkspace: WorkspaceKey = user.workspaces.includes('admin') ? 'admin' : (user.workspaces[0] ?? 'staff');
  const [workspace, setWorkspaceState] = React.useState<WorkspaceKey>(defaultWorkspace);
  const [activeOrgId, setActiveOrgState] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ws = readStorage(WS_KEY) as WorkspaceKey | null;
    if (ws && user.workspaces.includes(ws)) setWorkspaceState(ws);
    const org = readStorage(ORG_KEY);
    if (org && user.memberships.some((m) => m.organizationId === org)) setActiveOrgState(org);
  }, [user]);

  const orgForWorkspace = React.useCallback(
    (ws: WorkspaceKey): string | null => {
      const typeByWs: Partial<Record<WorkspaceKey, string>> = { broker: 'BROKERAGE', developer: 'DEVELOPER', 'lead-provider': 'LEAD_PROVIDER', owner: 'INDIVIDUAL_OWNER' };
      const t = typeByWs[ws];
      if (!t) return user.platformOrganizationId;
      return user.memberships.find((m) => m.organizationType === t)?.organizationId ?? null;
    },
    [user],
  );

  const effectiveOrgId = React.useMemo(() => {
    if (activeOrgId) {
      const m = user.memberships.find((x) => x.organizationId === activeOrgId);
      const typeByWs: Partial<Record<WorkspaceKey, string>> = { broker: 'BROKERAGE', developer: 'DEVELOPER', 'lead-provider': 'LEAD_PROVIDER', owner: 'INDIVIDUAL_OWNER' };
      if (m && (typeByWs[workspace] ? m.organizationType === typeByWs[workspace] : m.organizationType === 'PLATFORM')) return activeOrgId;
    }
    return orgForWorkspace(workspace);
  }, [activeOrgId, workspace, user, orgForWorkspace]);

  const value: SessionContextValue = React.useMemo(
    () => ({
      user,
      can: (p, orgId) => grantsAllow(user.permissions, p, orgId),
      canAny: (ps) => ps.some((p) => grantsAllow(user.permissions, p)),
      workspace,
      setWorkspace: (ws) => {
        setWorkspaceState(ws);
        writeStorage(WS_KEY, ws);
      },
      activeOrgId: effectiveOrgId,
      activeOrg: user.memberships.find((m) => m.organizationId === effectiveOrgId) ?? null,
      setActiveOrgId: (id) => {
        setActiveOrgState(id);
        writeStorage(ORG_KEY, id);
      },
      isPlatformUser: user.workspaces.includes('admin') || user.workspaces.includes('staff'),
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } finally {
          qc.clear();
          window.location.assign('/login');
        }
      },
      reload: async () => {
        await qc.invalidateQueries({ queryKey: ['session'] });
      },
    }),
    [user, workspace, effectiveOrgId, qc],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Renders children only when the user holds one of the permissions (UI convenience — not security). */
export function Can({ permission, orgId, children, fallback = null }: { permission: PermissionKey | PermissionKey[]; orgId?: string | null; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useSession();
  const perms = Array.isArray(permission) ? permission : [permission];
  return <>{perms.some((p) => can(p, orgId)) ? children : fallback}</>;
}
