'use client';

import * as React from 'react';
import { Flag } from 'lucide-react';
import { enumLabel, REPORT_REASONS } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Alert, Button, Dialog, DialogContent, DialogFooter, DialogTrigger, Field, Input, Select, Textarea } from '@estate/ui';
import { api } from '@/lib/api-browser';

export function ReportListing({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState<string>('INCORRECT_PRICE');
  const [details, setDetails] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [state, setState] = React.useState<{ busy: boolean; done?: string; error?: string }>({ busy: false });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setState({ busy: false }); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-ink-500">
          <Flag /> Report
        </Button>
      </DialogTrigger>
      <DialogContent title="Report this listing" description="Tell us what is wrong. Our team reviews every report.">
        {state.done ? (
          <Alert tone="success">{state.done}</Alert>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setState({ busy: true });
              try {
                const res = await api.post<{ message: string }>(`/public/properties/${propertyId}/report`, { reason, details: details || undefined, email: email || undefined });
                setState({ busy: false, done: res.message });
              } catch (err) {
                setState({ busy: false, error: errorMessage(err) });
              }
            }}
          >
            {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
            <Field label="Reason" htmlFor="report-reason">
              <Select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {enumLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Details" htmlFor="report-details">
              <Textarea id="report-details" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Field>
            <Field label="Your email (optional)" htmlFor="report-email" hint="Only used if we need more information.">
              <Input id="report-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={state.busy}>
                Submit report
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
