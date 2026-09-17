import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreatePlotBody,
  createPlotBodySchema,
  type PlotDetail,
  type UpdatePlotBody,
  updatePlotBodySchema,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import type { ZodError } from 'zod';
import { ApiError } from '../../api/client.ts';
import { createPlot, plotKeys, updatePlot } from '../../api/plots.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';

const LOCAL_MESSAGES: Record<string, string> = {
  code: 'Enter a plot code (1–64 characters).',
  name: 'Enter a plot name (1–200 characters).',
  latitude: 'Latitude must be between -90 and 90.',
  longitude: 'Longitude must be between -180 and 180.',
};

/**
 * Dialog for creating or editing a field plot (RFC-67 R5).
 * Validated against shared Zod schemas; handles code collisions (PLOT_CODE_TAKEN).
 * @rfc RFC-67 R5
 * @rfc RFC-13 R3
 */
export function PlotDialog({
  plot,
  onClose,
  onSaved,
}: {
  plot?: PlotDetail | null;
  onClose: () => void;
  onSaved: (plot: PlotDetail) => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    code: useId(),
    name: useId(),
    description: useId(),
    latitude: useId(),
    longitude: useId(),
    country: useId(),
    biome: useId(),
  };

  const [code, setCode] = useState(plot?.code ?? '');
  const [name, setName] = useState(plot?.name ?? '');
  const [description, setDescription] = useState(plot?.description ?? '');
  const [latitude, setLatitude] = useState(
    plot?.latitude !== null && plot?.latitude !== undefined ? String(plot.latitude) : '',
  );
  const [longitude, setLongitude] = useState(
    plot?.longitude !== null && plot?.longitude !== undefined ? String(plot.longitude) : '',
  );
  const [country, setCountry] = useState(plot?.country ?? '');
  const [biome, setBiome] = useState(plot?.biome ?? '');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (
      input: { kind: 'create'; body: CreatePlotBody } | { kind: 'update'; body: UpdatePlotBody },
    ) =>
      input.kind === 'create' ? createPlot(input.body) : updatePlot(plot?.id ?? '', input.body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: plotKeys.all });
      onSaved(saved);
    },
  });

  const isCodeTaken = save.error instanceof ApiError && save.error.code === 'PLOT_CODE_TAKEN';
  const errors: Record<string, string> = { ...fieldErrors(save.error), ...localErrors };
  if (isCodeTaken) errors.code = 'Another plot already has this code.';

  function showIssues(error: ZodError) {
    save.reset();
    const next: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      next[path] = LOCAL_MESSAGES[path] ?? issue.message;
    }
    setLocalErrors(next);
  }

  function parseNumber(val: string): number | undefined {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    return Number(trimmed);
  }

  function parseNullableNumber(val: string): number | null | undefined {
    const trimmed = val.trim();
    if (!trimmed) return null;
    return Number(trimmed);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const trimmedCountry = country.trim();
    const trimmedBiome = biome.trim();

    if (!plot) {
      const parsed = createPlotBodySchema.safeParse({
        code: trimmedCode,
        name: trimmedName,
        description: trimmedDesc || undefined,
        latitude: parseNumber(latitude),
        longitude: parseNumber(longitude),
        country: trimmedCountry || undefined,
        biome: trimmedBiome || undefined,
      });
      if (!parsed.success) return showIssues(parsed.error);
      setLocalErrors({});
      save.mutate({ kind: 'create', body: parsed.data });
      return;
    }

    const diff: UpdatePlotBody = {};
    if (trimmedCode !== plot.code) diff.code = trimmedCode;
    if (trimmedName !== plot.name) diff.name = trimmedName;
    if (trimmedDesc !== plot.description) diff.description = trimmedDesc;
    if (latitude.trim() !== (plot.latitude !== null ? String(plot.latitude) : '')) {
      diff.latitude = parseNullableNumber(latitude);
    }
    if (longitude.trim() !== (plot.longitude !== null ? String(plot.longitude) : '')) {
      diff.longitude = parseNullableNumber(longitude);
    }
    if (trimmedCountry !== (plot.country ?? '')) {
      diff.country = trimmedCountry || null;
    }
    if (trimmedBiome !== (plot.biome ?? '')) {
      diff.biome = trimmedBiome || null;
    }

    if (Object.keys(diff).length === 0) {
      onClose();
      return;
    }

    const parsed = updatePlotBodySchema.safeParse(diff);
    if (!parsed.success) return showIssues(parsed.error);
    setLocalErrors({});
    save.mutate({ kind: 'update', body: parsed.data });
  }

  return (
    <Dialog
      open
      title={plot ? 'Edit plot' : 'New plot'}
      onClose={onClose}
      closeDisabled={save.isPending}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={ids.code} label="Code" error={errors.code}>
            <Input
              id={ids.code}
              value={code}
              maxLength={64}
              placeholder="e.g. AMZ-01"
              onChange={(e) => setCode(e.target.value)}
              invalid={Boolean(errors.code)}
            />
          </Field>
          <Field id={ids.name} label="Name" error={errors.name}>
            <Input
              id={ids.name}
              value={name}
              maxLength={200}
              placeholder="e.g. Manaus Tower 1"
              onChange={(e) => setName(e.target.value)}
              invalid={Boolean(errors.name)}
            />
          </Field>
        </div>

        <Field id={ids.description} label="Description" error={errors.description}>
          <textarea
            id={ids.description}
            rows={3}
            maxLength={2000}
            className="w-full rounded-[10px] border border-canopy-700/20 bg-white px-3.5 py-2.5 text-body text-canopy-950 placeholder:text-mist-400 focus:border-canopy-700 focus:outline-none"
            placeholder="Plot location notes, characteristics, elevation…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={ids.latitude} label="Latitude" error={errors.latitude}>
            <Input
              id={ids.latitude}
              type="text"
              inputMode="decimal"
              placeholder="-90 to 90"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              invalid={Boolean(errors.latitude)}
            />
          </Field>
          <Field id={ids.longitude} label="Longitude" error={errors.longitude}>
            <Input
              id={ids.longitude}
              type="text"
              inputMode="decimal"
              placeholder="-180 to 180"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              invalid={Boolean(errors.longitude)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={ids.country} label="Country" error={errors.country}>
            <Input
              id={ids.country}
              value={country}
              maxLength={100}
              placeholder="e.g. Brazil"
              onChange={(e) => setCountry(e.target.value)}
              invalid={Boolean(errors.country)}
            />
          </Field>
          <Field id={ids.biome} label="Biome" error={errors.biome}>
            <Input
              id={ids.biome}
              value={biome}
              maxLength={100}
              placeholder="e.g. Amazon"
              onChange={(e) => setBiome(e.target.value)}
              invalid={Boolean(errors.biome)}
            />
          </Field>
        </div>

        {save.isError && !isCodeTaken && !isValidationError(save.error) ? (
          <Alert tone="error">
            {save.error instanceof ApiError ? save.error.message : 'Could not save plot.'}
          </Alert>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            {plot ? 'Save' : 'Create plot'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
