import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TransactionCard from './TransactionCard';

describe('TransactionCard', () => {
  it('shows the honest legacy recording status instead of claiming completion', () => {
    render(<TransactionCard payment={{
      status: 'LEGACY_RECORDED',
      amount: 12.5,
      orderId: 'legacy-1',
      date: '2026-08-28T00:00:00.000Z',
    }} />);
    expect(screen.getByText('LEGACY RECORDED')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });
});
