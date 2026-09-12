import { configurePii } from '../src/security/pii.ts';
import { TEST_HMAC_KEY, TEST_KEYRING } from './helpers/pii.ts';

configurePii(TEST_KEYRING, TEST_HMAC_KEY);
