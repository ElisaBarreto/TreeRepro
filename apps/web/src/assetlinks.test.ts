import { describe, expect, it } from 'vitest';
import links from '../public/.well-known/assetlinks.json';

describe('RFC-13 R15 assetlinks.json', () => {
  it('declares both production origins for sign-in credentials', () => {
    expect(links).toEqual(
      ['https://treerepro.elisabarreto.com.br', 'https://plantrepro.elisabarreto.com.br'].map(
        (site) => ({
          relation: ['delegate_permission/common.get_login_creds'],
          target: { namespace: 'web', site },
        }),
      ),
    );
  });
});
