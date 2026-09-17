import { UNRESTRICTED, type Visibility } from '../../src/access/visibility.ts';

export { UNRESTRICTED };
/** A contributor: no inactive rows, no plot restriction. */
export const RESTRICTED: Visibility = { inactive: false, plotIds: null };
