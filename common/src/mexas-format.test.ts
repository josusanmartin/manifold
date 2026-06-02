import { formatWithToken } from './util/format'

describe('MEXAS formatting', () => {
  test('formats MEX amounts with token name and decimal precision', () => {
    expect(formatWithToken({ amount: 9, token: 'MEX' })).toBe('MEX 9')
    expect(formatWithToken({ amount: 1.23456, token: 'MEX' })).toBe(
      'MEX 1.2346'
    )
    expect(formatWithToken({ amount: 1.2, token: 'MEX', toDecimal: 2 })).toBe(
      'MEX 1.20'
    )
  })
})
