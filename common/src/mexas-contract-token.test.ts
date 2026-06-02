import { convertContract } from './supabase/contracts'

function contractRow(dataToken: string | undefined, nativeToken = 'MANA') {
  return {
    data: {
      id: 'contract',
      slug: 'contract',
      creatorId: 'creator',
      creatorName: 'Creator',
      creatorUsername: 'creator',
      question: 'Question?',
      description: '',
      visibility: 'public',
      createdTime: 1,
      lastUpdatedTime: 1,
      isResolved: false,
      volume: 0,
      volume24Hours: 0,
      elasticity: 1,
      collectedFees: {
        creatorFee: 0,
        platformFee: 0,
        liquidityFee: 0,
      },
      uniqueBettorCount: 0,
      uniqueBettorCountDay: 0,
      mechanism: 'cpmm-1',
      outcomeType: 'BINARY',
      pool: { YES: 500, NO: 500 },
      p: 0.5,
      prob: 0.5,
      totalLiquidity: 1000,
      subsidyPool: 0,
      token: dataToken,
    },
    importance_score: 0,
    home_page_score_adjustment: null,
    home_page_score_adjustment_expires_at: null,
    view_count: 0,
    conversion_score: 0,
    freshness_score: 0,
    daily_score: 0,
    token: nativeToken,
    boosted: false,
  }
}

describe('MEXAS contract token conversion', () => {
  test('prefers MEX token from contract data over legacy native MANA column', () => {
    expect(convertContract(contractRow('MEX') as any).token).toBe('MEX')
  })

  test('uses native token when contract data is not MEX', () => {
    expect(convertContract(contractRow('MANA', 'CASH') as any).token).toBe(
      'CASH'
    )
  })
})
