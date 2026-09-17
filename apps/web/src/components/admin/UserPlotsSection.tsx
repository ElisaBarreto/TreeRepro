import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@treerepro/contracts';
import { useState } from 'react';
import { adminKeys, setUserPlots } from '../../api/admin.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { Alert, Badge, Button, Input, Section } from '../ui/index.ts';
import { userErrorMessage } from './user-errors.ts';

/**
 * The user's field plots: checkboxes over `GET /api/plots` for `users.update`
 * and the restriction checkbox; badges and status otherwise.
 * @rfc RFC-67 R6
 * @rfc RFC-13 R3, R6
 */
export function UserPlotsSection({ user, canEdit }: { user: User; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const plotsQuery = useQuery({
    queryKey: plotKeys.list({ limit: 100 }),
    queryFn: () => listPlots({ limit: 100 }),
    enabled: canEdit,
  });

  const seed = `${user.plots
    .map((p) => p.id)
    .sort()
    .join(',')}:${user.restrictToAssignedPlots}`;

  const [state, setState] = useState({
    seed,
    checked: new Set(user.plots.map((p) => p.id)),
    restricted: user.restrictToAssignedPlots,
    search: '',
  });

  if (state.seed !== seed) {
    setState({
      seed,
      checked: new Set(user.plots.map((p) => p.id)),
      restricted: user.restrictToAssignedPlots,
      search: state.search,
    });
  }

  const save = useMutation({
    mutationFn: (body: { plotIds: string[]; restrictToAssignedPlots: boolean }) =>
      setUserPlots(user.id, body),
    onSuccess: (next) => {
      queryClient.setQueryData(adminKeys.user(user.id), next);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const toggle = (id: string) => {
    const checked = new Set(state.checked);
    if (checked.has(id)) checked.delete(id);
    else checked.add(id);
    const restricted = checked.size === 0 ? false : state.restricted;
    setState({ ...state, seed, checked, restricted });
  };

  const toggleRestriction = (checked: boolean) => {
    setState({ ...state, seed, restricted: checked });
  };

  const allPlots = plotsQuery.data?.data ?? [];
  const filteredPlots = allPlots.filter((p) => {
    if (!state.search.trim()) return true;
    const term = state.search.trim().toLowerCase();
    return p.code.toLowerCase().includes(term) || p.name.toLowerCase().includes(term);
  });

  return (
    <Section
      id="plots"
      title="Plots"
      description="Field plots assigned to this user. Contributors can be restricted to see species in these plots only."
    >
      {!canEdit ? (
        <div className="flex flex-col gap-2">
          {user.plots.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {user.plots.map((p) => (
                <Badge key={p.id}>{`${p.code} — ${p.name}`}</Badge>
              ))}
            </div>
          ) : (
            <p className="text-body text-mist-500">No plots assigned.</p>
          )}
          {user.restrictToAssignedPlots ? (
            <p className="text-meta font-medium text-amber-700">
              Restricted to assigned plots (cannot see species outside them).
            </p>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              plotIds: Array.from(state.checked),
              restrictToAssignedPlots: state.checked.size > 0 && state.restricted,
            });
          }}
          className="flex flex-col gap-4"
        >
          {plotsQuery.isError ? (
            <Alert tone="error">{userErrorMessage(plotsQuery.error)}</Alert>
          ) : null}
          {allPlots.length > 5 ? (
            <div className="max-w-xs">
              <Input
                type="search"
                placeholder="Filter plots…"
                value={state.search}
                onChange={(e) => setState({ ...state, search: e.target.value })}
              />
            </div>
          ) : null}
          <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
            {filteredPlots.map((plot) => (
              <li key={plot.id}>
                <label className="flex items-center gap-3 text-body text-canopy-950">
                  <input
                    type="checkbox"
                    className="size-5 accent-pollen-500"
                    checked={state.checked.has(plot.id)}
                    onChange={() => toggle(plot.id)}
                  />
                  <span className="font-mono text-meta font-semibold">{plot.code}</span>
                  <span>{plot.name}</span>
                  {plot.country ? (
                    <span className="text-meta text-mist-500">{plot.country}</span>
                  ) : null}
                </label>
              </li>
            ))}
            {filteredPlots.length === 0 && allPlots.length > 0 ? (
              <li className="text-meta text-mist-500">No plots match filter.</li>
            ) : null}
            {allPlots.length === 0 && !plotsQuery.isLoading ? (
              <li className="text-meta text-mist-500">No plots exist in the system yet.</li>
            ) : null}
          </ul>

          <div className="border-t border-canopy-700/10 pt-3">
            <label className="flex items-center gap-3 text-body text-canopy-950">
              <input
                type="checkbox"
                className="size-5 accent-pollen-500"
                disabled={state.checked.size === 0}
                checked={state.checked.size > 0 && state.restricted}
                onChange={(e) => toggleRestriction(e.target.checked)}
              />
              <span>Restrict to assigned plots (the user never sees species outside them)</span>
            </label>
          </div>

          {save.isSuccess ? <Alert tone="success">Plots saved.</Alert> : null}
          {save.isError ? <Alert tone="error">{userErrorMessage(save.error)}</Alert> : null}
          <div>
            <Button type="submit" pending={save.isPending} disabled={!plotsQuery.data}>
              Save plots
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
