import { HIDDEN_SPECIES_NAME_MESSAGE } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { decideErrorMessage, proposeErrorMessage } from '../curation/proposal-errors.ts';
import { addNameErrorMessage } from './AddNameDialog.tsx';
import { speciesErrorMessage } from './errors.ts';

describe('RFC-60 R13 a name a hidden species holds', () => {
  const hidden = new ApiError(409, 'SPECIES_NAME_TAKEN', HIDDEN_SPECIES_NAME_MESSAGE);
  const plain = new ApiError(409, 'SPECIES_NAME_TAKEN', 'A species with this name already exists');

  it('shows the API sentence, which says the species is not a tree here, in every form that registers a name', () => {
    for (const message of [
      proposeErrorMessage,
      decideErrorMessage,
      speciesErrorMessage,
      addNameErrorMessage,
    ]) {
      expect(message(hidden)).toBe(HIDDEN_SPECIES_NAME_MESSAGE);
      expect(message(plain)).not.toBe(HIDDEN_SPECIES_NAME_MESSAGE);
    }
  });
});
